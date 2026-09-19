import { afterEach, describe, expect, it } from 'vitest';
import collection from '../../collection.json';
import { ShelfDB } from './db';
import { ImportError } from './importCollection';
import { seedIfEmpty } from './seed';

const ctx = { shelfId: 'shelf-1', userId: 'user-k', newId: () => crypto.randomUUID() };
let db: ShelfDB;

afterEach(async () => {
  await db.delete();
});

describe('seedIfEmpty', () => {
  it('seeds an empty database once', async () => {
    db = new ShelfDB(`test-${crypto.randomUUID()}`);
    expect(await seedIfEmpty(db, collection, ctx)).toBe('seeded');
    expect(await db.records.count()).toBe(11);
    expect(await db.ratings.count()).toBe(6);
    expect(await seedIfEmpty(db, collection, ctx)).toBe('already-seeded');
    expect(await db.records.count()).toBe(11);
  });

  it('writes nothing when the collection is bad', async () => {
    db = new ShelfDB(`test-${crypto.randomUUID()}`);
    const bad = JSON.parse(JSON.stringify(collection)) as { records: Record<string, unknown>[] };
    bad.records[5].genre = 'polka';
    await expect(seedIfEmpty(db, bad, ctx)).rejects.toBeInstanceOf(ImportError);
    expect(await db.records.count()).toBe(0);
  });

  it('lets only one of two concurrent seed calls actually seed', async () => {
    db = new ShelfDB(`test-${crypto.randomUUID()}`);
    const results = await Promise.all([seedIfEmpty(db, collection, ctx), seedIfEmpty(db, collection, ctx)]);
    expect(results.sort()).toEqual(['already-seeded', 'seeded']);
    expect(await db.records.count()).toBe(11);
    expect(await db.ratings.count()).toBe(6);
  });
});
