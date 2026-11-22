import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Member } from './backend';
import { db } from './db';
import { storageKept, type Postcard } from './outbox';
import type { Rating, Section, ShelfRecord } from './schema';

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

/** Like useRecord, but a deleted record is still returned (Edit must notice a delete from another phone). */
export function useRecordAnyState(shelfId: string, id: string | undefined): ShelfRecord | null | undefined {
  return useLiveQuery(async () => {
    const record = id ? await db.records.get(id) : undefined;
    return record && record.shelfId === shelfId ? record : null;
  }, [shelfId, id]);
}

export function useRatings(recordId: string): Rating[] | undefined {
  return useLiveQuery(() => db.ratings.where('recordId').equals(recordId).toArray(), [recordId]);
}

export function useMembers(shelfId: string): Member[] | undefined {
  return useLiveQuery(() => db.members.where('shelfId').equals(shelfId).toArray(), [shelfId]);
}

/** The shelf's sections in shelf order; undefined while loading. */
export function useSections(shelfId: string): Section[] | undefined {
  return useLiveQuery(async () => (await db.sections.where('shelfId').equals(shelfId).toArray()).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)), [shelfId]);
}

/** How many live records each section holds, by section id (a section with none has no entry); undefined while loading. */
export function useSectionCounts(shelfId: string): ReadonlyMap<string, number> | undefined {
  return useLiveQuery(async () => {
    const counts = new Map<string, number>();
    await db.records.where('shelfId').equals(shelfId).filter((r) => r.deletedAt === null).each((r) => counts.set(r.sectionId, (counts.get(r.sectionId) ?? 0) + 1));
    return counts;
  }, [shelfId]);
}

/** The shelf's sections by id, for colouring and naming records; undefined while loading, so nothing is drawn in the wrong colour first. */
export function useSectionsById(shelfId: string): ReadonlyMap<string, Section> | undefined {
  const sections = useSections(shelfId);
  return useMemo(() => sections && new Map(sections.map((s) => [s.id, s])), [sections]);
}

/** Whether the browser agreed to keep this phone's data; null until it has been asked. */
export function useStorageKept(): boolean | null | undefined {
  return useLiveQuery(() => storageKept(db), []);
}

/** Every postcard still waiting or rejected, oldest first. */
export function useOutbox(): Postcard[] | undefined {
  return useLiveQuery(() => db.outbox.orderBy('seq').toArray(), []);
}
