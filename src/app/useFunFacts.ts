import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { db } from '@/data/db';
import { FUN_FACT_NONE_PREFIX, readFunFactQueue, runFunFacts } from '@/data/funFacts';
import { useBackend } from './BackendContext';
import { useCurrentShelf } from './CurrentShelf';
import { useSyncStatus } from './SyncContext';

/** How long after a failed try the queue is worked once more. */
export const FUN_FACT_RETRY_MS = 60_000;

/**
 * Works the fun-fact queue: when a record is queued (one already waiting at mount counts) and when the
 * signal comes back. A try counted on a record doesn't start another run at once: when a run ends with
 * one, a single run follows FUN_FACT_RETRY_MS later (any newer run replaces it). Mount once, in the app shell.
 */
export function useFunFacts(): void {
  const backend = useBackend();
  const { userId } = useCurrentShelf();
  const { runNow } = useSyncStatus();
  const queued = useLiveQuery(async () => (await readFunFactQueue(db)).map((e) => e.recordId), []);

  const run = useRef<() => void>(() => {});
  const retry = useRef<{ timer: ReturnType<typeof setTimeout> | null; latest: number; mounted: boolean }>({
    timer: null,
    latest: 0,
    mounted: false,
  });
  useEffect(() => {
    const r = retry.current;
    const stopTimer = () => {
      if (r.timer !== null) clearTimeout(r.timer);
      r.timer = null;
    };
    run.current = () => {
      stopTimer();
      const mine = ++r.latest;
      runFunFacts(db, backend, { me: userId }, runNow)
        .then(({ retryLater }) => {
          // Runs finish in the order they started, so only the newest one decides about a retry.
          if (mine !== r.latest || !r.mounted || !retryLater) return;
          stopTimer();
          r.timer = setTimeout(() => run.current(), FUN_FACT_RETRY_MS);
        })
        .catch(console.error);
    };
  }, [backend, userId, runNow]);

  useEffect(() => {
    const r = retry.current;
    r.mounted = true;
    return () => {
      r.mounted = false;
      if (r.timer !== null) clearTimeout(r.timer);
      r.timer = null;
    };
  }, []);

  useEffect(() => {
    const onOnline = () => run.current();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // The records on the queue when it was last looked at; a run starts only when one not among them appears.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!queued) return;
    const fresh = queued.some((id) => !seen.current.has(id));
    seen.current = new Set(queued);
    if (fresh) run.current();
  }, [queued]);
}

export type FunFactStatus = 'queued' | 'none' | 'idle';

/** Whether a record is waiting for a fun fact, had none found last time, or neither; undefined while loading. */
export function useFunFactStatus(recordId: string): FunFactStatus | undefined {
  return useLiveQuery(async (): Promise<FunFactStatus> => {
    const [queue, none] = await Promise.all([readFunFactQueue(db), db.meta.get(`${FUN_FACT_NONE_PREFIX}${recordId}`)]);
    if (queue.some((e) => e.recordId === recordId)) return 'queued';
    return none ? 'none' : 'idle';
  }, [recordId]);
}
