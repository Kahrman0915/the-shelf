import { BackendError } from './backend';
import type { ShelfDB } from './db';
import type { StoredPhoto } from './photos';
import { RatingSchema, RecordSchema, checkSection, type Section, type ShelfRecord } from './schema';

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
  | (Base & { kind: 'section.create'; fields: Section })
  | (Base & { kind: 'section.patch'; fields: Partial<Section> })
  | (Base & { kind: 'section.merge'; fields: { into: string } })
  | (Base & { kind: 'rating.set'; fields: { value: number } })
  | (Base & { kind: 'photo.upload'; fields: { path: string } })
  | (Base & { kind: 'photo.delete'; fields: { path: string } });

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

/** What the server's claim trigger does after `claimer` is written: its holiday and its Discogs genres leave the shelf's other sections. */
async function claim(db: ShelfDB, claimer: Section, fields: Partial<Section>): Promise<void> {
  const takesHoliday = fields.takesHoliday === true;
  const genres = fields.discogsGenres ?? [];
  if (!takesHoliday && genres.length === 0) return;
  for (const other of await db.sections.where('shelfId').equals(claimer.shelfId).toArray()) {
    if (other.id === claimer.id) continue;
    const change: Partial<Section> = {};
    if (takesHoliday && other.takesHoliday) change.takesHoliday = false;
    if (other.discogsGenres.some((g) => genres.includes(g))) change.discogsGenres = other.discogsGenres.filter((g) => !genres.includes(g));
    if (Object.keys(change).length > 0) await db.sections.put(checkSection({ ...other, ...change }));
  }
}

/**
 * Turns a postcard into notebook changes. The only code that does. Safe to apply again:
 * create only when missing, patch merges, rating.set overwrites with the same value.
 * Call inside a rw transaction over records + ratings + sections.
 */
export async function applyPostcard(db: ShelfDB, p: NewPostcard | Postcard): Promise<void> {
  switch (p.kind) {
    case 'record.create': {
      if (p.fields.id !== p.recordId) throw new BackendError('Record rules broken: id doesn’t match the change’s record');
      if (await db.records.get(p.recordId)) return;
      await db.records.put(checkRecord(p.fields));
      return;
    }
    case 'record.patch': {
      if ('id' in p.fields && p.fields.id !== p.recordId) throw new BackendError('Record rules broken: a change can’t move a record to a new id');
      const existing = await db.records.get(p.recordId);
      if (!existing) return;
      await db.records.put(checkRecord({ ...existing, ...p.fields }));
      return;
    }
    case 'section.create': {
      if (p.fields.id !== p.recordId) throw new BackendError('Section rules broken: id doesn’t match the change’s section');
      if (await db.sections.get(p.recordId)) return;
      const created = checkSection(p.fields);
      await db.sections.put(created);
      await claim(db, created, created);
      return;
    }
    case 'section.patch': {
      if ('id' in p.fields && p.fields.id !== p.recordId) throw new BackendError('Section rules broken: a change can’t move a section to a new id');
      const existing = await db.sections.get(p.recordId);
      if (!existing) return;
      const patched = checkSection({ ...existing, ...p.fields });
      await db.sections.put(patched);
      await claim(db, patched, p.fields);
      return;
    }
    case 'section.merge': {
      const from = await db.sections.get(p.recordId);
      if (!from) return; // already merged
      if (from.isCatchAll) throw new BackendError('Section rules broken: the catch-all section can’t be merged away');
      const into = await db.sections.get(p.fields.into);
      if (!into) return;
      // Records still sit under genres; once they carry a sectionId this also moves every record
      // with sectionId === from over to into (Plan 5, Task 4).
      const genres = [...into.discogsGenres, ...from.discogsGenres.filter((g) => !into.discogsGenres.includes(g))];
      await db.sections.put(checkSection({ ...into, discogsGenres: genres, takesHoliday: into.takesHoliday || from.takesHoliday }));
      await db.sections.delete(from.id);
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
    case 'photo.upload':
    case 'photo.delete':
      // Photos never change the notebook's records; the record's own patch points at them.
      return;
  }
}

/** Apply each postcard to the notebook and queue it, all in one transaction. Photo bytes are kept in the same go. */
export async function savePostcards(db: ShelfDB, postcards: NewPostcard[], photos: StoredPhoto[] = []): Promise<void> {
  await db.transaction('rw', [db.records, db.ratings, db.sections, db.outbox, db.photos], async () => {
    await db.photos.bulkPut(photos);
    for (const p of postcards) await applyPostcard(db, p);
    for (const p of postcards) await db.outbox.add({ ...p, state: 'waiting', reason: null } as Postcard);
  });
  // Not awaited: the postcards are saved. A failed or prompting persist() must neither hold the
  // save up nor make it look failed (a retry would log the change twice).
  void ensureStorageKept(db).catch(console.error);
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
