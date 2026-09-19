import type { ShelfDB } from './db';
import { importCollection } from './importCollection';

export async function seedIfEmpty(
  db: ShelfDB,
  json: unknown,
  ctx: { shelfId: string; userId: string; newId: () => string },
): Promise<'seeded' | 'already-seeded'> {
  const { records, ratings } = importCollection(json, ctx); // throws ImportError before anything is written
  return db.transaction('rw', db.records, db.ratings, async () => {
    // The count and the writes must share one transaction, or two concurrent
    // callers (StrictMode's double effect, two tabs) can both see "empty" and
    // both bulkAdd, and the second collides on &importKey.
    if ((await db.records.count()) > 0) return 'already-seeded';
    await db.records.bulkAdd(records);
    await db.ratings.bulkAdd(ratings);
    return 'seeded';
  });
}
