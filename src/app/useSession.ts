import { useCallback, useEffect, useState } from 'react';
import { BackendError, NO_SIGNAL, type Backend, type SignedIn } from '@/data/backend';
import { pushOutbox } from '@/data/courier';
import { clearPhone, readSession as remembered, writeSession, type RememberedSession, type ShelfDB } from '@/data/db';

export type Session =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'needs-name'; user: SignedIn }
  | { state: 'ready'; user: SignedIn; shelfId: string }
  | { state: 'error'; user: SignedIn | null; message: string }
  /** Someone else just signed in, and the previous person's changes haven't been sent. */
  | { state: 'previous-unsent'; user: SignedIn; count: number };

/** Remember who this phone belongs to, so it can open offline. A different person means a clean notebook. */
async function remember(db: ShelfDB, r: RememberedSession): Promise<void> {
  const previous = await remembered(db);
  if (previous && previous.userId !== r.userId) await clearPhone(db);
  await writeSession(db, r);
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useSession(backend: Backend, db: ShelfDB) {
  const [session, setSession] = useState<Session>({ state: 'loading' });

  const settle = useCallback(
    async (user: SignedIn) => {
      try {
        const previous = await remembered(db);
        if (previous && previous.userId !== user.userId) {
          const count = await db.outbox.count();
          if (count > 0) {
            setSession({ state: 'previous-unsent', user, count });
            return;
          }
        }
        if (!(await backend.hasProfile(user.userId))) {
          setSession({ state: 'needs-name', user });
          return;
        }
        const shelfId = await backend.bootstrap(null);
        await remember(db, { userId: user.userId, email: user.email, shelfId });
        setSession({ state: 'ready', user, shelfId });
      } catch (e) {
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
          if ((await db.outbox.count()) === 0) await clearPhone(db);
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
    const shelfId = await backend.bootstrap(name); // errors go back to the name screen
    await remember(db, { userId: session.user.userId, email: session.user.email, shelfId });
    setSession({ state: 'ready', user: session.user, shelfId });
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

  /** Sends waiting changes first. If any are left, says how many and stays signed in. */
  const signOut = async (): Promise<{ unsent: number } | null> => {
    await pushOutbox(db, backend);
    const unsent = await db.outbox.count();
    if (unsent > 0) return { unsent };
    await signOutAndDelete();
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
