import { AlertDialog } from 'radix-ui';
import { Button } from '@/components/ui/button';

const PRIMARY = 'h-12 w-full rounded-lg font-display text-[22px] tracking-[0.04em]';
const DANGER = 'h-12 w-full rounded-lg border-[1.5px] border-brick bg-transparent text-[15px] font-semibold text-brick-ink hover:bg-brick-soft';

type Props = {
  open: boolean;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Which button deletes or loses something. It gets the brick colour; the other is the main bourbon button, shown first. */
  danger: 'confirm' | 'cancel';
  onConfirm: () => void;
  onCancel: () => void;
};

/** Asks before something that can't be taken back. Escape, or the cancel button, calls onCancel. */
export function ConfirmDialog({ open, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: Props) {
  const confirm = (
    <Button key="confirm" className={danger === 'confirm' ? DANGER : PRIMARY} onClick={onConfirm}>
      {confirmLabel}
    </Button>
  );
  const cancel = (
    <AlertDialog.Cancel key="cancel" asChild>
      <Button className={danger === 'cancel' ? DANGER : PRIMARY}>{cancelLabel}</Button>
    </AlertDialog.Cancel>
  );

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-xl bg-surface-raised p-5 text-ink shadow-lg"
        >
          <AlertDialog.Title className="text-[17px] leading-6 font-semibold">{message}</AlertDialog.Title>
          <div className="flex flex-col gap-2">{danger === 'confirm' ? [cancel, confirm] : [confirm, cancel]}</div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
