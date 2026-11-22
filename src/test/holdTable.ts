import Dexie, { type Table } from 'dexie';
import type { ShelfDB } from '@/data/db';

/** Keep a table busy in a write transaction, so reads of it wait (as on a slow phone) until the returned release is called. */
export function holdTable(database: ShelfDB, table: Table): () => Promise<void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const done = database.transaction('rw', table, () => Dexie.waitFor(gate));
  return async () => {
    release();
    await done;
  };
}
