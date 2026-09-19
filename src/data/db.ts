import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Rating, ShelfRecord } from './schema';

/** The notebook on the phone. Every screen reads from here. */
export class ShelfDB extends Dexie {
  records!: EntityTable<ShelfRecord, 'id'>;
  ratings!: Table<Rating, [string, string]>;

  constructor(name = 'the-shelf') {
    super(name);
    this.version(1).stores({
      records: 'id, shelfId, status, genre, &importKey',
      ratings: '[recordId+userId], recordId, userId',
    });
  }
}

export const db = new ShelfDB();
