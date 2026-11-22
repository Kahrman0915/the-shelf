import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';

const PRIMARY = 'h-12 w-full rounded-lg font-display text-[22px] tracking-[0.04em]';
const SECOND = 'h-12 w-full rounded-lg text-[15px] font-semibold';

type Props = {
  open: boolean;
  /** The record on the shelf already has a photo on a side these photos would fill. */
  replacing: boolean;
  onAdd: () => void;
  onCopy: () => void;
  onClose: () => void;
};

/** Photos are waiting and the record picked is already on the shelf: put them on that one, or save a second copy.
 *  Escape or a tap outside calls onClose, which saves nothing (unlike ConfirmDialog, where Escape is its cancel action). */
export function PhotoDuplicateDialog({ open, replacing, onAdd, onCopy, onClose }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-xl bg-surface-raised p-5 text-ink shadow-lg"
        >
          <Dialog.Title className="text-[17px] leading-6 font-semibold">
            {replacing ? 'Replace the photos on the one on your shelf?' : 'Add these photos to the one on your shelf?'}
          </Dialog.Title>
          <div className="flex flex-col gap-2">
            <Button className={PRIMARY} onClick={onAdd}>
              {replacing ? 'Replace them' : 'Add to that one'}
            </Button>
            <Button variant="outline" className={SECOND} onClick={onCopy}>
              Save a second copy
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
