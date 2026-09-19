import { useEffect, useState } from 'react';
import type { ShelfSource } from './backend';
import { db as defaultDb, type ShelfDB } from './db';
import { pullShelf } from './sync';

export type SyncStatus = { lastSyncedAt: string | null; error: string | null };

const EVERY_MS = 60_000;

/** Pull the shelf on open, when signal comes back, when the app returns to the front, and every minute while visible. */
export function useSync(source: ShelfSource, shelfId: string, database: ShelfDB = defaultDb): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ lastSyncedAt: null, error: null });

  useEffect(() => {
    let live = true;
    let running = false;

    async function run() {
      if (running) return;
      running = true;
      try {
        await pullShelf(database, source, shelfId);
        if (live) setStatus({ lastSyncedAt: new Date().toISOString(), error: null });
      } catch (e) {
        if (live) setStatus((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      } finally {
        running = false;
      }
    }

    const whenVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const onOnline = () => void run();

    void run();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', whenVisible);
    const timer = window.setInterval(whenVisible, EVERY_MS);
    return () => {
      live = false;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', whenVisible);
      window.clearInterval(timer);
    };
  }, [source, shelfId, database]);

  return status;
}
