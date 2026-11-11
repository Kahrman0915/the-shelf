import { useCallback, useEffect, useState } from 'react';
import { BackendError, NO_SIGNAL, type Backend, type SignedIn } from '@/data/backend';
import { pushOutbox } from '@/data/courier';
import {
  PreviousPersonUnsent,
  clearPhone,
  clearPhoneIfNothingWaiting,
  readSession as remembered,
  rememberSession,
  unsentFromPreviousPerson,
  type ShelfDB,
} from '@/data/db';

export type Session =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'needs-name'; user: SignedIn }
  | { state: 'ready'; user: SignedIn; shelfId: string }
  | { state: 'error'; user: SignedIn | null; message: string }
  /** Someone else just signed in, and the previous person's changes haven't been sent. */
  | { state: 'previous-unsent'; user: SignedIn; count: number };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useSession(backend: Backend, db: ShelfDB) {
  const [session, setSession] = useState<Session>({ state: 'loading' });

  const settle = useCallback(
    async (user: SignedIn) => {
      try {
        // Ask before the name screen too. rememberSession() checks again as it writes.
        const count = await unsentFromPreviousPerson(db, user.userId);
        if (count > 0) {
          setSession({ state: 'previous-unsent', user, count });
          return;
        }
        if (!(await backend.hasProfile(user.userId))) {
          setSession({ state: 'needs-name', user });
          return;
        }
        const shelfId = await backend.bootstrap(null);
        await rememberSession(db, { userId: user.userId, email: user.email, shelfId });
        setSession({ state: 'ready', user, shelfId });
      } catch (e) {
        if (e instanceof PreviousPersonUnsent) {
          setSession({ state: 'previous-unsent', user, count: e.count });
          return;
        }
        // No signal: open from the phone's copy if it belongs to this person. Any other failure is shown.
        const offline = e instanceof BackendError && e.message === NO_SIGNAL;
        const cached = offline ? await remembered(db) : null;
        if (cached && cached.userId === user.userId) setSession({ state: 'ready', user, shelfId: cached.shelfId });
        else setSession({ state: 'error', user, message: messageOf(e) });
      }
    },
    [backend, db],
  );

  /** Signed-in-or-not check at startup. `isLive` lets the mount effect bail out after an unmount;
   *  `retry()` calls this too, with nothing to check, when there was no user to fall back to `settle()` with. */
  const start = useCallback(
    async (isLive: () => boolean = () => true) => {
      try {
        const user = await backend.currentUser();
        if (!isLive()) return;
        if (user) {
          await settle(user);
        } else {
          // Signed out or expired elsewhere. Unsent changes stay until whoever signs in next decides.
          await clearPhoneIfNothingWaiting(db);
          if (isLive()) setSession({ state: 'signed-out' });
        }
      } catch (e) {
        // No signal, and we don't even know who's signed in: fall back to the phone's remembered
        // session rather than clearing it — the person may just be offline, not signed out.
        if (!isLive()) return;
        const cached = await remembered(db);
        if (!isLive()) return;
        if (cached) setSession({ state: 'ready', user: { userId: cached.userId, email: cached.email }, shelfId: cached.shelfId });
        else setSession({ state: 'error', user: null, message: messageOf(e) });
      }
    },
    [backend, db, settle],
  );

  useEffect(() => {
    let live = true;
    void start(() => live);
    return () => {
      live = false;
    };
  }, [start]);

  const chooseName = async (name: string) => {
    if (session.state !== 'needs-name') return;
    const { user } = session;
    const shelfId = await backend.bootstrap(name); // errors go back to the name screen
    try {
      await rememberSession(db, { userId: user.userId, email: user.email, shelfId });
    } catch (e) {
      if (!(e instanceof PreviousPersonUnsent)) throw e;
      setSession({ state: 'previous-unsent', user, count: e.count });
      return;
    }
    setSession({ state: 'ready', user, shelfId });
  };

  const retry = () => {
    if (session.state !== 'error') return;
    setSession({ state: 'loading' });
    if (session.user) void settle(session.user);
    else void start();
  };

  const forgetLogin = async () => {
    try {
      await backend.signOut();
    } catch {
      // Backend.signOut() already removed the stored login itself before throwing (see
      // supabaseBackend.signOut()), even when the server round-trip failed offline. Nothing more
      // to show for the failure here.
    }
  };

  /** Today's sign-out: clears the phone, unsent changes included. */
  const signOutAndDelete = async () => {
    await forgetLogin();
    await clearPhone(db);
    setSession({ state: 'signed-out' });
  };

  /** Sends waiting changes first. If any are left, says how many and stays signed in. The phone is
   *  cleared (only if nothing is waiting, checked in the same transaction) before the network sign-out,
   *  so a change saved meanwhile survives. */
  const signOut = async (): Promise<{ unsent: number } | null> => {
    await pushOutbox(db, backend);
    if (!(await clearPhoneIfNothingWaiting(db))) return { unsent: await db.outbox.count() };
    await forgetLogin();
    setSession({ state: 'signed-out' });
    return null;
  };

  /** The new person chose to drop the previous person's unsent changes. */
  const continueAndDelete = async () => {
    if (session.state !== 'previous-unsent') return;
    const { user } = session;
    setSession({ state: 'loading' });
    await clearPhone(db);
    await settle(user);
  };

  /** The new person backed out: keep the previous person's notebook and changes, and sign out. */
  const goBack = async () => {
    await forgetLogin();
    setSession({ state: 'signed-out' });
  };

  return { session, verified: settle, chooseName, retry, signOut, signOutAndDelete, continueAndDelete, goBack };
}
