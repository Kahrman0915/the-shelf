import { useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import type { CurrentShelf } from './CurrentShelf';

const unsentMessage = (n: number) =>
  n === 1
    ? '1 change hasn’t reached the shelf yet. Signing out deletes it.'
    : `${n} changes haven’t reached the shelf yet. Signing out deletes them.`;

type Props = Pick<CurrentShelf, 'signOut' | 'signOutAndDelete'> & Pick<ComponentProps<typeof Button>, 'variant' | 'className'>;

/** Sign out, sending waiting changes first; if any are still unsent, ask before deleting them. */
export function SignOutButton({ signOut, signOutAndDelete, variant, className }: Props) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [unsent, setUnsent] = useState(0);

  async function start() {
    setBusy(true);
    try {
      const left = await signOut();
      if (left) {
        setUnsent(left.unsent);
        setAsking(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} className={className} disabled={busy} onClick={() => void start()}>
        Sign out
      </Button>
      <ConfirmDialog
        open={asking}
        message={unsentMessage(unsent)}
        confirmLabel="Sign out and delete"
        cancelLabel="Stay signed in"
        danger="confirm"
        onConfirm={() => void signOutAndDelete()}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
