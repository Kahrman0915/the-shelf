import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackend } from '@/app/BackendContext';
import { BackendError, NO_SIGNAL, type Identified } from '@/data/backend';
import { PHOTO_SIDES, type Drafts } from '@/data/photos';
import { messageFor } from './useSavedOffer';

/** How long the photos must stay the same before they're sent. The drafts reach the Add screen through two
 *  live queries that land a moment apart, so "ready" can briefly pair with the drafts from before the last
 *  photo landed; waiting this long sends one reading of the finished set, not two. */
export const SETTLE_MS = 250;

export type ReadState = 'idle' | 'reading' | 'offline' | 'failed';

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  // Through views, which read a buffer from any realm.
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** The same photos, though perhaps not the same objects: drafts put back come back as new copies. */
function samePhotos(a: Drafts, b: Drafts): boolean {
  return PHOTO_SIDES.every((side) => {
    const x = a[side];
    const y = b[side];
    return x === undefined || y === undefined ? x === y : sameBytes(x.bytes, y.bytes);
  });
}

/**
 * Has Claude read the sleeve once the photos are done: each drafts object (by identity) is read once.
 * Only the latest reading answers: one cancelled, overtaken by new drafts, interrupted by the photos
 * no longer being ready (a retake under way, say) or outlived by the screen is dropped. Drafts whose
 * reading was dropped that way, before it answered, are read again when they're ready again; drafts
 * already answered, skipped or set aside by the person aren't.
 */
export function useReadSleeve({ drafts, ready, onAnswer }: { drafts: Drafts | null; ready: boolean; onAnswer: (a: Identified) => void }) {
  const backend = useBackend();
  const [state, setState] = useState<ReadState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  // The drafts already read (or skipped, or found offline): they aren't read again unless asked.
  const handled = useRef<Drafts | null>(null);
  // A reading of `handled` is on its way and hasn't answered.
  const pending = useRef(false);
  // After an Undo: the photos it hands back, which count as read when they come back. Only the next new
  // drafts are compared, so a skip whose photos never came back doesn't swallow a later sleeve.
  const skip = useRef<Drafts | null>(null);
  // Every reading gets a turn; one whose turn has passed is dropped.
  const turn = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const answer = useRef(onAnswer);
  const current = useRef<{ drafts: Drafts | null; ready: boolean; state: ReadState }>({ drafts, ready, state });
  useEffect(() => {
    answer.current = onAnswer;
    current.current = { drafts, ready, state };
  });

  /** Drop any reading under way or about to start. */
  const drop = useCallback(() => {
    turn.current++;
    pending.current = false;
    clearTimeout(timer.current);
  }, []);

  const read = useCallback(
    (these: Drafts) => {
      drop();
      const mine = turn.current;
      const front = these.front;
      if (!front) return;
      if (isOffline()) {
        setState('offline');
        setMessage(null);
        return;
      }
      setState('reading');
      setMessage(null);
      pending.current = true;
      timer.current = setTimeout(() => {
        backend.identifyRecord(front.bytes, these.back?.bytes ?? null).then(
          (a) => {
            if (mine !== turn.current) return;
            pending.current = false;
            setState('idle');
            answer.current(a);
          },
          (err: unknown) => {
            if (mine !== turn.current) return;
            pending.current = false;
            if (err instanceof BackendError && err.message === NO_SIGNAL) {
              setState('offline');
            } else {
              setState('failed');
              setMessage(messageFor(err));
            }
          },
        );
      }, SETTLE_MS);
    },
    [backend, drop],
  );

  useEffect(() => {
    if (!ready || !drafts?.front) {
      // Not ready (no photos, or a photo being taken): a reading under way no longer fits. Its drafts are
      // read again if they come back unanswered (a retake that failed); so are drafts found offline,
      // which were never sent. Answered or skipped drafts stay handled.
      if (pending.current || state === 'offline') {
        drop();
        handled.current = null;
        setState('idle');
      }
      return;
    }
    if (drafts === handled.current) return;
    handled.current = drafts;
    const skipping = skip.current;
    skip.current = null;
    if (skipping && samePhotos(drafts, skipping)) {
      drop();
      setState('idle');
      setMessage(null);
      return;
    }
    read(drafts);
    // `state` is read, not watched: only the photos changing should run this.
  }, [drafts, ready, read, drop]);

  useEffect(() => drop, [drop]);

  /** Look it up / Try again: read the photos now showing. */
  const retry = useCallback(() => {
    const { drafts: now, ready: isReady } = current.current;
    if (!isReady || !now?.front) return;
    handled.current = now;
    read(now);
  }, [read]);

  // Found offline: the signal coming back reads them, as Look it up would. Read once that way: they're
  // handled from then on, and a reading that finds no signal again waits for the next time it's back.
  useEffect(() => {
    const onOnline = () => {
      if (current.current.state === 'offline') retry();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [retry]);

  /** The person searched for themselves: the reading's answer would only get in the way. */
  const cancel = useCallback(() => {
    drop();
    setState('idle');
    setMessage(null);
  }, [drop]);

  /** Undo of a recognised save: the drafts it hands back aren't read again, which would only save the same pressing. */
  const skipNext = useCallback((undone: Drafts) => {
    skip.current = undone;
  }, []);

  // While the photos aren't ready, nothing is being read: an earlier failure shows again if they come back as they were.
  const showing = ready && !!drafts?.front;
  return { state: showing ? state : 'idle', message: showing ? message : null, retry, cancel, skipNext };
}
