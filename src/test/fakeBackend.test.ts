import { describe, expect, it } from 'vitest';
import { BackendError, NO_SIGNAL, REJECTED } from '@/data/backend';
import { newRecordToRow } from '@/data/rowMapping';
import type { ShelfRecord } from '@/data/schema';
import { FakeBackend, collectionRows } from './fakeBackend';

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

  describe('writes', () => {
    const REC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const newRow = (status: ShelfRecord['status'] = 'new_arrival') =>
      newRecordToRow({
        id: REC, shelfId: SHELF, status, wantsUpgrade: false, upgradeNote: null, artist: 'Sade', title: 'Diamond Life', label: null,
        catalog: null, year: null, format: null, genre: 'popsoul', discGrade: null, sleeveGrade: null, pricePaid: 15, nmEstimateLow: null,
        nmEstimateHigh: null, valueNote: null, notes: null, discogsReleaseId: null, coverPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: K,
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
});
