import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeBackend } from '@/test/fakeBackend';
import {
  addRecord,
  boughtIt,
  boughtNew,
  buyKind,
  changedFields,
  deleteRecord,
  didntBuyIt,
  editRecord,
  FORM_FIELDS,
  perform,
  rate,
  restoreWithEdits,
  type Ctx,
  type RecordFields,
} from './actions';
import { BackendError } from './backend';
import { pushOutbox, syncOnce } from './courier';
import { ShelfDB, writeSession } from './db';
import { recordToRow } from './rowMapping';
import type { ShelfRecord } from './schema';
import { pullShelf } from './sync';

const SHELF = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333';
const NEW_ID = '55555555-5555-4555-8555-555555555555';
const OLD = '2026-10-01T10:00:00.000Z';
const NOW = '2026-11-11T10:00:00.000Z';
const ctx: Ctx = { me: ME, now: NOW };

function record(over: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: A,
    shelfId: SHELF,
    status: 'owned',
    wantsUpgrade: false,
    upgradeNote: null,
    artist: 'Miles Davis',
    title: 'Kind of Blue',
    label: null,
    catalog: null,
    year: null,
    format: null,
    genre: 'jazz',
    discGrade: null,
    sleeveGrade: null,
    pricePaid: null,
    nmEstimateLow: null,
    nmEstimateHigh: null,
    valueNote: null,
    notes: null,
    discogsReleaseId: null,
    coverPath: null,
    funFact: null,
    funFactSource: null,
    coverImageUrl: null,
    boughtAt: null,
    addedBy: ME,
    createdAt: OLD,
    updatedAt: OLD,
    deletedAt: null,
    importKey: null,
    ...over,
  };
}

const want = (over: Partial<ShelfRecord> = {}) => record({ status: 'wanted', discGrade: 'G', pricePaid: 4, ...over });
const upgrade = (over: Partial<ShelfRecord> = {}) =>
  record({ wantsUpgrade: true, upgradeNote: 'find a cleaner copy', discGrade: 'VG', sleeveGrade: 'VG', pricePaid: 8, boughtAt: OLD, ...over });

describe('buyKind', () => {
  it('names the two cases where Bought it applies', () => {
    expect(buyKind(record({ status: 'wanted' }))).toBe('want');
    expect(buyKind(record({ wantsUpgrade: true }))).toBe('upgrade');
    expect(buyKind(record())).toBeNull();
    expect(buyKind(record({ status: 'new_arrival' }))).toBeNull();
  });
});

describe('boughtIt', () => {
  it('moves a want to new arrivals and can put it back', () => {
    const r = want();
    const { postcards, undo } = boughtIt(r, { grade: 'VG+', pricePaid: 15 }, ctx);
    expect(postcards).toEqual([
      { kind: 'record.patch', shelfId: SHELF, recordId: A, userId: ME, createdAt: NOW, fields: { status: 'new_arrival', boughtAt: NOW, discGrade: 'VG+', pricePaid: 15 } },
    ]);
    expect(undo).toEqual([
      { kind: 'record.patch', shelfId: SHELF, recordId: A, userId: ME, createdAt: NOW, fields: { status: 'wanted', boughtAt: null, discGrade: 'G', pricePaid: 4 } },
    ]);
  });

  it('logs an upgrade in place and restores all six fields', () => {
    const r = upgrade();
    const { postcards, undo } = boughtIt(r, { grade: 'NM', pricePaid: 20 }, ctx);
    expect(postcards).toHaveLength(1);
    expect(postcards[0].fields).toEqual({ discGrade: 'NM', sleeveGrade: null, pricePaid: 20, boughtAt: NOW, wantsUpgrade: false, upgradeNote: null });
    expect(postcards[0].fields).not.toHaveProperty('status');
    expect(undo).toEqual([
      {
        kind: 'record.patch',
        shelfId: SHELF,
        recordId: A,
        userId: ME,
        createdAt: NOW,
        fields: { discGrade: 'VG', sleeveGrade: 'VG', pricePaid: 8, boughtAt: OLD, wantsUpgrade: true, upgradeNote: 'find a cleaner copy' },
      },
    ]);
  });

  it('refuses a record that is neither a want nor an upgrade', () => {
    expect(() => boughtIt(record(), { grade: 'NM', pricePaid: null }, ctx)).toThrow(BackendError);
    expect(() => boughtIt(record(), { grade: 'NM', pricePaid: null }, ctx)).toThrow(
      'Bought it is only for records on the want list or marked for an upgrade.',
    );
  });

  it('refuses buying the same want twice', async () => {
    const r = want();
    const first = boughtIt(r, { grade: 'VG+', pricePaid: 15 }, ctx);
    const bought = { ...r, ...(first.postcards[0].fields as Partial<ShelfRecord>) };
    expect(() => boughtIt(bought, { grade: 'VG+', pricePaid: 15 }, ctx)).toThrow(BackendError);
    const upgraded = { ...upgrade(), ...boughtIt(upgrade(), { grade: 'NM', pricePaid: 20 }, ctx).postcards[0].fields } as ShelfRecord;
    expect(() => boughtIt(upgraded, { grade: 'NM', pricePaid: 20 }, ctx)).toThrow(BackendError);
  });
});

