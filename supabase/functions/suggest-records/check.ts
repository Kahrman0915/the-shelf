// Checks Claude's suggestions against what the shelf has and against Discogs. Plain TypeScript.
import { normalise } from '../_shared/normalise.ts';
import type { Answer } from '../_shared/discogs.ts';
import type { FoundRecord } from '../_shared/shape.ts';
import { discogsTimeoutMs } from './deadline.ts';
import type { Proposed } from './taste.ts';

export type Kept = Proposed & { discogsReleaseId: number; discogsGenres: string[]; discogsStyles: string[] };

/** The same-record test: artist and title both match after normalising. */
export const keyOf = (artist: string, title: string): string => `${normalise(artist)}|${normalise(title)}`;

/** Discogs writes `Bill Evans (2)` for the second artist of that name, and `*` for a name variation. */
const plainArtist = (a: string): string => a.replace(/\*/g, '').replace(/ \(\d+\)$/, '');

export async function checkProposals(
  proposed: Proposed[],
  taken: Set<string>,
  search: (params: Record<string, string>, timeoutMs: number) => Promise<Answer>,
  msLeft: () => number,
  keep = 8,
): Promise<Kept[]> {
  const seen = new Set<string>(taken);
  const kept: Kept[] = [];
  for (const p of proposed) {
    const key = keyOf(p.artist, p.title);
    if (seen.has(key)) continue;
    seen.add(key);
    const timeout = discogsTimeoutMs(msLeft());
    if (timeout <= 0 || kept.length >= keep) break;
    const answer = await search({ q: `${p.artist} ${p.title}`, format: 'Vinyl' }, timeout);
    if (answer.status !== 200) break;
    const results = (answer.body as { results?: FoundRecord[] } | null)?.results ?? [];
    const hit = results.find((r) => keyOf(plainArtist(r.artist), r.title) === key);
    if (hit) kept.push({ ...p, discogsReleaseId: hit.releaseId, discogsGenres: hit.genres, discogsStyles: hit.styles });
  }
  return kept;
}
