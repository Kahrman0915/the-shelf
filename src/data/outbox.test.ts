import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from './backend';
import { ShelfDB } from './db';
import { applyPostcard, ensureStorageKept, savePostcards, storageKept, type NewPostcard } from './outbox';
import type { ShelfRecord } from './schema';

const SHELF = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const REC = '33333333-3333-4333-8333-333333333333';
const WHEN = '2026-11-11T10:00:00.000Z';

function record(over: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: REC,
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
    createdAt: WHEN,
    updatedAt: WHEN,
    deletedAt: null,
    importKey: null,
    ...over,
  };
}

const base = { shelfId: SHELF, recordId: REC, userId: ME, createdAt: WHEN };
const create = (fields = record()): NewPostcard => ({ ...base, kind: 'record.create', fields });
const patch = (fields: Partial<ShelfRecord>): NewPostcard => ({ ...base, kind: 'record.patch', fields });
const rate = (value: number): NewPostcard => ({ ...base, kind: 'rating.set', fields: { value } });

let db: ShelfDB;
beforeEach(() => {
  db = new ShelfDB('outbox-test-' + crypto.randomUUID());
});
afterEach(async () => {
  await db.delete();
});

const apply = (p: NewPostcard) => db.transaction('rw', [db.records, db.ratings], () => applyPostcard(db, p));

describe('applyPostcard', () => {
  it('record.create puts the record when it is missing', async () => {
    await apply(create());
    expect(await db.records.get(REC)).toEqual(record());
  });

  it('record.create leaves an existing record alone', async () => {
    await db.records.put(record({ artist: 'Already here' }));
    await apply(create());
    expect((await db.records.get(REC))?.artist).toBe('Already here');
  });

  it('record.patch merges only the given fields', async () => {
    await db.records.put(record());
    await apply(patch({ wantsUpgrade: true }));
    expect(await db.records.get(REC)).toEqual(record({ wantsUpgrade: true }));
  });

  it('record.patch on a missing record changes nothing', async () => {
    await apply(patch({ wantsUpgrade: true }));
    expect(await db.records.count()).toBe(0);
  });

  it('rating.set stores my rating with the postcard’s createdAt as updatedAt', async () => {
    await db.records.put(record());
    await apply(rate(4));
    expect(await db.ratings.get([REC, ME])).toEqual({ recordId: REC, userId: ME, value: 4, updatedAt: WHEN });
  });

  it('rating.set moves a new arrival to owned', async () => {
    await db.records.put(record({ status: 'new_arrival' }));
    await apply(rate(5));
    expect((await db.records.get(REC))?.status).toBe('owned');
  });

  it('rating.set leaves owned and wanted as they were', async () => {
    for (const status of ['owned', 'wanted'] as const) {
      await db.records.put(record({ status }));
      await apply(rate(3));
      expect((await db.records.get(REC))?.status).toBe(status);
    }
  });

  it('a create whose record has a different id from the postcard’s throws and writes nothing', async () => {
    const OTHER = '44444444-4444-4444-8444-444444444444';
    await expect(apply(create(record({ id: OTHER })))).rejects.toBeInstanceOf(BackendError);
    expect(await db.records.count()).toBe(0);
  });

  it('a patch that would change the record’s id throws and writes nothing', async () => {
    const OTHER = '44444444-4444-4444-8444-444444444444';
    await db.records.put(record());
    await expect(apply(patch({ id: OTHER }))).rejects.toBeInstanceOf(BackendError);
    expect(await db.records.toArray()).toEqual([record()]);
  });

  it('a patch naming the record’s own id is fine', async () => {
    await db.records.put(record());
    await apply(patch({ id: REC, notes: 'Same record' }));
    expect((await db.records.get(REC))?.notes).toBe('Same record');
  });

  it('a patch that breaks the record rules throws and writes nothing', async () => {
    await db.records.put(record());
    await expect(apply(patch({ artist: '' }))).rejects.toBeInstanceOf(BackendError);
    expect(await db.records.get(REC)).toEqual(record());
  });
});

describe('savePostcards', () => {
  it('is all or nothing', async () => {
    await db.records.put(record());
    await expect(savePostcards(db, [patch({ wantsUpgrade: true }), patch({ artist: '' })])).rejects.toBeInstanceOf(BackendError);
    expect(await db.records.get(REC)).toEqual(record());
    expect(await db.outbox.count()).toBe(0);
  });

  it('queues postcards in order with state waiting', async () => {
    await db.records.put(record());
    await savePostcards(db, [patch({ wantsUpgrade: true }), rate(2)]);
    const queued = await db.outbox.orderBy('seq').toArray();
    expect(queued.map((q) => q.kind)).toEqual(['record.patch', 'rating.set']);
    expect(queued.every((q) => q.state === 'waiting' && q.reason === null)).toBe(true);
    expect(queued[0].seq).toBeLessThan(queued[1].seq);
    expect((await db.records.get(REC))?.wantsUpgrade).toBe(true);
  });

  describe('when the browser’s keep-data request misbehaves', () => {
    function stubPersist(persist: () => Promise<boolean>) {
      Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true });
    }
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'storage');
      vi.restoreAllMocks();
    });

    it('a refused request still saves, and is logged', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const blocked = new Error('blocked');
      stubPersist(() => Promise.reject(blocked));
      await db.records.put(record());
      await expect(savePostcards(db, [patch({ wantsUpgrade: true })])).resolves.toBeUndefined();
      expect(await db.outbox.count()).toBe(1);
      await vi.waitFor(() => expect(logged).toHaveBeenCalledWith(blocked));
    });

    it('a request that never answers (a permission prompt) doesn’t hold the save up', async () => {
      stubPersist(() => new Promise<boolean>(() => {}));
      await db.records.put(record());
      await expect(savePostcards(db, [patch({ wantsUpgrade: true })])).resolves.toBeUndefined();
      expect(await db.outbox.count()).toBe(1);
    });
  });
});

describe('ensureStorageKept', () => {
  it('asks once and remembers', async () => {
    let calls = 0;
    const storage = { persist: async () => (calls++, true) };
    expect(await storageKept(db)).toBeNull();
    expect(await ensureStorageKept(db, storage)).toBe(true);
    expect(await ensureStorageKept(db, storage)).toBe(true);
    expect(calls).toBe(1);
    expect(await storageKept(db)).toBe(true);
  });

  it('stores and returns false with no storage argument and no navigator.storage', async () => {
    expect(await ensureStorageKept(db)).toBe(false);
    expect(await storageKept(db)).toBe(false);
  });
});
