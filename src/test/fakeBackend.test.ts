import { describe, expect, it } from 'vitest';
import { BackendError, CLAUDE_DOWN, DISCOGS_MESSAGES, NO_SIGNAL, NOT_ENOUGH_RATINGS, REJECTED, SUGGEST_DOWN, type FoundRecord } from '@/data/backend';
import { newRecordToRow, newSectionToRow, sectionToRow, type SectionRow } from '@/data/rowMapping';
import type { Section, ShelfRecord } from '@/data/schema';
import { FakeBackend, collectionRows } from './fakeBackend';
import { sectionIdFor } from '@/domain/sections';

const K = '11111111-1111-4111-8111-111111111111';
const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('FakeBackend', () => {
  it('signs in with the test code and sets a first-timer up with a shelf', async () => {
    const b = new FakeBackend({ users: { 'k@example.com': K } });
    await b.sendCode('k@example.com');
    expect(b.sentCodesTo).toEqual(['k@example.com']);
    await expect(b.verifyCode('k@example.com', '000000')).rejects.toThrow('That code didn’t work. Check it, or send a new one.');
    const me = await b.verifyCode('k@example.com', '123456');
    expect(me).toEqual({ userId: K, email: 'k@example.com' });
    expect(await b.hasProfile(K)).toBe(false);
    const shelf = await b.bootstrap('Kahrman');
    expect(await b.hasProfile(K)).toBe(true);
    expect(await b.members(shelf)).toEqual([{ shelfId: shelf, userId: K, role: 'owner', displayName: 'Kahrman' }]);
  });

  it('serves the real collection for a shelf, and only what changed since a time', async () => {
    const rows = collectionRows(SHELF, K);
    const b = new FakeBackend({ records: rows.records, ratings: rows.ratings });
    expect(await b.recordsSince(SHELF, null)).toHaveLength(11);
    expect(await b.ratings(SHELF)).toHaveLength(6);
    expect(await b.recordsSince(SHELF, '2100-01-01T00:00:00.000Z')).toHaveLength(0);
  });

  it('fails like a phone with no signal when offline', async () => {
    const b = new FakeBackend({});
    b.online = false;
    await expect(b.recordsSince(SHELF, null)).rejects.toBeInstanceOf(BackendError);
  });

  it('refuses a second invite to the same email', async () => {
    const b = new FakeBackend({});
    await b.invite(SHELF, 'Megan@Example.com ', K);
    await expect(b.invite(SHELF, 'megan@example.com', K)).rejects.toThrow('That email is already invited.');
    expect(await b.invites(SHELF)).toEqual([{ email: 'megan@example.com', acceptedAt: null }]);
  });

  describe('discogs search', () => {
    const found: FoundRecord = { releaseId: 7, artist: 'Sade', title: 'Diamond Life', label: null, catalog: null, year: 1984, format: 'LP', country: null, genres: [], styles: [], thumb: null };

    it('returns canned results and records each query', async () => {
      const b = new FakeBackend({});
      b.discogsResults = [found];
      expect(await b.searchDiscogs('sade')).toEqual([found]);
      expect(b.discogsCalls).toEqual(['sade']);
    });

    it('fails with the plain-words messages when told to', async () => {
      const b = new FakeBackend({});
      b.discogsFails = 'rate-limited';
      await expect(b.searchDiscogs('sade')).rejects.toThrow(DISCOGS_MESSAGES.rateLimited);
      b.discogsFails = 'down';
      await expect(b.searchDiscogs('sade')).rejects.toThrow(DISCOGS_MESSAGES.down);
    });

    it('has no signal when offline', async () => {
      const b = new FakeBackend({});
      b.online = false;
      await expect(b.searchDiscogs('sade')).rejects.toThrow(NO_SIGNAL);
    });

    it('never calls out for a query under two characters', async () => {
      const b = new FakeBackend({});
      b.discogsResults = [found];
      expect(await b.searchDiscogs(' a ')).toEqual([]);
      expect(b.discogsCalls).toEqual([]);
    });
  });

  describe('claude reads', () => {
    const r = { artist: 'Sade', title: 'Diamond Life', year: 1984, label: null };

    it('returns the canned identification and counts calls', async () => {
      const b = new FakeBackend({});
      expect(await b.identifyRecord(new ArrayBuffer(1), null)).toEqual({ read: { artist: null, title: null, barcode: null, catalog: null, label: null }, match: 'none', results: [] });
      b.identified = { read: { artist: 'Sade', title: null, barcode: null, catalog: null, label: null }, match: 'several', results: [] };
      expect((await b.identifyRecord(new ArrayBuffer(1), new ArrayBuffer(1))).match).toBe('several');
      expect(b.identifyCalls).toBe(2);
    });

    it('returns canned fun facts by artist|title, null when none, and logs calls', async () => {
      const b = new FakeBackend({});
      b.funFacts.set('Sade|Diamond Life', { fact: 'A fact.', sourceUrl: 'https://example.com' });
      expect(await b.findFunFact(r)).toEqual({ fact: 'A fact.', sourceUrl: 'https://example.com' });
      expect(await b.findFunFact({ ...r, title: 'Other' })).toBeNull();
      expect(b.funFactCalls).toEqual(['Sade|Diamond Life', 'Sade|Other']);
    });

    it('fails with CLAUDE_DOWN when told to', async () => {
      const b = new FakeBackend({});
      b.claudeFails = 'down';
      await expect(b.identifyRecord(new ArrayBuffer(1), null)).rejects.toThrow(CLAUDE_DOWN);
      await expect(b.findFunFact(r)).rejects.toThrow(CLAUDE_DOWN);
    });

    it('has no signal when offline', async () => {
      const b = new FakeBackend({});
      b.online = false;
      await expect(b.identifyRecord(new ArrayBuffer(1), null)).rejects.toThrow(NO_SIGNAL);
      await expect(b.findFunFact(r)).rejects.toThrow(NO_SIGNAL);
    });
  });

  describe('writes', () => {
    const REC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const newRow = (status: ShelfRecord['status'] = 'new_arrival') =>
      newRecordToRow({
        id: REC, shelfId: SHELF, status, wantsUpgrade: false, upgradeNote: null, artist: 'Sade', title: 'Diamond Life', label: null,
        catalog: null, year: null, format: null, sectionId: sectionIdFor(SHELF, 'popsoul'), discGrade: null, sleeveGrade: null, pricePaid: 15, nmEstimateLow: null,
        nmEstimateHigh: null, valueNote: null, notes: null, discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: K,
        createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', deletedAt: null, importKey: null,
      });

    it('stamps updated_at on insert, and says already-there the second time', async () => {
      const b = new FakeBackend({});
      expect(await b.insertRecord(newRow())).toBe('inserted');
      const first = b.recordRow(REC)?.updated_at;
      expect(first).toBeTruthy();
      expect(await b.insertRecord(newRow())).toBe('already-there');
      expect(b.recordRow(REC)?.updated_at).toBe(first);
    });

    it('stamps strictly increasing times', async () => {
      const b = new FakeBackend({});
      await b.insertRecord(newRow());
      const t1 = b.recordRow(REC)!.updated_at;
      await b.patchRecord(REC, { notes: 'a' });
      const t2 = b.recordRow(REC)!.updated_at;
      await b.patchRecord(REC, { notes: 'b' });
      const t3 = b.recordRow(REC)!.updated_at;
      expect(t2 > t1).toBe(true);
      expect(t3 > t2).toBe(true);
    });

    it('patches a record, and reports an unknown id as missing', async () => {
      const b = new FakeBackend({});
      expect(await b.patchRecord(REC, { notes: 'x' })).toBe('missing');
      await b.insertRecord(newRow());
      expect(await b.patchRecord(REC, { notes: 'x' })).toBe('patched');
      expect(b.recordRow(REC)?.notes).toBe('x');
    });

    it('moves a new arrival to owned when it is first rated, like the database trigger', async () => {
      const b = new FakeBackend({});
      await b.insertRecord(newRow());
      await b.setRating(REC, K, 4);
      expect(b.recordRow(REC)?.status).toBe('owned');
      expect(b.ratingRow(REC, K)?.value).toBe(4);
    });

    it('does not touch status when an existing rating changes, or when it is not a new arrival', async () => {
      const b = new FakeBackend({});
      await b.insertRecord(newRow());
      await b.setRating(REC, K, 4);
      await b.patchRecord(REC, { status: 'new_arrival' });
      await b.setRating(REC, K, 5);
      expect(b.recordRow(REC)?.status).toBe('new_arrival');
      expect(b.ratingRow(REC, K)?.value).toBe(5);
      await b.patchRecord(REC, { status: 'wanted' });
      await b.setRating(REC, OTHER, 3);
      expect(b.recordRow(REC)?.status).toBe('wanted');
    });

    it('keeps the write but throws NO_SIGNAL when the reply is lost, once', async () => {
      const b = new FakeBackend({});
      b.loseNextReply = true;
      await expect(b.insertRecord(newRow())).rejects.toThrow(new BackendError(NO_SIGNAL));
      expect(b.loseNextReply).toBe(false);
      expect(b.recordRow(REC)).toBeDefined();
      expect(await b.insertRecord(newRow())).toBe('already-there');
    });

    it('stores nothing and throws the reason when told to reject, once', async () => {
      const b = new FakeBackend({});
      b.rejectNext = REJECTED.permission;
      await expect(b.insertRecord(newRow())).rejects.toThrow(new BackendError(REJECTED.permission));
      expect(b.rejectNext).toBeNull();
      expect(b.recordRow(REC)).toBeUndefined();
      expect(await b.insertRecord(newRow())).toBe('inserted');
    });

    it('throws NO_SIGNAL offline for all three', async () => {
      const b = new FakeBackend({});
      b.online = false;
      await expect(b.insertRecord(newRow())).rejects.toThrow(NO_SIGNAL);
      await expect(b.patchRecord(REC, {})).rejects.toThrow(NO_SIGNAL);
      await expect(b.setRating(REC, K, 3)).rejects.toThrow(NO_SIGNAL);
    });
  });
  describe('photos', () => {
    const P = 'shelf/rec/front-1.jpg';
    const bytes = () => new Uint8Array([9, 8, 7]).buffer;

    it('uploads, then downloads the same bytes', async () => {
      const b = new FakeBackend({});
      await b.uploadPhoto(P, bytes());
      expect([...new Uint8Array((await b.downloadPhoto(P))!)]).toEqual([9, 8, 7]);
      expect(b.photos.has(P)).toBe(true);
    });

    it('deletes, then downloads null; deleting a missing photo is fine', async () => {
      const b = new FakeBackend({});
      await b.uploadPhoto(P, bytes());
      await b.deletePhoto(P);
      expect(await b.downloadPhoto(P)).toBeNull();
      await expect(b.deletePhoto(P)).resolves.toBeUndefined();
    });

    it('throws NO_SIGNAL offline', async () => {
      const b = new FakeBackend({});
      b.online = false;
      await expect(b.downloadPhoto(P)).rejects.toThrow(NO_SIGNAL);
      await expect(b.uploadPhoto(P, bytes())).rejects.toThrow(NO_SIGNAL);
      await expect(b.deletePhoto(P)).rejects.toThrow(NO_SIGNAL);
    });

    it('honours rejectNext and loseNextReply on upload', async () => {
      const b = new FakeBackend({});
      b.rejectNext = REJECTED.photoTooBig;
      await expect(b.uploadPhoto(P, bytes())).rejects.toThrow(REJECTED.photoTooBig);
      expect(b.photos.size).toBe(0);
      b.loseNextReply = true;
      await expect(b.uploadPhoto(P, bytes())).rejects.toThrow(NO_SIGNAL);
      expect(b.photos.has(P)).toBe(true);
    });
  });
});

