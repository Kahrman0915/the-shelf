import { useEffect, useRef, useState } from 'react';
import { useBackend } from '@/app/BackendContext';
import { DISCOGS_MESSAGES, NO_SIGNAL, type FoundRecord } from '@/data/backend';
import { DISCOGS_TIMEOUT_MS } from '@/data/supabaseBackend';
import type { Suggestion } from '@/data/schema';
import { normalise } from '@/domain/search';

/** Discogs terms: cover and album details are looked up live and kept in memory only, never stored. `null` = looked up, no match. */
const cache = new Map<string, FoundRecord | null>();
const inFlight = new Set<string>();

export const clearDiscogsDetailCache = () => {
  cache.clear();
  inFlight.clear();
};

const TIMED_OUT = 'Discogs lookup timed out';
/** Rate-limited or offline: the limit is shared by everyone, so the rest of this run doesn't try. */
const stopsRun = (e: unknown) => e instanceof Error && (e.message === DISCOGS_MESSAGES.rateLimited || e.message === NO_SIGNAL);

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMED_OUT)), DISCOGS_TIMEOUT_MS);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

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
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const key = suggestions.map((s) => `${s.id}|${s.artist}|${s.title}|${s.discogsReleaseId}`).join('\n');

  useEffect(() => {
    let cancelled = false;
    const todo = suggestions.filter((s) => !cache.has(s.id) && !inFlight.has(s.id));
    void (async () => {
      for (const s of todo) {
        if (cancelled || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
        inFlight.add(s.id);
        try {
          cache.set(s.id, pick(s, await withTimeout(backend.searchDiscogs(`${s.artist} ${s.title}`))));
          // Re-render even if a newer run took over: this result is in the cache for whoever is showing it.
          if (mounted.current) setTick((n) => n + 1);
        } catch (e) {
          // Offline, slow or rate-limited: the card stays plain. Not cached, so a later visit may try again.
          if (stopsRun(e)) return;
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
