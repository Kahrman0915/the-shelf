// What Claude is asked to read off a sleeve, and how its answer is checked. Plain TypeScript: no
// Deno, no SDK import, so Vitest can load it.

import type { Read } from '../_shared/shape.ts';

export type { Read };

/** Each photo, once decoded. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_PHOTO_CHARS = Math.ceil(MAX_PHOTO_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A non-empty, padded base64 string whose decoded size is at most 2 MB. Never logs the photo. */
export function isPhoto(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PHOTO_CHARS) return false;
  if (value.length % 4 !== 0 || !BASE64.test(value)) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding <= MAX_PHOTO_BYTES;
}

const nullableString = { type: ['string', 'null'] } as const;

export const READ_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      artist: nullableString,
      title: nullableString,
      barcode: nullableString,
      catalog: nullableString,
      label: nullableString,
    },
    required: ['artist', 'title', 'barcode', 'catalog', 'label'],
    additionalProperties: false,
  },
} as const;

const INSTRUCTION =
  'Copy only what is printed on the sleeve. Read the artist and title from the front. ' +
  'Read the barcode digits, the catalog number and the label from the back. ' +
  'Use null for anything you cannot read clearly. Do not guess.';

const image = (data: string) => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data },
});

export function readRequest(front: string, back: string | null): object {
  const content: object[] = [image(front)];
  if (back !== null) content.push(image(back));
  content.push({ type: 'text', text: INSTRUCTION });
  return {
    model: 'claude-haiku-5-5',
    max_tokens: 1024,
    output_config: { format: READ_SCHEMA },
    messages: [{ role: 'user', content }],
  };
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

function barcode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[\s-]/g, '');
  return /^\d{8,14}$/.test(digits) ? digits : null;
}

export function cleanRead(raw: unknown): Read {
  const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    artist: text(o.artist, 200),
    title: text(o.title, 200),
    barcode: barcode(o.barcode),
    catalog: text(o.catalog, 40),
    label: text(o.label, 200),
  };
}

/** A minimal structural type on purpose: the SDK can't be imported under Vitest. */
export function readFromMessage(message: {
  stop_reason: string | null;
  content: { type: string; text?: string }[];
}): Read {
  const empty = cleanRead(null);
  if (message.stop_reason === 'refusal') return empty;
  const block = message.content.find((b) => b.type === 'text' && typeof b.text === 'string');
  if (!block?.text) return empty;
  try {
    return cleanRead(JSON.parse(block.text));
  } catch {
    return empty;
  }
}
