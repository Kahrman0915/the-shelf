import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STARTER_SET, sectionIdFor } from '@/domain/sections';
import { perform, type Ctx } from './actions';
import { BackendError, type FoundRecord } from './backend';
import { ShelfDB, sectionsFromSet, writeSession } from './db';
import { savePostcards } from './outbox';
import type { ShelfRecord, Suggestion } from './schema';
import { addSuggestion, addWant, dismissSuggestion, upgradeChange } from './wantActions';

const SHELF = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333';
const SUG = '44444444-4444-4444-8444-444444444444';
const NEW_ID = '55555555-5555-4555-8555-555555555555';
const OLD = '2026-10-01T10:00:00.000Z';
const NOW = '2026-11-23T10:00:00.000Z';
const ctx: Ctx = { me: ME, now: NOW };
const sections = sectionsFromSet(SHELF, STARTER_SET, OLD);
const wc = { ...ctx, shelfId: SHELF, newId: NEW_ID, sections };

const found: FoundRecord = {
  releaseId: 4321,
  artist: 'Curtis Mayfield',
  title: 'Superfly',
  label: 'Curtom',
  catalog: 'CRS 8014',
  year: 1972,
  format: 'LP',
  country: 'US',
  genres: ['Funk / Soul'],
  styles: ['Soul'],
  thumb: null,
};

function record(over: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: A, shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null,
    artist: 'Miles Davis', title: 'Kind of Blue', label: null, catalog: null, year: null, format: null,
    sectionId: sectionIdFor(SHELF, 'jazz'), discGrade: null, sleeveGrade: null, pricePaid: null,
    nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null, discogsReleaseId: null,
    coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null,
    boughtAt: null, addedBy: ME, createdAt: OLD, updatedAt: OLD, deletedAt: null, importKey: null,
    ...over,
  };
}

function suggestion(over: Partial<Suggestion> = {}): Suggestion {
  return {
    id: SUG, shelfId: SHELF, artist: 'Nina Simone', title: 'Pastel Blues', reason: 'You love Jazz vocals',
    discogsReleaseId: null, discogsGenres: ['Jazz'], discogsStyles: [], status: 'pending',
    decidedBy: null, decidedAt: null, roundAt: OLD, createdAt: OLD, updatedAt: OLD, ...over,
  };
}

