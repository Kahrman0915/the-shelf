import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { KAHRMANS_NINE, STARTER_SET, sectionIdFor } from '@/domain/sections';
import { FakeBackend } from '@/test/fakeBackend';
import { deleteRecord, editRecord, FORM_FIELDS, perform, type Ctx, type RecordFields } from './actions';
import { pushOutbox } from './courier';
import { ShelfDB, writeSession } from './db';
import { applyPostcard } from './outbox';
import { newRecordToRow, recordToRow } from './rowMapping';
import { RecordSchema, SectionSchema, type Section, type ShelfRecord } from './schema';
import { pullShelf } from './sync';

const SHELF = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const OLD_A = '33333333-3333-4333-8333-333333333333';
const QUEUED_B = '44444444-4444-4444-8444-444444444444';
const OLD = '2026-10-01T10:00:00.000Z';
const NOW = '2026-11-12T10:00:00.000Z';
const ctx: Ctx = { me: ME, now: NOW };

/** A record as a phone saved it before Plan 4: no funFact, funFactSource or coverImageUrl keys, and one of the nine genres. */
function savedBeforeDetails(id: string): Omit<ShelfRecord, 'funFact' | 'funFactSource' | 'coverImageUrl' | 'sectionId'> & { genre: string } {
  return {
    id,
    shelfId: SHELF,
    status: 'owned',
    wantsUpgrade: false,
    upgradeNote: null,
    artist: 'Miles Davis',
    title: 'Kind of Blue',
    label: null,
    catalog: null,
    year: 1959,
    format: null,
    genre: 'jazz',
    discGrade: 'VG',
    sleeveGrade: null,
    pricePaid: null,
    nmEstimateLow: null,
    nmEstimateHigh: null,
    valueNote: null,
    notes: null,
    discogsReleaseId: null,
    coverPath: null,
    backPath: null,
    boughtAt: null,
    addedBy: ME,
    createdAt: OLD,
    updatedAt: OLD,
    deletedAt: null,
    importKey: null,
  };
}

const formOf = (r: ShelfRecord): RecordFields => Object.fromEntries(FORM_FIELDS.map((k) => [k, r[k]])) as RecordFields;

const name = `details-upgrade-${crypto.randomUUID()}`;

afterEach(async () => {
  await Dexie.delete(name);
});

/** A version-3 notebook (Plan 3), as it sits on each phone today. */
async function version3Phone(): Promise<void> {
  const v3 = new Dexie(name);
  v3.version(3).stores({
    records: 'id, shelfId, status, genre, importKey',
    ratings: '[recordId+userId], recordId, userId',
    members: '[shelfId+userId], shelfId',
    meta: 'key',
    outbox: '++seq, recordId, state',
  });
  await v3.table('meta').put({ key: 'session', value: JSON.stringify({ userId: ME, email: 'me@example.com', shelfId: SHELF }) });
  await v3.table('records').bulkPut([savedBeforeDetails(OLD_A), savedBeforeDetails(QUEUED_B)]);
  await v3.table('outbox').add({
    kind: 'record.create',
    shelfId: SHELF,
    recordId: QUEUED_B,
    userId: ME,
    createdAt: OLD,
    state: 'waiting',
    reason: null,
    fields: savedBeforeDetails(QUEUED_B),
  });
  v3.close();
}

describe('ShelfDB version 4', () => {
  it('fills the new detail keys with null on records and queued creates saved before them', async () => {
    await version3Phone();
    const db = new ShelfDB(name);
    await writeSession(db, { userId: ME, email: 'me@example.com', shelfId: SHELF });

    for (const r of await db.records.toArray()) {
      expect(r).toMatchObject({ funFact: null, funFactSource: null, coverImageUrl: null });
    }
    const [queued] = await db.outbox.toArray();
    expect(queued.kind).toBe('record.create');
    expect(RecordSchema.safeParse(queued.fields).success).toBe(true);

    // Edit and delete work on a record saved before the details existed.
    const a = (await db.records.get(OLD_A))!;
    const edit = editRecord(a, formOf(a), { ...formOf(a), year: 1960 }, ctx);
    await perform(db, edit.postcards);
    expect((await db.records.get(OLD_A))?.year).toBe(1960);
    await perform(db, deleteRecord((await db.records.get(OLD_A))!, ctx).postcards);
    expect((await db.records.get(OLD_A))?.deletedAt).toBe(NOW);

    // The queued create re-applies onto an empty notebook row.
    await db.transaction('rw', [db.records, db.ratings], async () => {
      await db.records.delete(QUEUED_B);
      await applyPostcard(db, queued);
    });
    expect(await db.records.get(QUEUED_B)).toMatchObject({ title: 'Kind of Blue', funFact: null });

    // A pull lays every queued postcard back on top without setting any aside, and the push sends them all.
    const { genre: _genre, ...old } = savedBeforeDetails(OLD_A);
    const fake = new FakeBackend({ records: [recordToRow({ ...old, sectionId: sectionIdFor(SHELF, 'jazz'), funFact: null, funFactSource: null, coverImageUrl: null })], ratings: [], members: [] });
    await pullShelf(db, fake, SHELF);
    expect(await db.outbox.where('state').equals('rejected').count()).toBe(0);
    expect(await pushOutbox(db, fake)).toEqual({ sent: 3, rejected: 0, noSignal: false });
    expect(fake.recordRow(OLD_A)).toMatchObject({ year: 1960, deleted_at: NOW });
    expect(fake.recordRow(QUEUED_B)).toMatchObject({ title: 'Kind of Blue', fun_fact: null });
    db.close();
  });
});

