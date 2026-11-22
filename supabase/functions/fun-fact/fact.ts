// The fun-fact request, and the checks that refuse an unsourced answer. Plain TypeScript: no Deno,
// no SDK import, so Vitest can load it.

export type FactInput = { artist: string; title: string; year: number | null; label: string | null };

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

export function cleanFactInput(raw: unknown): FactInput | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const artist = text(o.artist, 200);
  const title = text(o.title, 200);
  if (artist === null || title === null) return null;
  const year = typeof o.year === 'number' && Number.isInteger(o.year) && o.year >= 1900 && o.year <= 2100 ? o.year : null;
  return { artist, title, year, label: text(o.label, 200) };
}

const nullableString = { type: ['string', 'null'] } as const;

export const FACT_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { fact: nullableString, sourceUrl: nullableString },
    required: ['fact', 'sourceUrl'],
    additionalProperties: false,
  },
} as const;

export function factRequest(input: FactInput): object {
  const details = [
    `Album: "${input.title}" by ${input.artist}`,
    input.year !== null ? `Year: ${input.year}` : null,
    input.label !== null ? `Label: ${input.label}` : null,
  ].filter((l) => l !== null);
  const prompt =
    `${details.join('\n')}\n\n` +
    'Use the web search tool to find one surprising, true fact about the making, history or reception of this album. ' +
    'Write it in one or two sentences of at most 300 characters, taken from a page you found with the search, ' +
    "and give that page's URL as sourceUrl. If you find nothing, use null for both fact and sourceUrl.";
  return {
    model: 'claude-haiku-5-5',
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    output_config: { format: FACT_SCHEMA },
    messages: [{ role: 'user', content: prompt }],
  };
}

/** Every URL the web search returned. A failed search has an object, not an array, for `content`. */
export function searchUrls(content: { type: string; content?: unknown }[]): Set<string> {
  const urls = new Set<string>();
  for (const block of content) {
    if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue;
    for (const item of block.content) {
      if (item !== null && typeof item === 'object' && (item as { type?: unknown }).type === 'web_search_result') {
        const url = (item as { url?: unknown }).url;
        if (typeof url === 'string') urls.add(url);
      }
    }
  }
  return urls;
}

/** A minimal structural type on purpose: the SDK can't be imported under Vitest. */
export function factFromMessage(message: {
  stop_reason: string | null;
  content: { type: string; text?: string; content?: unknown }[];
}): { fact: string; sourceUrl: string } | null {
  if (message.stop_reason === 'refusal') return null;
  const texts = message.content.filter((b) => b.type === 'text' && typeof b.text === 'string');
  const last = texts[texts.length - 1];
  if (!last?.text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(last.text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const fact = text(o.fact, 300);
  const sourceUrl = typeof o.sourceUrl === 'string' ? o.sourceUrl : null;
  if (fact === null || sourceUrl === null) return null;
  if (!sourceUrl.startsWith('https://') || !searchUrls(message.content).has(sourceUrl)) return null;
  return { fact, sourceUrl };
}
