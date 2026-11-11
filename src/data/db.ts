import Dexie, { type EntityTable, type Table } from 'dexie';
import { BackendError, type Member } from './backend';
import type { Postcard } from './outbox';
import type { Rating, ShelfRecord } from './schema';

export type Meta = { key: string; value: string };

/** The notebook on the phone. Every screen reads from here; sync fills it from Supabase. */
export class ShelfDB extends Dexie {
  records!: EntityTable<ShelfRecord, 'id'>;
  ratings!: Table<Rating, [string, string]>;
  members!: Table<Member, [string, string]>;
  meta!: EntityTable<Meta, 'key'>;
  outbox!: EntityTable<Postcard, 'seq'>;

  constructor(name = 'the-shelf') {
    super(name);
    this.version(1).stores({
      records: 'id, shelfId, status, genre, &importKey',
      ratings: '[recordId+userId], recordId, userId',
    });
    this.version(2)
      .stores({
        records: 'id, shelfId, status, genre, importKey',
        ratings: '[recordId+userId], recordId, userId',
        members: '[shelfId+userId], shelfId',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        // Plan 1 kept a phone-only copy seeded from collection.json. The shelf now lives in Supabase.
        await tx.table('records').clear();
        await tx.table('ratings').clear();
      });
    this.version(3).stores({
      records: 'id, shelfId, status, genre, importKey',
      ratings: '[recordId+userId], recordId, userId',
      members: '[shelfId+userId], shelfId',
      meta: 'key',
      outbox: '++seq, recordId, state',
    });
  }
}

export const db = new ShelfDB();

/** Who this phone's notebook belongs to, so it can open offline. */
export type RememberedSession = { userId: string; email: string; shelfId: string };
const SESSION_KEY = 'session';

export async function readSession(database: ShelfDB): Promise<RememberedSession | null> {
  const row = await database.meta.get(SESSION_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as RememberedSession;
  } catch {
    return null;
  }
}

export async function writeSession(database: ShelfDB, session: RememberedSession): Promise<void> {
  await database.meta.put({ key: SESSION_KEY, value: JSON.stringify(session) });
}

const everything = (d: ShelfDB) => [d.records, d.ratings, d.members, d.meta, d.outbox];

/** Call inside a rw transaction over everything(). */
async function clearAll(d: ShelfDB): Promise<void> {
  await Promise.all(everything(d).map((table) => table.clear()));
}

/** Empty the notebook, unsent changes included. */
export async function clearPhone(database: ShelfDB): Promise<void> {
  await database.transaction('rw', everything(database), () => clearAll(database));
}

/** Empty the notebook only if no change is waiting to send, checked in the same transaction.
 *  Returns how many are waiting, counted in that transaction: 0 means it cleared the phone. */
export async function clearPhoneIfNothingWaiting(database: ShelfDB): Promise<number> {
  return database.transaction('rw', everything(database), async () => {
    const waiting = await database.outbox.count();
    if (waiting === 0) await clearAll(database);
    return waiting;
  });
}

/** Someone else is signing in, and the previous person's changes on this phone haven't been sent. */
export class PreviousPersonUnsent extends BackendError {
  constructor(readonly count: number) {
    super('Changes from the previous person on this phone haven’t been sent.');
    this.name = 'PreviousPersonUnsent';
  }
}

/** How many unsent changes were made by someone other than this person. Read from the postcards
 *  themselves, not the remembered session: a sign-out can clear that while a change is being saved.
 *  Call inside a transaction over the outbox. */
async function othersWaiting(d: ShelfDB, userId: string): Promise<number> {
  return d.outbox.filter((p) => p.userId !== userId).count();
}

/** For deciding early whether to ask: the count of unsent changes that aren't this person's. */
export async function unsentFromPreviousPerson(database: ShelfDB, userId: string): Promise<number> {
  return database.transaction('r', [database.meta, database.outbox], () => othersWaiting(database, userId));
}

/**
 * Remember who this phone belongs to, so it can open offline. A different person gets a clean
 * notebook, unless the previous person's changes are still waiting: then throws PreviousPersonUnsent
 * and changes nothing. One transaction, so nothing saved meanwhile is wiped unasked.
 */
export async function rememberSession(database: ShelfDB, session: RememberedSession): Promise<void> {
  await database.transaction('rw', everything(database), async () => {
    const waiting = await othersWaiting(database, session.userId);
    if (waiting > 0) throw new PreviousPersonUnsent(waiting);
    const previous = await readSession(database);
    if (previous && previous.userId !== session.userId) await clearAll(database);
    await writeSession(database, session);
  });
}
