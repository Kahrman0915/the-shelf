import { BackendError, type ShelfSource } from './backend';
import { readSession, type ShelfDB } from './db';
import { applyPostcard } from './outbox';
import { ratingFromRow, recordFromRow } from './rowMapping';

/** Re-ask for the last five minutes each time, so a change committed a moment late isn't missed. */
const OVERLAP_MS = 5 * 60 * 1000;

const lastPulledKey = (shelfId: string) => `lastPulledAt:${shelfId}`;

/**
 * The courier's pickup run: fetch what changed on the shelf since last time, plus every rating and member,
 * check it all, then write it in one go. If anything fails, the phone keeps what it had.
 * Writes nothing unless the phone still holds this shelf (its remembered session).
 */
export async function pullShelf(db: ShelfDB, source: ShelfSource, shelfId: string): Promise<void> {
  const last = (await db.meta.get(lastPulledKey(shelfId)))?.value ?? null;
  const since = last ? new Date(Date.parse(last) - OVERLAP_MS).toISOString() : null;

  const [recordRows, ratingRows, members] = await Promise.all([source.recordsSince(shelfId, since), source.ratings(shelfId), source.members(shelfId)]);
  const records = recordRows.map(recordFromRow);
  const ratings = ratingRows.map(ratingFromRow);
  const newest = records.reduce<string | null>((max, r) => (max === null || Date.parse(r.updatedAt) > Date.parse(max) ? r.updatedAt : max), last);

  await db.transaction('rw', [db.records, db.ratings, db.members, db.meta, db.outbox], async () => {
    // The phone was cleared, or opened someone else's shelf, while this pull was on its way: drop it.
    if ((await readSession(db))?.shelfId !== shelfId) return;
    await db.records.bulkPut(records);
    const onShelf = await db.records.where('shelfId').equals(shelfId).primaryKeys();
    await db.ratings.where('recordId').anyOf(onShelf).delete();
    await db.ratings.bulkPut(ratings);
    await db.members.where('shelfId').equals(shelfId).delete();
    await db.members.bulkPut(members);
    await reapplyOutbox(db);
    if (newest) await db.meta.put({ key: lastPulledKey(shelfId), value: newest });
  });
}

/**
 * The notebook is the server plus my unsent changes: lay every postcard back on top, oldest first.
 * A postcard that no longer fits the record rules is set aside as rejected rather than blocking every pull.
 * Catching here is safe only because applyPostcard throws before it issues any Dexie write.
 */
async function reapplyOutbox(db: ShelfDB): Promise<void> {
  for (const p of await db.outbox.orderBy('seq').toArray()) {
    try {
      await applyPostcard(db, p);
    } catch (e) {
      if (!(e instanceof BackendError)) throw e;
      await db.outbox.update(p.seq, { state: 'rejected', reason: e.message });
    }
  }
}

/** Forget when this shelf was last pulled, so the next pull fetches everything. */
export async function forgetLastPull(db: ShelfDB, shelfId: string): Promise<void> {
  await db.meta.delete(lastPulledKey(shelfId));
}
