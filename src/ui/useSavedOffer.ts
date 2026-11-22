import { useCallback, useEffect, useRef, useState } from 'react';
import { useSyncStatus } from '@/app/SyncContext';
import { UNDO_WINDOW_MS } from '@/app/UndoContext';
import { perform } from '@/data/actions';
import { BackendError, NO_SIGNAL } from '@/data/backend';
import { db } from '@/data/db';
import type { NewPostcard } from '@/data/outbox';
import type { Drafts } from '@/data/photos';

/** A save that can still be undone: what to say, how to undo it, the photos it used, and what to send once it can't be undone.
 *  A save Claude recognised also has the pressing it saved (`detail`, a second line) and what it read, as words for
 *  the Find box (`readWords`), so Undo can search those instead of reading the sleeve again. */
export type SavedOffer = { text: string; undo: NewPostcard[]; drafts: Drafts | null; later: NewPostcard[]; detail?: string | null; readWords?: string | null };

export const NEEDS_SIGNAL = 'Needs signal';

export function messageFor(err: unknown): string {
  if (err instanceof BackendError && err.message === NO_SIGNAL) return NEEDS_SIGNAL;
  return err instanceof Error ? err.message : String(err);
}

/**
 * The inline "On the shelf: … · Undo" for the save just made, for UNDO_WINDOW_MS.
 * An offer that ends without a successful Undo (its time runs out, a newer one replaces it, or the screen goes)
 * sends its `later` postcards. After a successful Undo, `onUndone` gets the offer, drafts and all.
 */
export function useSavedOffer({ onUndone }: { onUndone: (undone: SavedOffer) => void }) {
  const { runNow } = useSyncStatus();
  const [saved, setSaved] = useState<SavedOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The offer still open, kept outside state so the timer, a newer offer and unmount all see the same one.
  const open = useRef<SavedOffer | null>(null);
  // The offer whose Undo is on its way: if it ends meanwhile, its `later` waits to see whether the Undo worked.
  const undoing = useRef<SavedOffer | null>(null);
  const undone = useRef(onUndone);
  const runNowRef = useRef(runNow);
  useEffect(() => {
    undone.current = onUndone;
    runNowRef.current = runNow;
  });

  const sendLater = useCallback((s: SavedOffer) => {
    // A failed write here only leaves an old photo file in storage; nobody needs to see that.
    if (s.later.length > 0) perform(db, s.later, runNowRef.current).catch(() => {});
  }, []);

  /** Close the open offer without Undo: from now on it can't be undone, so send what was waiting for that. */
  const close = useCallback(() => {
    clearTimeout(timer.current);
    const ending = open.current;
    open.current = null;
    if (ending && ending !== undoing.current) sendLater(ending);
  }, [sendLater]);

  useEffect(() => close, [close]);

  const offer = useCallback(
    (s: SavedOffer) => {
      close();
      open.current = s;
      setError(null);
      setSaved(s);
      timer.current = setTimeout(() => {
        close();
        setSaved(null);
      }, UNDO_WINDOW_MS);
    },
    [close],
  );

  const undo = useCallback(async () => {
    const s = open.current;
    if (!s || undoing.current) return;
    undoing.current = s;
    clearTimeout(timer.current);
    try {
      await perform(db, s.undo, runNowRef.current);
      // Undone: what `later` would have cleaned up is still in use, so it is never sent.
      if (open.current === s) {
        open.current = null;
        setSaved(null);
        setError(null);
      }
      undone.current(s);
    } catch (err) {
      if (open.current === s) setError(messageFor(err));
      else sendLater(s);
    } finally {
      undoing.current = null;
    }
  }, [sendLater]);

  return { saved, error, offer, undo };
}
