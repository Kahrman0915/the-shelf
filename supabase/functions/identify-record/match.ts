// Finds a sleeve's record on Discogs: barcode, then catalog number, then name.
import type { Answer } from '../_shared/discogs.ts';
import type { FoundRecord, Identified, Read } from '../_shared/shape.ts';

export type { Identified };

type Search = (params: Record<string, string>) => Promise<Answer>;

export async function findMatch(
  read: Read,
  search: Search,
): Promise<{ status: number; body: Identified | { error: string } }> {
  const steps: { params: Record<string, string>; canBeExact: boolean }[] = [];
  if (read.barcode) steps.push({ params: { barcode: read.barcode }, canBeExact: true });
  if (read.catalog && read.artist) {
    steps.push({ params: { catno: read.catalog, artist: read.artist, format: 'Vinyl' }, canBeExact: true });
  }
  if (read.artist && read.title) {
    steps.push({ params: { q: `${read.artist} ${read.title}`, format: 'Vinyl' }, canBeExact: false });
  }

  for (const step of steps) {
    const answer = await search(step.params);
    if (answer.status === 429) return { status: 429, body: { error: 'rate-limited' } };
    if (answer.status !== 200) return { status: 502, body: { error: 'down' } };
    const results = (answer.body as { results?: FoundRecord[] } | null)?.results;
    if (!Array.isArray(results)) return { status: 502, body: { error: 'down' } };
    if (results.length > 0) {
      const match = step.canBeExact && results.length === 1 ? 'exact' : 'several';
      return { status: 200, body: { read, match, results } };
    }
  }
  return { status: 200, body: { read, match: 'none', results: [] } };
}
