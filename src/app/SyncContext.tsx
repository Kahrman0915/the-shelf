import { createContext, useContext, type ReactNode } from 'react';
import type { ShelfSource } from '@/data/backend';
import { useSync, type SyncStatus } from '@/data/useSync';

const SyncContext = createContext<SyncStatus>({ lastSyncedAt: null, error: null });

export function SyncProvider({ source, shelfId, children }: { source: ShelfSource; shelfId: string; children: ReactNode }) {
  const status = useSync(source, shelfId);
  return <SyncContext.Provider value={status}>{children}</SyncContext.Provider>;
}

export function useSyncStatus(): SyncStatus {
  return useContext(SyncContext);
}

export function SyncNotice() {
  const { error } = useSyncStatus();
  if (!error) return null;
  return (
    <p role="status" className="px-4 pb-3 text-[15px] leading-[22px] text-ink-muted">
      Couldn’t reach the shelf. Showing what’s on this phone.
    </p>
  );
}
