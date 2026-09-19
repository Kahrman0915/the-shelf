import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Member } from './backend';
import type { Rating, ShelfRecord } from './schema';

export type Meta = { key: string; value: string };

/** The notebook on the phone. Every screen reads from here; sync fills it from Supabase. */
export class ShelfDB extends Dexie {
  records!: EntityTable<ShelfRecord, 'id'>;
  ratings!: Table<Rating, [string, string]>;
  members!: Table<Member, [string, string]>;
  meta!: EntityTable<Meta, 'key'>;

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
  }
}

export const db = new ShelfDB();

/** Empty the notebook: used on sign-out and when a different person signs in. */
export async function clearPhone(database: ShelfDB): Promise<void> {
  await database.transaction('rw', [database.records, database.ratings, database.members, database.meta], async () => {
    await Promise.all([database.records.clear(), database.ratings.clear(), database.members.clear(), database.meta.clear()]);
  });
}