describe('want actions', () => {
  let db: ShelfDB;
  beforeEach(async () => {
    db = new ShelfDB(`want-${crypto.randomUUID()}`);
    await writeSession(db, { userId: ME, email: 'me@example.com', shelfId: SHELF });
    await db.sections.bulkPut(sections);
  });
  afterEach(async () => {
    await db.delete();
  });

  describe('addWant', () => {
    it('album-level: only artist, title and section', async () => {
      const { postcards, undo } = addWant(found, wc, { exactPressing: false });
      expect(postcards).toHaveLength(1);
      expect(postcards[0]).toMatchObject({
        kind: 'record.create',
        recordId: NEW_ID,
        fields: {
          status: 'wanted', wantsUpgrade: false, artist: 'Curtis Mayfield', title: 'Superfly',
          sectionId: sectionIdFor(SHELF, 'popsoul'), label: null, catalog: null, year: null, format: null,
          discogsReleaseId: null, boughtAt: null, addedBy: ME,
        },
      });
      await perform(db, postcards);
      expect(await db.outbox.count()).toBe(1);
      expect((await db.records.get(NEW_ID))?.deletedAt).toBeNull();
      await perform(db, undo!);
      expect((await db.records.get(NEW_ID))?.deletedAt).toBe(NOW);
    });

    it('this pressing: keeps label, catalog, year, format and release id', () => {
      const { postcards } = addWant(found, wc, { exactPressing: true });
      expect(postcards[0]).toMatchObject({
        fields: { label: 'Curtom', catalog: 'CRS 8014', year: 1972, format: 'LP', discogsReleaseId: 4321, status: 'wanted' },
      });
    });
  });

  describe('addSuggestion', () => {
    it('makes an album-level want and marks the suggestion added; undo reverses both', async () => {
      await db.suggestions.put(suggestion());
      const { postcards, undo } = addSuggestion(suggestion(), [], wc);
      expect(postcards.map((p) => p.kind)).toEqual(['record.create', 'suggestion.patch']);
      expect(postcards[0]).toMatchObject({
        fields: { status: 'wanted', artist: 'Nina Simone', title: 'Pastel Blues', sectionId: sectionIdFor(SHELF, 'jazz'), discogsReleaseId: null },
      });
      expect(postcards[1]).toMatchObject({ recordId: SUG, fields: { status: 'added', decidedBy: ME, decidedAt: NOW } });
      await perform(db, postcards);
      expect(await db.outbox.count()).toBe(2);
      expect((await db.suggestions.get(SUG))?.status).toBe('added');
      await savePostcards(db, undo!);
      expect((await db.records.get(NEW_ID))?.deletedAt).toBe(NOW);
      expect(await db.suggestions.get(SUG)).toMatchObject({ status: 'pending', decidedBy: null, decidedAt: null });
    });

    it('already on the shelf: only the suggestion patch, and its undo is only the patch back', async () => {
      await db.suggestions.put(suggestion());
      const { postcards, undo } = addSuggestion(suggestion(), [record({ artist: 'nina simone', title: 'Pastel Blues!' })], wc);
      expect(postcards.map((p) => p.kind)).toEqual(['suggestion.patch']);
      expect(undo!.map((p) => p.kind)).toEqual(['suggestion.patch']);
      await perform(db, postcards);
      expect(await db.outbox.count()).toBe(1);
      expect(await db.records.count()).toBe(0);
      await savePostcards(db, undo!);
      expect(await db.suggestions.get(SUG)).toMatchObject({ status: 'pending', decidedBy: null, decidedAt: null });
    });

    it('a deleted record does not count as a duplicate', () => {
      const { postcards } = addSuggestion(suggestion(), [record({ artist: 'Nina Simone', title: 'Pastel Blues', deletedAt: OLD })], wc);
      expect(postcards).toHaveLength(2);
    });
  });

  describe('dismissSuggestion', () => {
    it('makes one patch and no undo', async () => {
      await db.suggestions.put(suggestion());
      const { postcards, undo } = dismissSuggestion(suggestion(), ctx);
      expect(undo).toBeNull();
      expect(postcards).toHaveLength(1);
      expect(postcards[0]).toMatchObject({ kind: 'suggestion.patch', recordId: SUG, fields: { status: 'dismissed', decidedBy: ME, decidedAt: NOW } });
      await perform(db, postcards);
      expect(await db.outbox.count()).toBe(1);
      expect((await db.suggestions.get(SUG))?.status).toBe('dismissed');
    });
  });

  describe('upgradeChange', () => {
    it('switch on with a note', () => {
      expect(upgradeChange(record(), true, '  cleaner copy  ')).toEqual({ wantsUpgrade: true, upgradeNote: 'cleaner copy' });
    });
    it('switch on with no note', () => {
      expect(upgradeChange(record(), true, '   ')).toEqual({ wantsUpgrade: true });
    });
    it('switch off clears the note', () => {
      expect(upgradeChange(record({ wantsUpgrade: true, upgradeNote: 'x' }), false, 'x')).toEqual({ wantsUpgrade: false, upgradeNote: null });
    });
    it('note only', () => {
      expect(upgradeChange(record({ wantsUpgrade: true, upgradeNote: 'x' }), true, 'y')).toEqual({ upgradeNote: 'y' });
    });
    it('unchanged gives {}', () => {
      expect(upgradeChange(record({ wantsUpgrade: true, upgradeNote: 'x' }), true, ' x ')).toEqual({});
      expect(upgradeChange(record(), false, '')).toEqual({});
    });
    it('201 characters throws; 200 is fine', () => {
      expect(() => upgradeChange(record(), true, 'a'.repeat(201))).toThrow(new BackendError('An upgrade note is at most 200 characters.'));
      expect(upgradeChange(record(), true, 'a'.repeat(200)).upgradeNote).toHaveLength(200);
    });
    it('a wanted record throws', () => {
      expect(() => upgradeChange(record({ status: 'wanted' }), true, '')).toThrow(BackendError);
    });
  });
});
