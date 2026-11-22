import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';

const TIPS = [
  'Lay the sleeve flat on a plain surface that’s darker or lighter than the sleeve, so its edges stand out.',
  'Fit the whole sleeve in, with a little space around all four edges.',
  'Hold the phone straight above it.',
  'Use even light, with no glare or shadow across it.',
];

/** The first-time (and any-time) advice for taking a sharp cover photo. */
/** Only the Got it button calls onDone; Escape or a tap outside calls onDismiss, which just closes. */
export function PhotoTips({ open, onDone, onDismiss }: { open: boolean; onDone: () => void; onDismiss?: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onDismiss?.()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl bg-surface-raised p-5 text-ink shadow-lg"
        >
          <Dialog.Title className="text-[17px] leading-6 font-semibold">Tips for a sharp cover</Dialog.Title>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-6">
            {TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ol>
          <Button onClick={onDone} className="h-12 w-full rounded-lg font-display text-[22px] tracking-[0.04em]">
            Got it
          </Button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
