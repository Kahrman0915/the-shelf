import { useLiveQuery } from 'dexie-react-hooks';
import type { Member } from './backend';
import { db } from './db';
import type { ShelfRecord } from './schema';

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

export function useRecord(id: string | undefined): ShelfRecord | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.records.get(id)) ?? null) : null), [id]);
}

export function useMembers(shelfId: string): Member[] | undefined {
  return useLiveQuery(() => db.members.where('shelfId').equals(shelfId).toArray(), [shelfId]);
}
