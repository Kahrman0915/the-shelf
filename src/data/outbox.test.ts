import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from './backend';
import { ShelfDB } from './db';
import { applyPostcard, ensureStorageKept, savePostcards, storageKept, type NewPostcard } from './outbox';
import type { Section, ShelfRecord, Suggestion } from './schema';
import { sectionIdFor } from '@/domain/sections';

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
    sectionId: sectionIdFor(SHELF, 'jazz'),
    discGrade: null,
    sleeveGrade: null,
    pricePaid: null,
    nmEstimateLow: null,
    nmEstimateHigh: null,
    valueNote: null,
    notes: null,
    discogsReleaseId: null,
    coverPath: null, backPath: null,
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

const apply = (p: NewPostcard) => db.transaction('rw', [db.records, db.ratings, db.sections, db.suggestions], () => applyPostcard(db, p));

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

describe('photo postcards', () => {
  const PATH = `${SHELF}/${REC}/front-aaaa.jpg`;
  const bytes = () => new Uint8Array([1, 2, 3]).buffer;
  const upload = (): NewPostcard => ({ ...base, kind: 'photo.upload', fields: { path: PATH } });

  it('savePostcards keeps the photo bytes with the postcards, in one go', async () => {
    await savePostcards(db, [create(), upload()], [{ path: PATH, bytes: bytes() }]);
    expect(new Uint8Array((await db.photos.get(PATH))!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect((await db.outbox.toArray()).map((p) => p.kind)).toEqual(['record.create', 'photo.upload']);
  });

  it('saves neither the photo nor the postcard when one in the batch breaks the record rules', async () => {
    await expect(
      savePostcards(db, [upload(), create(record({ artist: '' }))], [{ path: PATH, bytes: bytes() }]),
    ).rejects.toThrow(BackendError);
    expect(await db.photos.get(PATH)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it('photo postcards don’t change the record', async () => {
    await db.records.put(record());
    await apply(upload());
    await apply({ ...base, kind: 'photo.delete', fields: { path: PATH } });
    expect(await db.records.toArray()).toEqual([record()]);
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

describe('applyPostcard: sections', () => {
  const S1 = '00000000-0000-4000-8000-000000000001';
  const S2 = '00000000-0000-4000-8000-000000000002';
  const S3 = '00000000-0000-4000-8000-000000000003';
  const section = (id: string, over: Partial<Section> = {}): Section => ({
    id, shelfId: SHELF, name: 'Rock', color: 'rock', position: 1, discogsGenres: [], takesHoliday: false, isCatchAll: false, legacyGenre: 'misc', updatedAt: WHEN, ...over,
  });
  const sbase = (id: string) => ({ shelfId: SHELF, recordId: id, userId: ME, createdAt: WHEN });
  const sApply = (p: NewPostcard) => db.transaction('rw', [db.records, db.ratings, db.sections], () => applyPostcard(db, p));
  const sCreate = (s: Section): NewPostcard => ({ ...sbase(s.id), kind: 'section.create', fields: s });
  const sPatch = (id: string, fields: Partial<Section>): NewPostcard => ({ ...sbase(id), kind: 'section.patch', fields });
  const sMerge = (from: string, into: string): NewPostcard => ({ ...sbase(from), kind: 'section.merge', fields: { into } });

  it('section.create puts the section when missing and leaves an existing one alone', async () => {
    await sApply(sCreate(section(S1)));
    expect(await db.sections.get(S1)).toEqual(section(S1));
    await sApply(sCreate(section(S1, { name: 'Other' })));
    expect((await db.sections.get(S1))?.name).toBe('Rock');
  });

  it('section.create refuses a section that breaks the rules, and changes nothing', async () => {
    await expect(sApply(sCreate(section(S1, { name: '' })))).rejects.toThrow(BackendError);
    expect(await db.sections.count()).toBe(0);
  });

  it('section.patch merges the given fields, and ignores a missing section', async () => {
    await db.sections.put(section(S1));
    await sApply(sPatch(S1, { name: 'Hard rock', position: 4 }));
    await sApply(sPatch(S1, { name: 'Hard rock', position: 4 }));
    expect(await db.sections.get(S1)).toEqual(section(S1, { name: 'Hard rock', position: 4 }));
    await sApply(sPatch(S2, { name: 'Nope' }));
    expect(await db.sections.get(S2)).toBeUndefined();
  });

  it('section.merge hands over genres and holiday, deletes the section, and is harmless to repeat', async () => {
    await db.sections.bulkPut([
      section(S1, { discogsGenres: ['Rock', 'Blues'], takesHoliday: true }),
      section(S2, { name: 'Jazz', discogsGenres: ['Jazz', 'Blues'] }),
    ]);
    await sApply(sMerge(S1, S2));
    await sApply(sMerge(S1, S2));
    expect(await db.sections.get(S1)).toBeUndefined();
    expect(await db.sections.get(S2)).toMatchObject({ discogsGenres: ['Jazz', 'Blues', 'Rock'], takesHoliday: true });
  });

  it('section.merge moves the section’s records, deleted ones too, and leaves the rest', async () => {
    await db.sections.bulkPut([section(S1), section(S2, { name: 'Jazz' }), section(S3, { name: 'Other' })]);
    await db.records.bulkPut([
      record({ id: '00000000-0000-4000-8000-0000000000a1', sectionId: S1 }),
      record({ id: '00000000-0000-4000-8000-0000000000a2', sectionId: S1, deletedAt: WHEN }),
      record({ id: '00000000-0000-4000-8000-0000000000a3', sectionId: S3 }),
    ]);
    await sApply(sMerge(S1, S2));
    expect((await db.records.orderBy('id').toArray()).map((r) => r.sectionId)).toEqual([S2, S2, S3]);
  });

  it('section.merge that can’t be applied moves no records', async () => {
    // A section stored before a rule it now breaks: the merged section can't be saved, so nothing may change.
    await db.sections.bulkPut([section(S1), section(S2, { name: '' })]);
    await db.records.put(record({ sectionId: S1 }));
    // As the pull's re-apply does: the throw is caught inside the same transaction, so any write before it would stick.
    let thrown: unknown = null;
    await db.transaction('rw', [db.records, db.ratings, db.sections], async () => {
      try {
        await applyPostcard(db, sMerge(S1, S2));
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(BackendError);
    expect((await db.records.get(REC))?.sectionId).toBe(S1);
    expect(await db.sections.get(S1)).toBeDefined();
  });

  it('section.merge does nothing while the section it goes into is not on the phone', async () => {
    await db.sections.put(section(S1, { discogsGenres: ['Rock'] }));
    await db.records.put(record({ sectionId: S1 }));
    await sApply(sMerge(S1, S2));
    expect(await db.sections.get(S1)).toBeDefined();
    expect((await db.records.get(REC))?.sectionId).toBe(S1);
  });

  it('a section that takes holiday takes it off the shelf’s others, and repeating is harmless', async () => {
    await db.sections.bulkPut([section(S1, { takesHoliday: true }), section(S2, { name: 'Jazz' }), section(S3, { name: 'Other', shelfId: '99999999-9999-4999-8999-999999999999', takesHoliday: true })]);
    await sApply(sPatch(S2, { takesHoliday: true }));
    await sApply(sPatch(S2, { takesHoliday: true }));
    expect((await db.sections.get(S1))?.takesHoliday).toBe(false);
    expect((await db.sections.get(S2))?.takesHoliday).toBe(true);
    expect((await db.sections.get(S3))?.takesHoliday).toBe(true);
  });

  it('a created section claims holiday and genres too', async () => {
    await db.sections.put(section(S1, { takesHoliday: true, discogsGenres: ['Rock', 'Blues'] }));
    await sApply(sCreate(section(S2, { name: 'Jazz', takesHoliday: true, discogsGenres: ['Blues'] })));
    expect(await db.sections.get(S1)).toMatchObject({ takesHoliday: false, discogsGenres: ['Rock'] });
  });

  it('claiming genres removes exactly those from the others; a genre added to them elsewhere survives', async () => {
    await db.sections.bulkPut([section(S1, { discogsGenres: ['Rock', 'Blues'] }), section(S2, { name: 'Jazz', discogsGenres: ['Jazz'] })]);
    await sApply(sPatch(S2, { discogsGenres: ['Jazz', 'Blues'] }));
    expect((await db.sections.get(S1))?.discogsGenres).toEqual(['Rock']);
    await db.sections.update(S1, { discogsGenres: ['Rock', 'Latin'] }); // another phone gave it Latin
    await sApply(sPatch(S2, { discogsGenres: ['Jazz', 'Blues'] }));
    expect((await db.sections.get(S1))?.discogsGenres).toEqual(['Rock', 'Latin']);
  });

  it('a patch that doesn’t mention holiday or genres leaves the others alone', async () => {
    await db.sections.bulkPut([section(S1, { takesHoliday: true, discogsGenres: ['Rock'] }), section(S2, { name: 'Jazz', takesHoliday: false })]);
    await sApply(sPatch(S2, { name: 'Jazz!' }));
    expect(await db.sections.get(S1)).toMatchObject({ takesHoliday: true, discogsGenres: ['Rock'] });
  });

  it('section.merge refuses to merge the catch-all away', async () => {
    await db.sections.bulkPut([section(S1, { isCatchAll: true }), section(S2)]);
    await db.records.put(record({ sectionId: S1 }));
    await expect(sApply(sMerge(S1, S2))).rejects.toThrow(BackendError);
    expect(await db.sections.count()).toBe(2);
    expect((await db.records.get(REC))?.sectionId).toBe(S1);
  });

  it('savePostcards applies and queues a section postcard, held by the section id', async () => {
    await savePostcards(db, [sCreate(section(S1))]);
    expect(await db.sections.get(S1)).toBeDefined();
    expect((await db.outbox.toArray()).map((p) => [p.kind, p.recordId, p.state])).toEqual([['section.create', S1, 'waiting']]);
  });
});

describe('suggestion.patch', () => {
  const SUG = '55555555-5555-4555-8555-555555555555';
  const suggestion: Suggestion = {
    id: SUG, shelfId: SHELF, artist: 'Sade', title: 'Love Deluxe', reason: 'Because you like Diamond Life.', discogsReleaseId: null, discogsGenres: [], discogsStyles: [],
    status: 'pending', decidedBy: null, decidedAt: null, roundAt: WHEN, createdAt: WHEN, updatedAt: WHEN,
  };
  const decide = (id: string): NewPostcard => ({ ...base, recordId: id, kind: 'suggestion.patch', fields: { status: 'dismissed', decidedBy: ME, decidedAt: WHEN } });

  it('merges the decision into the stored suggestion, and again is harmless', async () => {
    await db.suggestions.put(suggestion);
    await apply(decide(SUG));
    await apply(decide(SUG));
    expect(await db.suggestions.toArray()).toEqual([{ ...suggestion, status: 'dismissed', decidedBy: ME, decidedAt: WHEN }]);
  });

  it('does nothing for a suggestion the phone does not have', async () => {
    await apply(decide(SUG));
    expect(await db.suggestions.count()).toBe(0);
  });

  it('savePostcards applies it and queues it', async () => {
    await db.suggestions.put(suggestion);
    await savePostcards(db, [decide(SUG)]);
    expect((await db.suggestions.get(SUG))?.status).toBe('dismissed');
    expect((await db.outbox.toArray()).map((p) => [p.kind, p.recordId, p.state])).toEqual([['suggestion.patch', SUG, 'waiting']]);
  });
});
