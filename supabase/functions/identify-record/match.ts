// Finds a sleeve's record on Discogs: barcode, then catalog number, then name.
import type { Answer } from '../_shared/discogs.ts';
import type { FoundRecord, Identified, Read } from '../_shared/shape.ts';
import { discogsTimeoutMs } from './deadline.ts';

export type { Identified };

/** One Discogs search, given at most `timeoutMs`. */
type Search = (params: Record<string, string>, timeoutMs: number) => Promise<Answer>;

/**
 * `msLeft`: how much of the request's time budget is left (deadline.ts). Once too little is left for
 * another search, or a search was cut short by it, the answer is what Claude read with no match, so the
 * app still fills the Find box with it.
 */
export async function findMatch(
  read: Read,
  search: Search,
  msLeft: () => number = () => Infinity,
): Promise<{ status: number; body: Identified | { error: string } }> {
  const none = { status: 200, body: { read, match: 'none' as const, results: [] } };
  const steps: { params: Record<string, string>; canBeExact: boolean }[] = [];
  // Vinyl only: a CD sharing the barcode must never be an exact vinyl match.
  if (read.barcode) steps.push({ params: { barcode: read.barcode, format: 'Vinyl' }, canBeExact: true });
  if (read.catalog && read.artist) {
    steps.push({ params: { catno: read.catalog, artist: read.artist, format: 'Vinyl' }, canBeExact: true });
  }
  if (read.artist && read.title) {
    steps.push({ params: { q: `${read.artist} ${read.title}`, format: 'Vinyl' }, canBeExact: false });
  }

  for (const step of steps) {
    const timeoutMs = discogsTimeoutMs(msLeft());
    if (timeoutMs <= 0) return none;
    const answer = await search(step.params, timeoutMs);
    if (answer.status === 429) return { status: 429, body: { error: 'rate-limited' } };
    if (answer.status !== 200) return discogsTimeoutMs(msLeft()) <= 0 ? none : { status: 502, body: { error: 'down' } };
    const body = answer.body as { results?: FoundRecord[]; total?: unknown } | null;
    const results = body?.results;
    if (!Array.isArray(results)) return { status: 502, body: { error: 'down' } };
    if (results.length > 0) {
      // Discogs' own count, where it gives one: a second release that couldn't be shaped still means two.
      const onlyOne = results.length === 1 && (typeof body?.total !== 'number' || body.total === 1);
      const match = step.canBeExact && onlyOne ? 'exact' : 'several';
      return { status: 200, body: { read, match, results } };
    }
  }
  return none;
}
