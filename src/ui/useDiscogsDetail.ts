import { useEffect, useState } from 'react';
import { useBackend } from '@/app/BackendContext';
import type { FoundRecord } from '@/data/backend';
import type { Suggestion } from '@/data/schema';
import { normalise } from '@/domain/search';

/** Discogs terms: cover and album details are looked up live and kept in memory only, never stored. `null` = looked up, no match. */
const cache = new Map<string, FoundRecord | null>();
const inFlight = new Set<string>();

export const clearDiscogsDetailCache = () => {
  cache.clear();
  inFlight.clear();
};

/** Discogs writes `Bill Evans (2)` for the second artist of that name, and `*` for a name variation. */
const plainArtist = (a: string) => a.replace(/\*/g, '').replace(/ \(\d+\)$/, '');

function pick(s: Suggestion, results: FoundRecord[]): FoundRecord | null {
  if (s.discogsReleaseId !== null) {
    const same = results.find((r) => r.releaseId === s.discogsReleaseId);
    if (same) return same;
  }
  const artist = normalise(s.artist);
  const title = normalise(s.title);
  return results.find((r) => normalise(plainArtist(r.artist)) === artist && normalise(r.title) === title) ?? null;
}

/** Cover and album details for the suggestions shown, looked up one at a time. A failed lookup leaves no detail and is tried again on a later visit. */
export function useDiscogsDetail(suggestions: Suggestion[]): Map<string, FoundRecord> {
  const backend = useBackend();
  const [, setTick] = useState(0);
  const key = suggestions.map((s) => `${s.id}|${s.artist}|${s.title}|${s.discogsReleaseId}`).join('\n');

  useEffect(() => {
    let cancelled = false;
    const todo = suggestions.filter((s) => !cache.has(s.id) && !inFlight.has(s.id));
    void (async () => {
      for (const s of todo) {
        if (cancelled) return;
        inFlight.add(s.id);
        try {
          cache.set(s.id, pick(s, await backend.searchDiscogs(`${s.artist} ${s.title}`)));
          if (!cancelled) setTick((n) => n + 1);
        } catch {
          // Offline, slow or rate-limited: the card stays plain. Not cached, so a later visit may try again.
        } finally {
          inFlight.delete(s.id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, key]);

  const found = new Map<string, FoundRecord>();
  for (const s of suggestions) {
    const d = cache.get(s.id);
    if (d) found.set(s.id, d);
  }
  return found;
}