describe('FakeBackend sections', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const base: Omit<Section, 'id' | 'name' | 'position'> = { shelfId: SHELF, color: 'rock', discogsGenres: [], takesHoliday: false, isCatchAll: false, legacyGenre: 'misc', updatedAt: '2026-11-23T10:00:00.000Z' };
  const sec = (n: number, over: Partial<SectionRow> = {}): SectionRow => ({ ...sectionToRow({ ...base, id: id(n), name: `S${n}`, position: n }), ...over });

  it('serves a shelf’s sections, and fails offline', async () => {
    const b = new FakeBackend({ sections: [sec(1), sec(2, { shelf_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })] });
    expect((await b.sections(SHELF)).map((s) => s.id)).toEqual([id(1)]);
    b.online = false;
    await expect(b.sections(SHELF)).rejects.toThrow(NO_SIGNAL);
  });

  it('inserts once; a repeat is already-there', async () => {
    const b = new FakeBackend({});
    const row = newSectionToRow({ ...base, id: id(1), name: 'S1', position: 0, discogsGenres: ['Rock'] });
    expect(await b.insertSection(row)).toBe('inserted');
    expect(await b.insertSection(row)).toBe('already-there');
    expect(b.sectionRow(id(1))?.updated_at).toBeTruthy();
  });

  it('a section that takes holiday or a genre takes it off the others, like the claim trigger', async () => {
    const b = new FakeBackend({ sections: [sec(1, { takes_holiday: true, discogs_genres: ['Rock', 'Blues'] }), sec(2)] });
    expect(await b.patchSection(id(2), { takes_holiday: true, discogs_genres: ['Blues'] })).toBe('patched');
    expect(b.sectionRow(id(1))).toMatchObject({ takes_holiday: false, discogs_genres: ['Rock'] });
    expect(await b.patchSection(id(9), { name: 'x' })).toBe('missing');
  });

  it('merges like the database: hands over genres and holiday, removes the section, resend is fine', async () => {
    const b = new FakeBackend({ sections: [sec(1, { takes_holiday: true, discogs_genres: ['Rock', 'Blues'] }), sec(2, { discogs_genres: ['Blues', 'Jazz'] }), sec(3, { is_catch_all: true })] });
    await b.mergeSection(id(1), id(2));
    expect(b.sectionRow(id(1))).toBeUndefined();
    expect(b.sectionRow(id(2))).toMatchObject({ takes_holiday: true, discogs_genres: ['Blues', 'Jazz', 'Rock'] });
    await b.mergeSection(id(1), id(2));
    await expect(b.mergeSection(id(3), id(2))).rejects.toBeInstanceOf(BackendError);
    await expect(b.mergeSection(id(2), id(9))).rejects.toThrow(REJECTED.sectionMissing);
  });

  it('a merge moves every record in the section, deleted ones too, like merge_section', async () => {
    const rows = collectionRows(SHELF, K);
    const jazz = sectionIdFor(SHELF, 'jazz');
    const misc = sectionIdFor(SHELF, 'misc');
    const inJazz = rows.records.filter((r) => r.section_id === jazz).map((r) => r.id);
    const b = new FakeBackend({ ...rows, members: [] });
    b.touchRecord(inJazz[0], { deleted_at: '2026-01-01T00:00:00.000Z' });
    await b.mergeSection(jazz, misc);
    expect(inJazz.map((r) => b.recordRow(r)?.section_id)).toEqual(inJazz.map(() => misc));
    expect(b.sectionRow(jazz)).toBeUndefined();
  });

  it('honours rejectNext and loseNextReply on section writes', async () => {
    const b = new FakeBackend({ sections: [sec(1)] });
    b.rejectNext = 'No.';
    await expect(b.patchSection(id(1), { name: 'x' })).rejects.toThrow('No.');
    expect(b.sectionRow(id(1))?.name).toBe('S1');
    b.loseNextReply = true;
    await expect(b.patchSection(id(1), { name: 'x' })).rejects.toThrow(NO_SIGNAL);
    expect(b.sectionRow(id(1))?.name).toBe('x');
  });
});

