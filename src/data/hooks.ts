import { useLiveQuery } from 'dexie-react-hooks';
import type { Member } from './backend';
import { db } from './db';
import { storageKept, type Postcard } from './outbox';
import type { Rating, ShelfRecord } from './schema';

export type ShelfItem = { record: ShelfRecord; myRating: number | undefined };

export function useShelfItems(shelfId: string, userId: string): ShelfItem[] | undefined {
  return useLiveQuery(async () => {
    const [records, ratings] = await Promise.all([
      db.records.where('shelfId').equals(shelfId).filter((r) => r.deletedAt === null).toArray(),
      db.ratings.where('userId').equals(userId).toArray(),
    ]);
    const mine = new Map(ratings.map((r) => [r.recordId, r.value]));
    return records.map((record) => ({ record, myRating: mine.get(record.id) }));
  }, [shelfId, userId]);
}

/** The record, or null when it's missing, on another shelf, or deleted; undefined while loading. */
export function useRecord(shelfId: string, id: string | undefined): ShelfRecord | null | undefined {
  return useLiveQuery(async () => {
    const record = id ? await db.records.get(id) : undefined;
    return record && record.shelfId === shelfId && record.deletedAt === null ? record : null;
  }, [shelfId, id]);
}

export function useRatings(recordId: string): Rating[] | undefined {
  return useLiveQuery(() => db.ratings.where('recordId').equals(recordId).toArray(), [recordId]);
}

export function useMembers(shelfId: string): Member[] | undefined {
  return useLiveQuery(() => db.members.where('shelfId').equals(shelfId).toArray(), [shelfId]);
}

/** Whether the browser agreed to keep this phone's data; null until it has been asked. */
export function useStorageKept(): boolean | null | undefined {
  return useLiveQuery(() => storageKept(db), []);
}

/** Every postcard still waiting or rejected, oldest first. */
export function useOutbox(): Postcard[] | undefined {
  return useLiveQuery(() => db.outbox.orderBy('seq').toArray(), []);
}
