// What the shelf likes, the request that asks Claude for more, and the reading of its answer. Plain
// TypeScript: no Deno, no SDK import, so Vitest can load it.

export type Taste = {
  members: { userId: string; name: string }[];
  records: {
    artist: string;
    title: string;
    year: number | null;
    section: string;
    status: 'wanted' | 'new_arrival' | 'owned';
    ratings: { userId: string; value: number }[];
  }[];
  suggested: { artist: string; title: string; status: 'pending' | 'added' | 'dismissed' }[];
};

export type Proposed = { artist: string; title: string; reason: string };

/** Rated records needed before Claude is asked. */
export const MIN_RATED = 5;
/** How many Claude is asked for (at most 8 are kept, so some can be dropped). */
export const ASK_FOR = 12;

const MAX_NAME = 200;
const MAX_REASON = 140;

/** Records, not ratings: non-wanted records with at least one rating. */
export function ratedCount(t: Taste): number {
  return t.records.filter((r) => r.status !== 'wanted' && r.ratings.length > 0).length;
}

export const SUGGEST_SCHEMA_OBJECT = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { artist: { type: 'string' }, title: { type: 'string' }, reason: { type: 'string' } },
        required: ['artist', 'title', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const;

/** As fun-fact's FACT_SCHEMA: the output_config `format`. */
export const SUGGEST_SCHEMA = { type: 'json_schema', schema: SUGGEST_SCHEMA_OBJECT } as const;

const SYSTEM =
  'You recommend vinyl records to a household that shares one record shelf. ' +
  'Suggest real, existing albums that suit what the members rated highly.';

function prompt(t: Taste): string {
  const names = new Map(t.members.map((m) => [m.userId, m.name]));
  const rated = t.records.filter((r) => r.ratings.length > 0);
  const lines = rated.map((r) => {
    const year = r.year !== null ? ` (${r.year})` : '';
    const who = r.ratings.map((x) => `${names.get(x.userId) ?? 'Someone'} ${x.value}`).join(', ');
    return `- ${r.artist} - ${r.title}${year} [${r.section}]: ${who}`;
  });
  const offLimits = [
    ...t.records.map((r) => `${r.artist} - ${r.title}`),
    ...t.suggested.map((s) => `${s.artist} - ${s.title}`),
  ].map((l) => `- ${l}`);
  return [
    `The shelf's members: ${t.members.map((m) => m.name).join(', ')}.`,
    '',
    'Ratings, from 1 to 5, by member:',
    ...lines,
    '',
    'A rating of 1 or 2 means the member disliked the record: steer away from similar records.',
    '',
    'Never suggest any of these, which are already owned, wanted or suggested:',
    ...offLimits,
    '',
    `Suggest ${ASK_FOR} albums the members might like. Only albums that were released on vinyl. ` +
      `For each, write a reason of at most ${MAX_REASON} characters that names the person or people ` +
      'and the records they rated highly.',
  ].join('\n');
}

/** The whole Messages API request (beta call: `betas` and `fallbacks` are beta parameters). */
export function suggestRequest(t: Taste): object {
  return {
    model: 'claude-sonnet-5-5',
    // Thinking counts against max_tokens, so leave it room.
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: SUGGEST_SCHEMA },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt(t) }],
  };
}

function name(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 && s.length <= MAX_NAME ? s : null;
}

function reason(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0) return null;
  if (s.length <= MAX_REASON) return s;
  const cut = s.slice(0, MAX_REASON - 1); // 139 characters, then the ellipsis makes 140
  const space = cut.lastIndexOf(' ');
  const head = (space > 0 ? cut.slice(0, space) : cut).trimEnd();
  return `${head}…`;
}

/** The first text block's answer. A structural type on purpose: the SDK can't be imported under Vitest.
 *  With fallbacks the content can start with `fallback` or `thinking` blocks, which are skipped. */
export function proposalsFromMessage(message: {
  stop_reason: string | null;
  content: { type: string; text?: string }[];
}): Proposed[] {
  if (message.stop_reason === 'refusal') return [];
  const block = message.content.find((b) => b.type === 'text');
  if (!block || typeof block.text !== 'string') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return [];
  }
  const list = (parsed as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(list)) return [];
  const out: Proposed[] = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const artist = name(o.artist);
    const title = name(o.title);
    const why = reason(o.reason);
    if (artist !== null && title !== null && why !== null) out.push({ artist, title, reason: why });
  }
  return out;
}
