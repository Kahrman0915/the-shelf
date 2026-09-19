import { useCallback, useEffect, useState } from 'react';
import type { Backend, SignedIn } from '@/data/backend';
import { clearPhone, type ShelfDB } from '@/data/db';

export type Session =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'needs-name'; user: SignedIn }
  | { state: 'ready'; user: SignedIn; shelfId: string }
  | { state: 'error'; user: SignedIn | null; message: string };

type Remembered = { userId: string; email: string; shelfId: string };
const SESSION_KEY = 'session';

async function remembered(db: ShelfDB): Promise<Remembered | null> {
  const row = await db.meta.get(SESSION_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Remembered;
  } catch {
    return null;
  }
}

/** Remember who this phone belongs to, so it can open offline. A different person means a clean notebook. */
async function remember(db: ShelfDB, r: Remembered): Promise<void> {
  const previous = await remembered(db);
  if (previous && previous.userId !== r.userId) await clearPhone(db);
  await db.meta.put({ key: SESSION_KEY, value: JSON.stringify(r) });
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useSession(backend: Backend, db: ShelfDB) {
  const [session, setSession] = useState<Session>({ state: 'loading' });

  const settle = useCallback(
    async (user: SignedIn) => {
      try {
        if (!(await backend.hasProfile(user.userId))) {
          setSession({ state: 'needs-name', user });
          return;
        }
        const shelfId = await backend.bootstrap(null);
        await remember(db, { userId: user.userId, email: user.email, shelfId });
        setSession({ state: 'ready', user, shelfId });
      } catch (e) {
        // No signal: open from the phone's copy if it belongs to this person.
        const cached = await remembered(db);
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
          await clearPhone(db);
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

  const signOut = async () => {
    try {
      await backend.signOut();
    } catch {
      // Offline: the login is already gone locally. There's nothing more to show for it.
    } finally {
      await clearPhone(db);
      setSession({ state: 'signed-out' });
    }
  };

  return { session, verified: settle, chooseName, retry, signOut };
}
