import { useCallback, useEffect, useState } from 'react';
import type { Backend, SignedIn } from '@/data/backend';
import { clearPhone, type ShelfDB } from '@/data/db';

export type Session =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'needs-name'; user: SignedIn }
  | { state: 'ready'; user: SignedIn; shelfId: string }
  | { state: 'error'; user: SignedIn; message: string };

type Remembered = { userId: string; shelfId: string };
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
        await remember(db, { userId: user.userId, shelfId });
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

  useEffect(() => {
    let live = true;
    void (async () => {
      const user = await backend.currentUser();
      if (!live) return;
      if (user) {
        await settle(user);
      } else {
        await clearPhone(db);
        if (live) setSession({ state: 'signed-out' });
      }
    })();
    return () => {
      live = false;
    };
  }, [backend, db, settle]);

  const chooseName = async (name: string) => {
    if (session.state !== 'needs-name') return;
    const shelfId = await backend.bootstrap(name); // errors go back to the name screen
    await remember(db, { userId: session.user.userId, shelfId });
    setSession({ state: 'ready', user: session.user, shelfId });
  };

  const retry = () => {
    if (session.state !== 'error') return;
    setSession({ state: 'loading' });
    void settle(session.user);
  };

  const signOut = async () => {
    await backend.signOut();
    await clearPhone(db);
    setSession({ state: 'signed-out' });
  };

  return { session, verified: settle, chooseName, retry, signOut };
}
