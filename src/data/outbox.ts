import { BackendError } from './backend';
import type { ShelfDB } from './db';
import { RatingSchema, RecordSchema, type ShelfRecord } from './schema';

type Base = {
  seq: number;
  shelfId: string;
  recordId: string;
  userId: string;
  createdAt: string;
  state: 'waiting' | 'rejected';
  reason: string | null;
};

/** A change waiting to be sent: only the fields that changed. */
export type Postcard =
  | (Base & { kind: 'record.create'; fields: ShelfRecord })
  | (Base & { kind: 'record.patch'; fields: Partial<ShelfRecord> })
  | (Base & { kind: 'rating.set'; fields: { value: number } });

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewPostcard = DistributiveOmit<Postcard, 'seq' | 'state' | 'reason'>;

function checkRecord(record: unknown): ShelfRecord {
  const parsed = RecordSchema.safeParse(record);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BackendError(`Record rules broken: ${issue.path.join('.') || 'record'} ${issue.message}`);
  }
  return parsed.data;
}

/**
 * Turns a postcard into notebook changes. The only code that does. Safe to apply again:
 * create only when missing, patch merges, rating.set overwrites with the same value.
 * Call inside a rw transaction over records + ratings.
 */
export async function applyPostcard(db: ShelfDB, p: NewPostcard | Postcard): Promise<void> {
  switch (p.kind) {
    case 'record.create': {
      if (await db.records.get(p.recordId)) return;
      await db.records.put(checkRecord(p.fields));
      return;
    }
    case 'record.patch': {
      const existing = await db.records.get(p.recordId);
      if (!existing) return;
      await db.records.put(checkRecord({ ...existing, ...p.fields }));
      return;
    }
    case 'rating.set': {
      const rating = RatingSchema.safeParse({ recordId: p.recordId, userId: p.userId, value: p.fields.value, updatedAt: p.createdAt });
      if (!rating.success) {
        throw new BackendError(`Rating rules broken: ${rating.error.issues[0].message}`);
      }
      await db.ratings.put(rating.data);
      const record = await db.records.get(p.recordId);
      if (record && record.status === 'new_arrival') {
        await db.records.update(p.recordId, { status: 'owned' });
      }
      return;
    }
  }
}

/** Apply each postcard to the notebook and queue it, all in one transaction. */
export async function savePostcards(db: ShelfDB, postcards: NewPostcard[]): Promise<void> {
  await db.transaction('rw', [db.records, db.ratings, db.outbox], async () => {
    for (const p of postcards) await applyPostcard(db, p);
    for (const p of postcards) await db.outbox.add({ ...p, state: 'waiting', reason: null } as Postcard);
  });
  await ensureStorageKept(db);
}

const STORAGE_KEY = 'storagePersisted';

/** Ask the browser once to keep this phone's data; remember the answer. */
export async function ensureStorageKept(
  db: ShelfDB,
  storage: { persist(): Promise<boolean> } | undefined = globalThis.navigator?.storage,
): Promise<boolean> {
  const known = await db.meta.get(STORAGE_KEY);
  if (known) return known.value === 'true';
  const kept = storage ? await storage.persist() : false;
  await db.meta.put({ key: STORAGE_KEY, value: String(kept) });
  return kept;
}

export async function storageKept(db: ShelfDB): Promise<boolean | null> {
  const known = await db.meta.get(STORAGE_KEY);
  return known ? known.value === 'true' : null;
}
