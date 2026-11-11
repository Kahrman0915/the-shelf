import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeBackend, collectionRows } from '@/test/fakeBackend';
import { ShelfDB } from './db';
import { savePostcards } from './outbox';
import { RowError, type RecordRow } from './rowMapping';
import { forgetLastPull, pullShelf } from './sync';

const K = '11111111-1111-4111-8111-111111111111';
const WHEN = '2026-11-11T10:00:00.000Z';
const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db: ShelfDB;
let backend: FakeBackend;
let rows: { records: RecordRow[]; ratings: ReturnType<typeof collectionRows>['ratings'] };

beforeEach(() => {
  db = new ShelfDB(`sync-${crypto.randomUUID()}`);
  rows = collectionRows(SHELF, K);
  backend = new FakeBackend({
    records: rows.records,
    ratings: rows.ratings,
    members: [{ shelfId: SHELF, userId: K, role: 'owner', displayName: 'Kahrman' }],
  });
});

afterEach(async () => {
  await db.delete();
});

describe('pullShelf', () => {
  it('fills an empty phone with the shelf, its ratings and its people', async () => {
    await pullShelf(db, backend, SHELF);
    expect(await db.records.count()).toBe(11);
    expect(await db.ratings.count()).toBe(6);
    expect(await db.members.toArray()).toEqual([{ shelfId: SHELF, userId: K, role: 'owner', displayName: 'Kahrman' }]);
  });

  it('picks up a change made on another phone', async () => {
    await pullShelf(db, backend, SHELF);
    const pershing = rows.records.find((r) => r.import_key === 'ahmad-jamal-pershing')!;
    backend.touchRecord(pershing.id, { notes: 'Megan says play side B first' });
    await pullShelf(db, backend, SHELF);
    expect((await db.records.get(pershing.id))?.notes).toBe('Megan says play side B first');
  });

  it('drops a rating that was removed on the server', async () => {
    await pullShelf(db, backend, SHELF);
    const rated = rows.ratings[0];
    backend.dropRating(rated.record_id, rated.user_id);
    await pullShelf(db, backend, SHELF);
    expect(await db.ratings.count()).toBe(5);
  });

  it('keeps soft-deleted records so every phone learns about the delete', async () => {
    await pullShelf(db, backend, SHELF);
    const gone = rows.records[0];
    backend.touchRecord(gone.id, { deleted_at: new Date().toISOString() });
    await pullShelf(db, backend, SHELF);
    expect((await db.records.get(gone.id))?.deletedAt).not.toBeNull();
  });

  it('writes nothing when the server sends a row it doesn’t understand', async () => {
    const bad = new FakeBackend({ records: [{ ...rows.records[0], genre: 'polka' as RecordRow['genre'] }], ratings: [], members: [] });
    await expect(pullShelf(db, bad, SHELF)).rejects.toBeInstanceOf(RowError);
    expect(await db.records.count()).toBe(0);
  });

  it('keeps what is on the phone when there is no signal', async () => {
    await pullShelf(db, backend, SHELF);
    backend.online = false;
    await expect(pullShelf(db, backend, SHELF)).rejects.toThrow('No signal');
    expect(await db.records.count()).toBe(11);
  });

  it('a pull keeps my waiting patch on top', async () => {
    const rec = rows.records[0];
    backend.touchRecord(rec.id, { disc_grade: 'NM' });
    await pullShelf(db, backend, SHELF);
    await savePostcards(db, [{ kind: 'record.patch', shelfId: SHELF, recordId: rec.id, userId: K, createdAt: WHEN, fields: { discGrade: 'VG+' } }]);
    backend.touchRecord(rec.id, { notes: 'From the other phone' });
    await pullShelf(db, backend, SHELF);
    const after = await db.records.get(rec.id);
    expect([after?.discGrade, after?.notes]).toEqual(['VG+', 'From the other phone']);
  });

  it('a pull keeps my waiting rating and its shelf move', async () => {
    const rec = rows.records.find((r) => !rows.ratings.some((x) => x.record_id === r.id))!;
    backend.touchRecord(rec.id, { status: 'new_arrival' });
    await pullShelf(db, backend, SHELF);
    await savePostcards(db, [{ kind: 'rating.set', shelfId: SHELF, recordId: rec.id, userId: K, createdAt: WHEN, fields: { value: 4 } }]);
    backend.touchRecord(rec.id, { notes: 'Still new on the server' });
    await pullShelf(db, backend, SHELF);
    expect((await db.records.get(rec.id))?.status).toBe('owned');
    expect((await db.ratings.get([rec.id, K]))?.value).toBe(4);
  });

  it('a postcard that no longer applies is set aside, and the pull still lands', async () => {
    const [first, second] = rows.records;
    await pullShelf(db, backend, SHELF);
    const bad = await db.outbox.add({ kind: 'record.patch', shelfId: SHELF, recordId: first.id, userId: K, createdAt: WHEN, fields: { artist: '' }, state: 'waiting', reason: null });
    await db.outbox.add({ kind: 'record.patch', shelfId: SHELF, recordId: second.id, userId: K, createdAt: WHEN, fields: { notes: 'Mine' }, state: 'waiting', reason: null });
    backend.touchRecord(first.id, { notes: 'From the other phone' });

    await pullShelf(db, backend, SHELF);

    const setAside = await db.outbox.get(bad);
    expect(setAside?.state).toBe('rejected');
    expect(setAside?.reason).toMatch(/^Record rules broken: artist/);
    expect((await db.records.get(first.id))?.notes).toBe('From the other phone');
    expect((await db.records.get(first.id))?.artist).toBe(first.artist);
    expect((await db.records.get(second.id))?.notes).toBe('Mine');
  });
});

describe('forgetLastPull', () => {
  it('makes the next pull ask for everything', async () => {
    await pullShelf(db, backend, SHELF);
    await forgetLastPull(db, SHELF);
    expect(await db.meta.get(`lastPulledAt:${SHELF}`)).toBeUndefined();
  });
});
