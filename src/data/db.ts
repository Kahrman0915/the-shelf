import Dexie, { type EntityTable, type Table } from 'dexie';
import { BackendError, type Member } from './backend';
import type { Postcard } from './outbox';
import type { DraftPhoto, StoredPhoto } from './photos';
import { KAHRMANS_NINE, LEGACY_GENRES, STARTER_SET, sectionIdFor, type LegacyGenre, type SectionSeed } from '@/domain/sections';
import type { Rating, Section, ShelfRecord } from './schema';

export type Meta = { key: string; value: string };

/** The notebook on the phone. Every screen reads from here; sync fills it from Supabase. */
export class ShelfDB extends Dexie {
  records!: EntityTable<ShelfRecord, 'id'>;
  ratings!: Table<Rating, [string, string]>;
  members!: Table<Member, [string, string]>;
  meta!: EntityTable<Meta, 'key'>;
  outbox!: EntityTable<Postcard, 'seq'>;
  photos!: EntityTable<StoredPhoto, 'path'>;
  photoDrafts!: EntityTable<DraftPhoto, 'side'>;
  sections!: EntityTable<Section, 'id'>;

  constructor(name = 'the-shelf') {
    super(name);
    this.version(1).stores({
      records: 'id, shelfId, status, genre, &importKey',
      ratings: '[recordId+userId], recordId, userId',
    });
    this.version(2)
      .stores({
        records: 'id, shelfId, status, genre, importKey',
        ratings: '[recordId+userId], recordId, userId',
        members: '[shelfId+userId], shelfId',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        // Plan 1 kept a phone-only copy seeded from collection.json. The shelf now lives in Supabase.
        await tx.table('records').clear();
        await tx.table('ratings').clear();
      });
    this.version(3).stores({
      records: 'id, shelfId, status, genre, importKey',
      ratings: '[recordId+userId], recordId, userId',
      members: '[shelfId+userId], shelfId',
      meta: 'key',
      outbox: '++seq, recordId, state',
    });
    this.version(4)
      .stores({
        records: 'id, shelfId, status, genre, importKey',
        ratings: '[recordId+userId], recordId, userId',
        members: '[shelfId+userId], shelfId',
        meta: 'key',
        outbox: '++seq, recordId, state',
      })
      .upgrade(async (tx) => {
        // Records saved before the fun fact and cover link existed lack those keys, and the record rules need them
        // (null when empty). The incremental pull won't fetch unchanged rows again, so fill them in here.
        await tx.table('records').toCollection().modify(fill(DETAIL_KEYS));
        await tx
          .table('outbox')
          .toCollection()
          .modify((p: { kind: string; fields: Record<string, unknown> }) => {
            if (p.kind === 'record.create') fill(DETAIL_KEYS)(p.fields);
          });
      });
    this.version(5)
      .stores({
        records: 'id, shelfId, status, genre, importKey',
        ratings: '[recordId+userId], recordId, userId',
        members: '[shelfId+userId], shelfId',
        meta: 'key',
        outbox: '++seq, recordId, state',
        photos: 'path',
        photoDrafts: 'side',
      })
      .upgrade(async (tx) => {
        // Records saved before the back photo existed lack backPath. Fill it on stored records and queued creates.
        await tx.table('records').toCollection().modify(fill(PHOTO_KEYS));
        await tx
          .table('outbox')
          .toCollection()
          .modify((p: { kind: string; fields: Record<string, unknown> }) => {
            if (p.kind === 'record.create') fill(PHOTO_KEYS)(p.fields);
          });
        // An older app dropped back_path when it pulled, and incremental pulls never fetch unchanged rows again.
        // Forget when each shelf was last pulled, so the first pull after updating is a full one.
        await tx.table('meta').where('key').startsWith(LAST_PULLED_PREFIX).delete();
      });
    this.version(6).stores({
      records: 'id, shelfId, status, genre, importKey',
      ratings: '[recordId+userId], recordId, userId',
      members: '[shelfId+userId], shelfId',
      meta: 'key',
      outbox: '++seq, recordId, state',
      photos: 'path',
      photoDrafts: 'side',
      sections: 'id, shelfId',
    });
    this.version(7)
      .stores({
        records: 'id, shelfId, status, sectionId, importKey',
        ratings: '[recordId+userId], recordId, userId',
        members: '[shelfId+userId], shelfId',
        meta: 'key',
        outbox: '++seq, recordId, state',
        photos: 'path',
        photoDrafts: 'side',
        sections: 'id, shelfId',
      })
      .upgrade(async (tx) => {
        // Records stop carrying one of nine genres and point at their shelf's own section. The sections the
        // server made for the old genres have ids the phone can work out (sectionIdFor), so this needs no signal.
        // Only Dexie is awaited here: anything else would end the upgrade transaction.
        await tx.table('records').toCollection().modify((r: Record<string, unknown>) => toSection(r, r.shelfId));
        await tx
          .table('outbox')
          .toCollection()
          .modify((p: { kind: string; shelfId: string; fields: Record<string, unknown> }) => {
            if (p.kind === 'record.create') toSection(p.fields, p.fields.shelfId);
            if (p.kind === 'record.patch') toSection(p.fields, p.shelfId);
          });
        // Until the first sync, the phone's own shelf needs its sections: the set the server gave it.
        const session = await tx.table('meta').get(SESSION_KEY);
        const shelfId = session ? parseSession(session.value)?.shelfId : undefined;
        if (shelfId && (await tx.table('sections').where('shelfId').equals(shelfId).count()) === 0) {
          // Kahrman's shelf is the one with imported records, as the server decides it.
          const imported = await tx.table('records').where('shelfId').equals(shelfId).filter((r: ShelfRecord) => r.importKey !== null && r.importKey !== undefined).count();
          await tx.table('sections').bulkPut(sectionsFromSet(shelfId, imported > 0 ? KAHRMANS_NINE : STARTER_SET, new Date(0).toISOString()));
        }
        // The first pull after updating fetches everything, sections included, and corrects anything seeded.
        await tx.table('meta').where('key').startsWith(LAST_PULLED_PREFIX).delete();
      });
  }
}