/** A version-4 notebook: details exist, backPath does not. */
async function version4Phone(): Promise<void> {
  const v4 = new Dexie(name);
  v4.version(4).stores({
    records: 'id, shelfId, status, genre, importKey',
    ratings: '[recordId+userId], recordId, userId',
    members: '[shelfId+userId], shelfId',
    meta: 'key',
    outbox: '++seq, recordId, state',
  });
  const { backPath: _omit, ...saved } = savedBeforeDetails(OLD_A);
  const stored = { ...saved, funFact: null, funFactSource: null, coverImageUrl: null };
  await v4.table('records').put(stored);
  await v4.table('outbox').add({
    kind: 'record.create',
    shelfId: SHELF,
    recordId: QUEUED_B,
    userId: ME,
    createdAt: OLD,
    state: 'waiting',
    reason: null,
    fields: { ...stored, id: QUEUED_B },
  });
  v4.close();
}

describe('version 5', () => {
  it('fills backPath with null on stored records and queued creates', async () => {
    await version4Phone();
    const db = new ShelfDB(name);
    const [record] = await db.records.toArray();
    expect(record.backPath).toBeNull();
    expect(RecordSchema.safeParse(record).success).toBe(true);
    const [queued] = await db.outbox.toArray();
    expect((queued.fields as Record<string, unknown>).backPath).toBeNull();
    expect(RecordSchema.safeParse(queued.fields).success).toBe(true);
    db.close();
  });

  it('forgets when each shelf was last pulled, so the first pull after updating fetches back photos again', async () => {
    await version4Phone();
    const v4 = new Dexie(name);
    v4.version(4).stores({ meta: 'key' });
    await v4.table('meta').bulkPut([
      { key: `lastPulledAt:${SHELF}`, value: OLD },
      { key: 'lastPulledAt:other-shelf', value: OLD },
      { key: 'session', value: JSON.stringify({ userId: ME, email: 'me@example.com', shelfId: SHELF }) },
    ]);
    v4.close();

    const db = new ShelfDB(name);
    expect((await db.meta.toArray()).map((m) => m.key)).toEqual(['session']);
    db.close();
  });

  it('adds the photos and photoDrafts tables', async () => {
    await version4Phone();
    const db = new ShelfDB(name);
    await db.photos.put({ path: 'p', bytes: new Uint8Array([1, 2]).buffer });
    const back = await db.photos.get('p');
    expect(Array.from(new Uint8Array(back!.bytes))).toEqual([1, 2]);
    await db.photoDrafts.put({ side: 'back', bytes: new Uint8Array([3]).buffer, foundEdges: false });
    expect((await db.photoDrafts.get('back'))?.foundEdges).toBe(false);
    db.close();
  });
});

const KAHRMAN_KEY = 'coltrane-ballads';

/** A version-6 notebook: sections exist as a table, but records still carry one of the nine genres. */
async function version6Phone({ imported, signedIn = true, sections = [] }: { imported: boolean; signedIn?: boolean; sections?: Section[] }): Promise<void> {
  const v6 = new Dexie(name);
  v6.version(6).stores({
    records: 'id, shelfId, status, genre, importKey',
    ratings: '[recordId+userId], recordId, userId',
    members: '[shelfId+userId], shelfId',
    meta: 'key',
    outbox: '++seq, recordId, state',
    photos: 'path',
    photoDrafts: 'side',
    sections: 'id, shelfId',
  });
  const stored = (id: string, genre: string, over: Record<string, unknown> = {}) => ({
    ...savedBeforeDetails(id), funFact: null, funFactSource: null, coverImageUrl: null, genre, ...over,
  });
  await v6.table('records').bulkPut([
    stored(OLD_A, 'popsoul', { importKey: imported ? KAHRMAN_KEY : null }),
    stored(QUEUED_B, 'christmas'),
  ]);
  if (sections.length > 0) await v6.table('sections').bulkPut(sections);
  await v6.table('meta').bulkPut([
    { key: `lastPulledAt:${SHELF}`, value: OLD },
    ...(signedIn ? [{ key: 'session', value: JSON.stringify({ userId: ME, email: 'me@example.com', shelfId: SHELF }) }] : []),
  ]);
  const card = { shelfId: SHELF, userId: ME, createdAt: OLD, state: 'waiting', reason: null };
  await v6.table('outbox').bulkAdd([
    { ...card, kind: 'record.create', recordId: QUEUED_B, fields: stored(QUEUED_B, 'christmas') },
    { ...card, kind: 'record.patch', recordId: OLD_A, fields: { genre: 'reggae', year: 1960 } },
    { ...card, kind: 'record.patch', recordId: QUEUED_B, fields: { notes: 'no genre here' } },
  ]);
  v6.close();
}

