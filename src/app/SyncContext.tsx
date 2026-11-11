import { createContext, useContext, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { ShelfSource, ShelfWriter } from '@/data/backend';
import { useOutbox } from '@/data/hooks';
import { useSync, type SyncStatus } from '@/data/useSync';

type SyncValue = SyncStatus & { runNow(): void; retry(seq: number): Promise<void>; discard(seq: number): Promise<void> };

export const SyncContext = createContext<SyncValue>({
  lastSyncedAt: null,
  problem: null,
  runNow() {},
  retry: async () => {},
  discard: async () => {},
});

export function SyncProvider({
  backend,
  shelfId,
  children,
}: {
  backend: ShelfSource & ShelfWriter;
  shelfId: string;
  children: ReactNode;
}) {
  const sync = useSync(backend, shelfId);
  return <SyncContext.Provider value={sync}>{children}</SyncContext.Provider>;
}

export function useSyncStatus(): SyncValue {
  return useContext(SyncContext);
}

const LINE = 'px-4 pb-3 text-[15px] leading-[22px]';

export function SyncNotice() {
  const { problem, retry, discard } = useSyncStatus();
  const outbox = useOutbox() ?? [];
  const rejected = outbox.filter((p) => p.state === 'rejected');
  const waiting = outbox.filter((p) => p.state === 'waiting').length;
  const oldest = rejected[0];

  let second: string | null = null;
  if (waiting > 0) second = `Saved on this phone · ${waiting} waiting to send`;
  else if (problem?.kind === 'no-signal') second = 'Couldn’t reach the shelf. Showing what’s on this phone.';
  else if (problem?.kind === 'failed') second = problem.message;

  if (!oldest && !second) return null;
  return (
    <div role="status">
      {oldest && (
        <div className={LINE}>
          <p>
            {rejected.length === 1 ? '1 change' : `${rejected.length} changes`} couldn’t be saved: {oldest.reason}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" className="h-12 px-5" onClick={() => void retry(oldest.seq)}>
              Try again
            </Button>
            <Button variant="ghost" className="h-12 px-5" onClick={() => void discard(oldest.seq)}>
              Discard
            </Button>
          </div>
        </div>
      )}
      {second && <p className={`${LINE} text-ink-muted`}>{second}</p>}
    </div>
  );
}
