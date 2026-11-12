import { useEffect, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

/**
 * Guards leaving a form with unsaved changes (spec §5.4). `leave(go)` runs `go` straight away when clean, and asks
 * "Discard your changes?" first when dirty; render `dialog` once in the screen. While dirty, reloading or closing the
 * tab is held too. (The system back gesture isn't guarded; see the plan's ruling.)
 */
export function useLeaveGuard(dirty: boolean): { leave: (go: () => void) => void; dialog: ReactNode } {
  // Where to go once the person agrees to discard: null means no question is open.
  const [leaving, setLeaving] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [dirty]);

  const leave = (go: () => void) => (dirty ? setLeaving(() => go) : go());

  const dialog = (
    <ConfirmDialog
      open={leaving !== null}
      message="Discard your changes?"
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      danger="confirm"
      onConfirm={() => {
        const go = leaving;
        setLeaving(null);
        go?.();
      }}
      onCancel={() => setLeaving(null)}
    />
  );

  return { leave, dialog };
}
