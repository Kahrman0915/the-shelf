import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeBackend } from '@/test/fakeBackend';
import { deleteRecord, editRecord, FORM_FIELDS, perform, type Ctx, type RecordFields } from './actions';
import { pushOutbox } from './courier';
import { ShelfDB, writeSession } from './db';
import { applyPostcard } from './outbox';
import { recordToRow } from './rowMapping';
import { RecordSchema, type ShelfRecord } from './schema';
import { pullShelf } from './sync';

const SHELF = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const OLD_A = '33333333-3333-4333-8333-333333333333';
const QUEUED_B = '44444444-4444-4444-8444-444444444444';
const OLD = '2026-10-01T10:00:00.000Z';
const NOW = '2026-11-12T10:00:00.000Z';
const ctx: Ctx = { me: ME, now: NOW };

/** A record as a phone saved it before this branch: no funFact, funFactSource or coverImageUrl keys. */
function savedBeforeDetails(id: string): Omit<ShelfRecord, 'funFact' | 'funFactSource' | 'coverImageUrl'> {
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
    const fake = new FakeBackend({ records: [recordToRow({ ...savedBeforeDetails(OLD_A), funFact: null, funFactSource: null, coverImageUrl: null })], ratings: [], members: [] });
    await pullShelf(db, fake, SHELF);
    expect(await db.outbox.where('state').equals('rejected').count()).toBe(0);
    expect(await pushOutbox(db, fake)).toEqual({ sent: 3, rejected: 0, noSignal: false });
    expect(fake.recordRow(OLD_A)).toMatchObject({ year: 1960, deleted_at: NOW });
    expect(fake.recordRow(QUEUED_B)).toMatchObject({ title: 'Kind of Blue', fun_fact: null });
    db.close();
  });
});