describe('version 7', () => {
  it('moves every record and queued change onto its section, seeds Kahrman’s nine and forgets the last pull, offline', async () => {
    await version6Phone({ imported: true });
    const fake = new FakeBackend({ records: [], ratings: [], members: [] });
    fake.online = false;
    const db = new ShelfDB(name);

    const [a, b] = [(await db.records.get(OLD_A))!, (await db.records.get(QUEUED_B))!];
    expect(a.sectionId).toBe(sectionIdFor(SHELF, 'popsoul'));
    expect(b.sectionId).toBe(sectionIdFor(SHELF, 'christmas'));
    for (const r of [a, b]) {
      expect(r).not.toHaveProperty('genre');
      expect(RecordSchema.safeParse(r).success).toBe(true);
    }

    const sections = await db.sections.orderBy('id').toArray();
    expect(sections.sort((x, y) => x.position - y.position).map((s) => [s.position, s.name, s.color, s.id])).toEqual(
      KAHRMANS_NINE.map((s, i) => [i, s.name, s.color, sectionIdFor(SHELF, s.legacyGenre)]),
    );
    for (const s of sections) expect(SectionSchema.safeParse(s).success).toBe(true);
    expect(sections.find((s) => s.isCatchAll)?.name).toBe('Miscellaneous');

    expect((await db.meta.toArray()).map((m) => m.key)).toEqual(['session']);

    const [create, genrePatch, otherPatch] = await db.outbox.orderBy('seq').toArray();
    expect(create.kind === 'record.create' && create.fields).toMatchObject({ sectionId: sectionIdFor(SHELF, 'christmas') });
    expect(create.fields).not.toHaveProperty('genre');
    expect(RecordSchema.safeParse(create.fields).success).toBe(true);
    expect(genrePatch.fields).toEqual({ sectionId: sectionIdFor(SHELF, 'reggae'), year: 1960 });
    expect(otherPatch.fields).toEqual({ notes: 'no genre here' });

    // Offline, the phone still works: a sync attempt changes nothing, and the queued changes wait.
    expect(await pushOutbox(db, fake)).toMatchObject({ sent: 0, noSignal: true });
    expect(await db.sections.count()).toBe(9);

    // Back online, the unsent changes send, with section ids and never a genre.
    fake.online = true;
    await fake.insertRecord(newRecordToRow({ ...a, sectionId: sectionIdFor(SHELF, 'popsoul') }));
    expect(await pushOutbox(db, fake)).toMatchObject({ sent: 3, rejected: 0 });
    expect(fake.recordRow(QUEUED_B)).toMatchObject({ section_id: sectionIdFor(SHELF, 'christmas') });
    expect(fake.recordRow(QUEUED_B)).not.toHaveProperty('genre');
    expect(fake.recordRow(OLD_A)).toMatchObject({ section_id: sectionIdFor(SHELF, 'reggae'), year: 1960 });
    db.close();
  });

  it('seeds the starter set on a shelf with no imported records', async () => {
    await version6Phone({ imported: false });
    const db = new ShelfDB(name);
    const sections = (await db.sections.toArray()).sort((x, y) => x.position - y.position);
    expect(sections.map((s) => [s.position, s.name, s.id])).toEqual(STARTER_SET.map((s, i) => [i, s.name, sectionIdFor(SHELF, s.legacyGenre)]));
    expect(sections.find((s) => s.isCatchAll)?.name).toBe('Everything else');
    expect((await db.records.get(OLD_A))?.sectionId).toBe(sectionIdFor(SHELF, 'popsoul'));
    db.close();
  });

  it('keeps sections the phone already has', async () => {
    const own: Section = {
      id: sectionIdFor(SHELF, 'misc'), shelfId: SHELF, name: 'Odds and ends', color: 'sand', position: 0, discogsGenres: [],
      takesHoliday: false, isCatchAll: true, legacyGenre: 'misc', updatedAt: OLD,
    };
    await version6Phone({ imported: true, sections: [own] });
    const db = new ShelfDB(name);
    expect(await db.sections.toArray()).toEqual([own]);
    db.close();
  });

  it('seeds nothing without a remembered session, but still moves the records', async () => {
    await version6Phone({ imported: true, signedIn: false });
    const db = new ShelfDB(name);
    expect(await db.sections.count()).toBe(0);
    expect((await db.records.get(OLD_A))?.sectionId).toBe(sectionIdFor(SHELF, 'popsoul'));
    db.close();
  });
});
