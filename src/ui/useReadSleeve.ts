import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackend } from '@/app/BackendContext';
import { BackendError, NO_SIGNAL, type Identified } from '@/data/backend';
import type { Drafts } from '@/data/photos';
import { messageFor } from './useSavedOffer';

/** How long the photos must stay the same before they're sent. The drafts reach the Add screen through two
 *  live queries that land a moment apart, so "ready" can briefly pair with the drafts from before the last
 *  photo landed; waiting this long sends one reading of the finished set, not two. */
export const SETTLE_MS = 250;

export type ReadState = 'idle' | 'reading' | 'offline' | 'failed';

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Has Claude read the sleeve once the photos are done: each drafts object (by identity) is read once.
 * Only the latest reading answers: one cancelled, overtaken by new drafts, interrupted by the photos
 * no longer being ready (a retake under way, say) or outlived by the screen is dropped.
 */
export function useReadSleeve({ drafts, ready, onAnswer }: { drafts: Drafts | null; ready: boolean; onAnswer: (a: Identified) => void }) {
  const backend = useBackend();
  const [state, setState] = useState<ReadState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  // The drafts already read (or skipped, or found offline): they aren't read again unless asked.
  const handled = useRef<Drafts | null>(null);
  // After an Undo: the drafts that come back next count as read.
  const skip = useRef(false);
  // Every reading gets a turn; one whose turn has passed is dropped.
  const turn = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const answer = useRef(onAnswer);
  const current = useRef<{ drafts: Drafts | null; ready: boolean }>({ drafts, ready });
  useEffect(() => {
    answer.current = onAnswer;
    current.current = { drafts, ready };
  });

  /** Drop any reading under way or about to start. */
  const drop = useCallback(() => {
    turn.current++;
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
      timer.current = setTimeout(() => {
        backend.identifyRecord(front.bytes, these.back?.bytes ?? null).then(
          (a) => {
            if (mine !== turn.current) return;
            setState('idle');
            answer.current(a);
          },
          (err: unknown) => {
            if (mine !== turn.current) return;
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
      // Not ready (no photos, or a photo being taken): what was under way no longer fits, and whatever
      // comes back is read afresh.
      drop();
      handled.current = null;
      setState('idle');
      setMessage(null);
      return;
    }
    if (drafts === handled.current) return;
    handled.current = drafts;
    if (skip.current) {
      skip.current = false;
      drop();
      setState('idle');
      setMessage(null);
      return;
    }
    read(drafts);
  }, [drafts, ready, read, drop]);

  useEffect(() => drop, [drop]);

  /** Look it up / Try again: read the photos now showing. */
  const retry = useCallback(() => {
    const { drafts: now, ready: isReady } = current.current;
    if (!isReady || !now?.front) return;
    handled.current = now;
    read(now);
  }, [read]);

  /** The person searched for themselves: the reading's answer would only get in the way. */
  const cancel = useCallback(() => {
    drop();
    setState('idle');
    setMessage(null);
  }, [drop]);

  /** Undo of a recognised save: the drafts it hands back aren't read again, which would only save the same pressing. */
  const skipNext = useCallback(() => {
    skip.current = true;
  }, []);

  return { state, message, retry, cancel, skipNext };
}
