import type { ShelfDB } from './db';
import { importCollection } from './importCollection';

export async function seedIfEmpty(
  db: ShelfDB,
  json: unknown,
  ctx: { shelfId: string; userId: string; newId: () => string },
): Promise<'seeded' | 'already-seeded'> {
  if ((await db.records.count()) > 0) return 'already-seeded';
  const { records, ratings } = importCollection(json, ctx); // throws ImportError before anything is written
  await db.transaction('rw', db.records, db.ratings, async () => {
    await db.records.bulkAdd(records);
    await db.ratings.bulkAdd(ratings);
  });
  return 'seeded';
}
