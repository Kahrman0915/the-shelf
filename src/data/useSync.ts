import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendError, NO_SIGNAL, type ShelfSource, type ShelfWriter } from './backend';
import { discardPostcard, retryPostcard, syncOnce } from './courier';
import { db as defaultDb, type ShelfDB } from './db';
import { RowError } from './rowMapping';

export type SyncProblem = { kind: 'no-signal' } | { kind: 'failed'; message: string };
export type SyncStatus = { lastSyncedAt: string | null; problem: SyncProblem | null };

const EVERY_MS = 60_000;
const NO_ACCESS = 'You don’t have access to this shelf any more.';

export function describeSyncError(e: unknown): SyncProblem {
  if (e instanceof BackendError && e.message === NO_SIGNAL) return { kind: 'no-signal' };
  if (e instanceof RowError) {
    return { kind: 'failed', message: `The shelf sent something this app can’t read: ${e.problems[0]}` };
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/permission denied/i.test(message)) return { kind: 'failed', message: NO_ACCESS };
  return { kind: 'failed', message };
}

type Actions = { runNow(): void; retry(seq: number): Promise<void>; discard(seq: number): Promise<void> };

/**
 * Send waiting changes, then pull the shelf: on open, when signal comes back, when the app returns
 * to the front, and every minute while visible. Sync runs, retry and discard all go through one
 * queue, so none of them ever overlaps another.
 */
export function useSync(
  backend: ShelfSource & ShelfWriter,
  shelfId: string,
  database: ShelfDB = defaultDb,
): SyncStatus & Actions {
  const [status, setStatus] = useState<SyncStatus>({ lastSyncedAt: null, problem: null });
  const api = useRef<Actions>({ runNow() {}, retry: async () => {}, discard: async () => {} });

  useEffect(() => {
    let live = true;
    let tail: Promise<unknown> = Promise.resolve();
    let syncQueued = false;

    /** Runs the task after everything queued before it. Never rejects: a failure becomes the problem (and resolves false). */
    function exclusive(task: () => Promise<void>): Promise<boolean> {
      const next = tail.then(async () => {
        try {
          await task();
          return true;
        } catch (e) {
          if (live) setStatus((s) => ({ ...s, problem: describeSyncError(e) }));
          return false;
        }
      });
      tail = next;
      return next;
    }

    /** One run is queued at a time while waiting; one asked for mid-run runs once more afterwards. */
    function sync(): Promise<boolean> {
      if (syncQueued) return tail as Promise<boolean>;
      syncQueued = true;
      return exclusive(async () => {
        syncQueued = false;
        const result = await syncOnce(database, backend, shelfId);
        if (!live) return;
        if (result.noSignal) setStatus((s) => ({ ...s, problem: { kind: 'no-signal' } }));
        else setStatus({ lastSyncedAt: new Date().toISOString(), problem: null });
      });
    }

    api.current = {
      runNow: () => void sync(),
      retry: async (seq) => {
        if (await exclusive(() => retryPostcard(database, seq))) await sync();
      },
      discard: async (seq) => {
        await exclusive(async () => {
          await discardPostcard(database, backend, shelfId, seq);
          if (live) setStatus({ lastSyncedAt: new Date().toISOString(), problem: null });
        });
      },
    };

    const whenVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    const onOnline = () => void sync();

    void sync();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', whenVisible);
    const timer = window.setInterval(whenVisible, EVERY_MS);
    return () => {
      live = false;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', whenVisible);
      window.clearInterval(timer);
    };
  }, [backend, shelfId, database]);

  const runNow = useCallback(() => api.current.runNow(), []);
  const retry = useCallback((seq: number) => api.current.retry(seq), []);
  const discard = useCallback((seq: number) => api.current.discard(seq), []);
  return { ...status, runNow, retry, discard };
}
