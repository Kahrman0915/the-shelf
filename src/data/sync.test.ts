import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeBackend, collectionRows } from '@/test/fakeBackend';
import { ShelfDB } from './db';
import { RowError, type RecordRow } from './rowMapping';
import { pullShelf } from './sync';

const K = '11111111-1111-4111-8111-111111111111';
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
});
