import type { ShelfSource } from './backend';
import type { ShelfDB } from './db';
import { ratingFromRow, recordFromRow } from './rowMapping';

/** Re-ask for the last five minutes each time, so a change committed a moment late isn't missed. */
const OVERLAP_MS = 5 * 60 * 1000;

const lastPulledKey = (shelfId: string) => `lastPulledAt:${shelfId}`;

/**
 * The courier's pickup run: fetch what changed on the shelf since last time, plus every rating and member,
 * check it all, then write it in one go. If anything fails, the phone keeps what it had.
 */
export async function pullShelf(db: ShelfDB, source: ShelfSource, shelfId: string): Promise<void> {
  const last = (await db.meta.get(lastPulledKey(shelfId)))?.value ?? null;
  const since = last ? new Date(Date.parse(last) - OVERLAP_MS).toISOString() : null;

  const [recordRows, ratingRows, members] = await Promise.all([source.recordsSince(shelfId, since), source.ratings(shelfId), source.members(shelfId)]);
  const records = recordRows.map(recordFromRow);
  const ratings = ratingRows.map(ratingFromRow);
  const newest = records.reduce<string | null>((max, r) => (max === null || Date.parse(r.updatedAt) > Date.parse(max) ? r.updatedAt : max), last);

  await db.transaction('rw', [db.records, db.ratings, db.members, db.meta], async () => {
    await db.records.bulkPut(records);
    const onShelf = await db.records.where('shelfId').equals(shelfId).primaryKeys();
    await db.ratings.where('recordId').anyOf(onShelf).delete();
    await db.ratings.bulkPut(ratings);
    await db.members.where('shelfId').equals(shelfId).delete();
    await db.members.bulkPut(members);
    if (newest) await db.meta.put({ key: lastPulledKey(shelfId), value: newest });
  });
}
