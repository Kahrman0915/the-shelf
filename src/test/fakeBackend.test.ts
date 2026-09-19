import { describe, expect, it } from 'vitest';
import { BackendError } from '@/data/backend';
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
});
