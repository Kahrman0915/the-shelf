import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { db } from '@/data/db';
import { FUN_FACT_FAILED_PREFIX, FUN_FACT_NONE_PREFIX, heldBack, readFunFactQueue, runFunFacts } from '@/data/funFacts';
import { useBackend } from './BackendContext';
import { useCurrentShelf } from './CurrentShelf';
import { useSyncStatus } from './SyncContext';

/** How long after a failed try the queue is worked once more. */
export const FUN_FACT_RETRY_MS = 60_000;

/** After a held-back record's time, how long before its run: a timer may fire a moment early. */
const DUE_MARGIN_MS = 100;

/**
 * Works the fun-fact queue: when a record is queued (one already waiting at mount counts), when a record
 * held back until later is due, and when the signal comes back. Nothing runs until this session's first
 * sync has finished, so a fact typed on the other phone arrives before this one asks for its own. A try
 * counted on a record doesn't start another run at once: when a run ends with one, a single run follows
 * FUN_FACT_RETRY_MS later (any newer run replaces it). Mount once, in the app shell.
 */
export function useFunFacts(): void {
  const backend = useBackend();
  const { userId } = useCurrentShelf();
  const { runNow, lastSyncedAt } = useSyncStatus();
  const synced = lastSyncedAt !== null;
  const queue = useLiveQuery(() => readFunFactQueue(db), []);
  const gate = useRef(false);

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
      if (!gate.current) return;
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

  useEffect(() => {
    gate.current = synced;
  }, [synced]);

  // The records on the queue when it was last looked at; a run starts only when one not among them appears.
  // Before the first sync nothing is looked at, so the queue as it stands then starts one run.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!queue || !synced) return;
    const ids = queue.map((e) => e.recordId);
    const fresh = ids.some((id) => !seen.current.has(id));
    seen.current = new Set(ids);
    if (fresh) run.current();
  }, [queue, synced]);

  // The first record held back until later starts a run once it's due.
  useEffect(() => {
    if (!queue || !synced) return;
    const now = Date.now();
    const due = Math.min(...queue.filter((e) => heldBack(e, now)).map((e) => e.notBefore ?? Infinity));
    if (!Number.isFinite(due)) return;
    const timer = setTimeout(() => run.current(), due - now + DUE_MARGIN_MS);
    return () => clearTimeout(timer);
  }, [queue, synced]);
}

export type FunFactStatus = 'queued' | 'none' | 'failed' | 'idle';

/** Whether a record is waiting for a fun fact, had none found last time, couldn't reach Claude on either
 *  automatic try, or none of those; undefined while loading. */
export function useFunFactStatus(recordId: string): FunFactStatus | undefined {
  return useLiveQuery(async (): Promise<FunFactStatus> => {
    const [queue, none, failed] = await Promise.all([
      readFunFactQueue(db),
      db.meta.get(`${FUN_FACT_NONE_PREFIX}${recordId}`),
      db.meta.get(`${FUN_FACT_FAILED_PREFIX}${recordId}`),
    ]);
    if (queue.some((e) => e.recordId === recordId)) return 'queued';
    if (failed) return 'failed';
    return none ? 'none' : 'idle';
  }, [recordId]);
}
