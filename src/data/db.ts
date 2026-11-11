import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Member } from './backend';
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

/** Empty the notebook: used on sign-out and when a different person signs in. */
export async function clearPhone(database: ShelfDB): Promise<void> {
  await database.transaction('rw', [database.records, database.ratings, database.members, database.meta, database.outbox], async () => {
    await Promise.all([
      database.records.clear(),
      database.ratings.clear(),
      database.members.clear(),
      database.meta.clear(),
      database.outbox.clear(),
    ]);
  });
}