/** An upgrade step: swap a record's (or a queued change's) genre for the section that replaced it. */
function toSection(r: Record<string, unknown>, shelfId: unknown): void {
  if (!('genre' in r)) return;
  const genre = r.genre;
  delete r.genre;
  if (typeof shelfId === 'string' && (LEGACY_GENRES as readonly unknown[]).includes(genre)) r.sectionId = sectionIdFor(shelfId, genre as LegacyGenre);
}

/** A set of sections as the server makes it for a shelf: derived ids, positions in set order. */
export function sectionsFromSet(shelfId: string, set: SectionSeed[], updatedAt: string): Section[] {
  return set.map((seed, position) => ({
    id: sectionIdFor(shelfId, seed.legacyGenre),
    shelfId,
    name: seed.name,
    color: seed.color,
    position,
    discogsGenres: [...seed.discogsGenres],
    takesHoliday: seed.takesHoliday,
    isCatchAll: seed.isCatchAll,
    legacyGenre: seed.legacyGenre,
    updatedAt,
  }));
}

const DETAIL_KEYS = ['funFact', 'funFactSource', 'coverImageUrl'] as const;

const PHOTO_KEYS = ['backPath'] as const;

/** The meta keys sync.ts keeps per shelf: `lastPulledAt:{shelfId}`. */
export const LAST_PULLED_PREFIX = 'lastPulledAt:';

/** An upgrade step: give a record (or a queued create's fields) null for each of these keys it lacks. */
const fill =
  (keys: readonly string[]) =>
  (r: Record<string, unknown>): void => {
    for (const key of keys) if (r[key] === undefined) r[key] = null;
  };

export const db = new ShelfDB();

/** Who this phone's notebook belongs to, so it can open offline. */
export type RememberedSession = { userId: string; email: string; shelfId: string };
const SESSION_KEY = 'session';

function parseSession(value: string): RememberedSession | null {
  try {
    return JSON.parse(value) as RememberedSession;
  } catch {
    return null;
  }
}

export async function readSession(database: ShelfDB): Promise<RememberedSession | null> {
  const row = await database.meta.get(SESSION_KEY);
  return row ? parseSession(row.value) : null;
}

export async function writeSession(database: ShelfDB, session: RememberedSession): Promise<void> {
  await database.meta.put({ key: SESSION_KEY, value: JSON.stringify(session) });
}

const everything = (d: ShelfDB) => [d.records, d.ratings, d.members, d.meta, d.outbox, d.photos, d.photoDrafts, d.sections];

/** Call inside a rw transaction over everything(). */
async function clearAll(d: ShelfDB): Promise<void> {
  await Promise.all(everything(d).map((table) => table.clear()));
}

/** Empty the notebook, unsent changes included. */
export async function clearPhone(database: ShelfDB): Promise<void> {
  await database.transaction('rw', everything(database), () => clearAll(database));
}

/** Empty the notebook only if no change is waiting to send, checked in the same transaction.
 *  Returns how many are waiting, counted in that transaction: 0 means it cleared the phone. */
export async function clearPhoneIfNothingWaiting(database: ShelfDB): Promise<number> {
  return database.transaction('rw', everything(database), async () => {
    const waiting = await database.outbox.count();
    if (waiting === 0) await clearAll(database);
    return waiting;
  });
}

/** Someone else is signing in, and the previous person's changes on this phone haven't been sent. */
export class PreviousPersonUnsent extends BackendError {
  constructor(readonly count: number) {
    super('Changes from the previous person on this phone haven’t been sent.');
    this.name = 'PreviousPersonUnsent';
  }
}

/** How many unsent changes were made by someone other than this person. Read from the postcards
 *  themselves, not the remembered session: a sign-out can clear that while a change is being saved.
 *  Call inside a transaction over the outbox. */
async function othersWaiting(d: ShelfDB, userId: string): Promise<number> {
  return d.outbox.filter((p) => p.userId !== userId).count();
}

/** For deciding early whether to ask: the count of unsent changes that aren't this person's. */
export async function unsentFromPreviousPerson(database: ShelfDB, userId: string): Promise<number> {
  return database.transaction('r', [database.meta, database.outbox], () => othersWaiting(database, userId));
}

/**
 * Remember who this phone belongs to, so it can open offline. A different person gets a clean
 * notebook, unless the previous person's changes are still waiting: then throws PreviousPersonUnsent
 * and changes nothing. One transaction, so nothing saved meanwhile is wiped unasked.
 */
export async function rememberSession(database: ShelfDB, session: RememberedSession): Promise<void> {
  await database.transaction('rw', everything(database), async () => {
    const waiting = await othersWaiting(database, session.userId);
    if (waiting > 0) throw new PreviousPersonUnsent(waiting);
    const previous = await readSession(database);
    if (previous && previous.userId !== session.userId) await clearAll(database);
    await writeSession(database, session);
  });
}