describe('boughtNew', () => {
  const input = { artist: '  Nina Simone ', title: ' Pastel Blues ', genre: 'jazz' as const, grade: 'VG+' as const, pricePaid: 12 };
  const c = { ...ctx, shelfId: SHELF, newId: NEW_ID };

  it('creates a new arrival and can soft-delete it', () => {
    const { postcards, undo } = boughtNew(input, c);
    expect(postcards).toHaveLength(1);
    const p = postcards[0];
    expect(p.kind).toBe('record.create');
    expect(p.recordId).toBe(NEW_ID);
    expect(p.shelfId).toBe(SHELF);
    if (p.kind !== 'record.create') throw new Error('unreachable');
    expect(p.fields).toMatchObject({
      id: NEW_ID,
      shelfId: SHELF,
      status: 'new_arrival',
      artist: 'Nina Simone',
      title: 'Pastel Blues',
      genre: 'jazz',
      discGrade: 'VG+',
      sleeveGrade: null,
      pricePaid: 12,
      boughtAt: NOW,
      addedBy: ME,
      wantsUpgrade: false,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    expect(undo).toEqual([
      { kind: 'record.patch', shelfId: SHELF, recordId: NEW_ID, userId: ME, createdAt: NOW, fields: { deletedAt: NOW } },
    ]);
  });

  it('throws naming the field when it would break the record rules', () => {
    expect(() => boughtNew({ ...input, title: '  ' }, c)).toThrow(/title/);
    expect(() => boughtNew({ ...input, title: '  ' }, c)).toThrow(BackendError);
    expect(() => boughtNew({ ...input, artist: '' }, c)).toThrow(/artist/);
  });
});

describe('didntBuyIt', () => {
  it('removes a new arrival with no undo', () => {
    const r = record({ status: 'new_arrival' });
    expect(didntBuyIt(r, ctx)).toEqual({
      postcards: [{ kind: 'record.patch', shelfId: SHELF, recordId: A, userId: ME, createdAt: NOW, fields: { deletedAt: NOW } }],
      undo: null,
    });
  });

  it('refuses anything else', () => {
    expect(() => didntBuyIt(record(), ctx)).toThrow('Only new arrivals can be removed this way.');
  });
});

describe('rate', () => {
  it('sets a rating with no undo', () => {
    expect(rate(record({ status: 'new_arrival' }), 4, ctx)).toEqual({
      postcards: [{ kind: 'rating.set', shelfId: SHELF, recordId: A, userId: ME, createdAt: NOW, fields: { value: 4 } }],
      undo: null,
    });
    expect(rate(record(), 5, ctx).postcards).toHaveLength(1);
  });

  it('refuses a want and out-of-range values', () => {
    expect(() => rate(record({ status: 'wanted' }), 4, ctx)).toThrow('You can rate records you’ve bought.');
    for (const v of [0, 6, 2.5, NaN]) expect(() => rate(record(), v, ctx)).toThrow('A rating is 1 to 5.');
  });
});

describe('undo after the purchase reached the server', () => {
  let db: ShelfDB;
  let fake: FakeBackend;

  beforeEach(async () => {
    db = new ShelfDB(`actions-${crypto.randomUUID()}`);
    await writeSession(db, { userId: ME, email: 'me@example.com', shelfId: SHELF });
    fake = new FakeBackend({ records: [recordToRow(want())], ratings: [], members: [] });
    await pullShelf(db, fake, SHELF);
  });
  afterEach(async () => {
    await db.delete();
  });

  it('reverses a new purchase there', async () => {
    const { postcards, undo } = boughtNew(
      { artist: 'Nina Simone', title: 'Pastel Blues', genre: 'jazz', grade: 'VG+', pricePaid: 12 },
      { ...ctx, shelfId: SHELF, newId: NEW_ID },
    );
    await perform(db, postcards);
    await pushOutbox(db, fake);
    expect(fake.recordRow(NEW_ID)?.deleted_at).toBeNull();
    await perform(db, undo!);
    await pushOutbox(db, fake);
    expect(fake.recordRow(NEW_ID)?.deleted_at).toBeTruthy();
  });

  it('reverses Bought it on a want there', async () => {
    const r = (await db.records.get(A))!;
    const { postcards, undo } = boughtIt(r, { grade: 'VG+', pricePaid: 15 }, ctx);
    await perform(db, postcards);
    await pushOutbox(db, fake);
    expect(fake.recordRow(A)?.status).toBe('new_arrival');
    await perform(db, undo!);
    await pushOutbox(db, fake);
    expect(fake.recordRow(A)?.status).toBe('wanted');
    expect((await db.records.get(A))?.status).toBe('wanted');
  });

  it('runs after() once the postcards are saved', async () => {
    let seen = -1;
    await perform(db, boughtIt((await db.records.get(A))!, { grade: 'NM', pricePaid: null }, ctx).postcards, () => {
      void db.outbox.count().then((n) => (seen = n));
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toBe(1);
  });
});

/** The form's view of a record: just the fields Add and Edit show. */
function formOf(r: ShelfRecord): RecordFields {
  return Object.fromEntries(FORM_FIELDS.map((k) => [k, r[k]])) as RecordFields;
}

describe('addRecord', () => {
  const c = { ...ctx, shelfId: SHELF, newId: NEW_ID };
  const fields: RecordFields = { ...formOf(record()), artist: 'Nina Simone', title: 'Pastel Blues', year: 1965, discGrade: 'VG+' };

  it('makes an owned record and, with a rating, a rating postcard', () => {
    const { postcards, undo } = addRecord(fields, 4, c);
    expect(postcards).toHaveLength(2);
    const [create, rating] = postcards;
    if (create.kind !== 'record.create') throw new Error('expected record.create first');
    expect(create).toMatchObject({ shelfId: SHELF, recordId: NEW_ID, userId: ME, createdAt: NOW });
    expect(create.fields).toEqual({
      ...fields,
      id: NEW_ID,
      shelfId: SHELF,
      status: 'owned',
      wantsUpgrade: false,
      upgradeNote: null,
      discogsReleaseId: null,
      coverPath: null,
      coverImageUrl: null,
      boughtAt: null,
      addedBy: ME,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      importKey: null,
    });
    expect(rating).toEqual({ kind: 'rating.set', shelfId: SHELF, recordId: NEW_ID, userId: ME, createdAt: NOW, fields: { value: 4 } });
    expect(undo).toBeNull();

    expect(addRecord(fields, null, c).postcards).toHaveLength(1);
  });

  it('refuses an empty title', () => {
    expect(() => addRecord({ ...fields, title: '' }, null, c)).toThrow(/title/);
    expect(() => addRecord({ ...fields, title: '' }, null, c)).toThrow(BackendError);
  });
});

describe('changedFields', () => {
  it('keeps only the fields that differ, comparing numbers and nulls exactly', () => {
    const opened = formOf(record({ year: 1966, pricePaid: 0 }));
    expect(changedFields(opened, { ...opened })).toEqual({});
    expect(changedFields(opened, { ...opened, year: null, pricePaid: null, notes: 'warm' })).toEqual({ year: null, pricePaid: null, notes: 'warm' });
  });

  it('sends the estimate pair and the fun fact pair whole when either half changed', () => {
    const opened = formOf(record({ nmEstimateLow: 10, nmEstimateHigh: 20, funFact: 'Cut in two days.', funFactSource: 'https://example.com/a' }));
    expect(changedFields(opened, { ...opened, nmEstimateLow: 12 })).toEqual({ nmEstimateLow: 12, nmEstimateHigh: 20 });
    expect(changedFields(opened, { ...opened, nmEstimateHigh: 30 })).toEqual({ nmEstimateLow: 10, nmEstimateHigh: 30 });
    expect(changedFields(opened, { ...opened, funFactSource: 'https://example.com/b' })).toEqual({
      funFact: 'Cut in two days.',
      funFactSource: 'https://example.com/b',
    });
    expect(changedFields(opened, { ...opened, funFact: 'Cut in one day.' })).toEqual({ funFact: 'Cut in one day.', funFactSource: 'https://example.com/a' });
  });
});

describe('editRecord', () => {
  it('sends only what changed', () => {
    const r = record({ year: 1966 });
    const opened = formOf(r);
    const { postcards, undo } = editRecord(r, opened, { ...opened, year: 1967 }, ctx);
    expect(postcards).toEqual([{ kind: 'record.patch', shelfId: SHELF, recordId: A, userId: ME, createdAt: NOW, fields: { year: 1967 } }]);
    expect(undo).toBeNull();
  });

  it('sends nothing when nothing changed', () => {
    const r = record({ year: 1966 });
    expect(editRecord(r, formOf(r), formOf(r), ctx)).toEqual({ postcards: [], undo: null });
  });

  it('refuses an edit that breaks the record rules', () => {
    const r = record();
    expect(() => editRecord(r, formOf(r), { ...formOf(r), nmEstimateLow: 30, nmEstimateHigh: 10 }, ctx)).toThrow(/nmEstimateLow/);
    expect(() => editRecord(r, formOf(r), { ...formOf(r), year: 1800 }, ctx)).toThrow(BackendError);
  });
});

describe('deleteRecord', () => {
  it('marks it deleted, with an undo that clears the mark', () => {
    expect(deleteRecord(record({ status: 'wanted' }), ctx)).toEqual({
      postcards: [{ kind: 'record.patch', shelfId: SHELF, recordId: A, userId: ME, createdAt: NOW, fields: { deletedAt: NOW } }],
      undo: [{ kind: 'record.patch', shelfId: SHELF, recordId: A, userId: ME, createdAt: NOW, fields: { deletedAt: null } }],
    });
  });
});

describe('restoreWithEdits', () => {
  it('clears deletedAt and applies the edits in one patch', () => {
    const r = record({ deletedAt: OLD, year: 1966 });
    const opened = formOf(r);
    const { postcards, undo } = restoreWithEdits(r, opened, { ...opened, year: 1967, notes: 'first press' }, ctx);
    expect(postcards).toEqual([
      { kind: 'record.patch', shelfId: SHELF, recordId: A, userId: ME, createdAt: NOW, fields: { deletedAt: null, year: 1967, notes: 'first press' } },
    ]);
    expect(undo).toBeNull();
  });

  it('refuses edits that break the record rules', () => {
    const r = record({ deletedAt: OLD });
    expect(() => restoreWithEdits(r, formOf(r), { ...formOf(r), artist: '' }, ctx)).toThrow(/artist/);
  });
});

describe('edits and deletes against the server', () => {
  let db: ShelfDB;
  let fake: FakeBackend;

  beforeEach(async () => {
    db = new ShelfDB(`actions-edit-${crypto.randomUUID()}`);
    await writeSession(db, { userId: ME, email: 'me@example.com', shelfId: SHELF });
    fake = new FakeBackend({ records: [recordToRow(record({ year: 1966, nmEstimateLow: 10, nmEstimateHigh: 20 }))], ratings: [], members: [] });
    await pullShelf(db, fake, SHELF);
  });
  afterEach(async () => {
    await db.delete();
  });

  it('two people editing different fields both keep their change', async () => {
    const mine = (await db.records.get(A))!;
    const opened = formOf(mine);
    fake.touchRecord(A, { notes: 'Megan: plays clean' });

    const { postcards } = editRecord(mine, opened, { ...opened, year: 1967 }, ctx);
    await perform(db, postcards);
    await pushOutbox(db, fake);
    await syncOnce(db, fake, SHELF);

    expect(fake.recordRow(A)).toMatchObject({ notes: 'Megan: plays clean', year: 1967 });
    expect(await db.records.get(A)).toMatchObject({ notes: 'Megan: plays clean', year: 1967 });
  });

  it('an estimate edited against a stale form keeps low and high together on both phones', async () => {
    // The record is 10/20. Megan lowers high to 15; Kahrman's form still shows 10/20 and he raises low to 18.
    // Sending low alone would leave the server at 18/15, which breaks the record rules.
    const mine = (await db.records.get(A))!;
    const opened = formOf(mine);
    fake.touchRecord(A, { nm_estimate_high: 15 });

    const { postcards } = editRecord(mine, opened, { ...opened, nmEstimateLow: 18 }, ctx);
    expect(postcards[0].fields).toEqual({ nmEstimateLow: 18, nmEstimateHigh: 20 });
    await perform(db, postcards);
    expect(await syncOnce(db, fake, SHELF)).toMatchObject({ rejected: 0 });

    expect(fake.recordRow(A)).toMatchObject({ nm_estimate_low: 18, nm_estimate_high: 20 });
    expect(await db.records.get(A)).toMatchObject({ nmEstimateLow: 18, nmEstimateHigh: 20 });
    expect(await db.outbox.count()).toBe(0);
  });

  it('deleteRecord marks it deleted; Undo after it reached the server brings it back', async () => {
    const { postcards, undo } = deleteRecord((await db.records.get(A))!, ctx);
    await perform(db, postcards);
    await pushOutbox(db, fake);
    expect(fake.recordRow(A)?.deleted_at).toBeTruthy();
    await perform(db, undo!);
    await pushOutbox(db, fake);
    expect(fake.recordRow(A)?.deleted_at).toBeNull();
    expect((await db.records.get(A))?.deletedAt).toBeNull();
  });
});