describe('FakeBackend suggestions', () => {
  const ME = '22222222-2222-4222-8222-222222222222';
  const made = () => {
    const b = new FakeBackend({ shelfFor: { [ME]: SHELF }, signedIn: { userId: ME, email: 'me@example.com' } });
    b.suggested = [{ artist: 'Sade', title: 'Love Deluxe', reason: 'Because you like Diamond Life.', discogsGenres: ['Funk / Soul'] }, { artist: 'Anita Baker', title: 'Rapture', reason: 'Smooth and warm.' }];
    return b;
  };

  it('suggestRecords inserts what it was told to and says how many', async () => {
    const b = made();
    expect(await b.suggestRecords()).toEqual({ added: 2 });
    expect(b.suggestCalls).toBe(1);
    const rows = await b.suggestions(SHELF);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ shelf_id: SHELF, artist: 'Sade', status: 'pending', discogs_genres: ['Funk / Soul'], discogs_styles: [], discogs_release_id: null, decided_by: null });
    expect(b.suggestionRows).toHaveLength(2);
  });

  it('fails offline with NO_SIGNAL', async () => {
    const b = made();
    b.online = false;
    await expect(b.suggestRecords()).rejects.toThrow(NO_SIGNAL);
    await expect(b.suggestions(SHELF)).rejects.toThrow(NO_SIGNAL);
  });

  it('down and not-enough-ratings insert nothing', async () => {
    const b = made();
    b.suggestFails = 'down';
    await expect(b.suggestRecords()).rejects.toThrow(SUGGEST_DOWN);
    b.suggestFails = 'not-enough-ratings';
    await expect(b.suggestRecords()).rejects.toThrow(NOT_ENOUGH_RATINGS);
    expect(b.suggestionRows).toHaveLength(0);
    expect(b.suggestCalls).toBe(2);
  });

  it('lost-reply inserts, then throws SUGGEST_DOWN', async () => {
    const b = made();
    b.suggestFails = 'lost-reply';
    await expect(b.suggestRecords()).rejects.toThrow(SUGGEST_DOWN);
    expect(b.suggestionRows).toHaveLength(2);
  });

  it('patchSuggestion changes the decision fields; an unknown id is missing; a lost reply keeps the write', async () => {
    const b = made();
    await b.suggestRecords();
    const id = b.suggestionRows[0].id;
    expect(await b.patchSuggestion(id, { status: 'dismissed', decided_by: ME, decided_at: '2026-11-23T11:00:00.000Z' })).toBe('patched');
    expect(b.suggestionRows[0]).toMatchObject({ status: 'dismissed', decided_by: ME });
    expect(await b.patchSuggestion('00000000-0000-4000-8000-0000000000ff', { status: 'added' })).toBe('missing');
    b.loseNextReply = true;
    await expect(b.patchSuggestion(id, { status: 'added' })).rejects.toThrow(NO_SIGNAL);
    expect(b.suggestionRows[0].status).toBe('added');
  });
});
