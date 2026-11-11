import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviousPersonUnsent, ShelfDB, clearPhone, clearPhoneIfNothingWaiting, readSession, rememberSession, writeSession } from './db';

const name = `upgrade-${crypto.randomUUID()}`;

afterEach(async () => {
  await Dexie.delete(name);
});

describe('ShelfDB version 2', () => {
  it('clears Plan 1’s local-only records when a phone upgrades', async () => {
    const v1 = new Dexie(name);
    v1.version(1).stores({ records: 'id, shelfId, status, genre, &importKey', ratings: '[recordId+userId], recordId, userId' });
    await v1.table('records').add({ id: 'r1', shelfId: 'local-shelf', status: 'owned', genre: 'jazz', importKey: 'k' });
    await v1.table('ratings').add({ recordId: 'r1', userId: 'local-kahrman', value: 4 });
    v1.close();

    const v2 = new ShelfDB(name);
    expect(await v2.records.count()).toBe(0);
    expect(await v2.ratings.count()).toBe(0);
    await v2.meta.put({ key: 'x', value: 'y' });
    await clearPhone(v2);
    expect(await v2.meta.count()).toBe(0);
    v2.close();
  });
});

describe('clearPhone', () => {
  it('empties the outbox too', async () => {
    const db = new ShelfDB(`clear-${crypto.randomUUID()}`);
    await db.outbox.add({
      kind: 'rating.set',
      shelfId: 's',
      recordId: 'r',
      userId: 'u',
      createdAt: 't',
      state: 'waiting',
      reason: null,
      fields: { value: 3 },
    } as never);
    await clearPhone(db);
    expect(await db.outbox.count()).toBe(0);
    await db.delete();
  });
});

const K = { userId: '11111111-1111-4111-8111-111111111111', email: 'kahrman@example.com', shelfId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const MEG = { userId: '22222222-2222-4222-8222-222222222222', email: 'meg@example.com', shelfId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };

async function phoneOf(who: typeof K, waiting: number): Promise<ShelfDB> {
  const db = new ShelfDB(`guarded-${crypto.randomUUID()}`);
  await writeSession(db, who);
  await db.members.put({ shelfId: who.shelfId, userId: who.userId, role: 'owner', displayName: 'Someone' });
  for (let i = 0; i < waiting; i++) {
    await db.outbox.add({ kind: 'rating.set', shelfId: who.shelfId, recordId: `r${i}`, userId: who.userId, createdAt: 't', state: 'waiting', reason: null, fields: { value: 3 } } as never);
  }
  return db;
}

describe('clearPhoneIfNothingWaiting', () => {
  it('clears the phone when nothing is waiting', async () => {
    const db = await phoneOf(K, 0);
    expect(await clearPhoneIfNothingWaiting(db)).toBe(true);
    expect(await db.members.count()).toBe(0);
    expect(await readSession(db)).toBeNull();
    await db.delete();
  });

  it('keeps everything when a change is waiting', async () => {
    const db = await phoneOf(K, 1);
    expect(await clearPhoneIfNothingWaiting(db)).toBe(false);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.members.count()).toBe(1);
    expect(await readSession(db)).toEqual(K);
    await db.delete();
  });
});

describe('rememberSession', () => {
  it('refuses a different person while the previous person’s changes are waiting, and keeps them', async () => {
    const db = await phoneOf(K, 2);
    const refused = await rememberSession(db, MEG).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PreviousPersonUnsent);
    expect((refused as PreviousPersonUnsent).count).toBe(2);
    expect(await readSession(db)).toEqual(K);
    expect(await db.outbox.count()).toBe(2);
    expect(await db.members.count()).toBe(1);
    await db.delete();
  });

  it('gives a different person a clean notebook when nothing is waiting', async () => {
    const db = await phoneOf(K, 0);
    await rememberSession(db, MEG);
    expect(await readSession(db)).toEqual(MEG);
    expect(await db.members.count()).toBe(0);
    await db.delete();
  });

  it('keeps the same person’s notebook and waiting changes', async () => {
    const db = await phoneOf(K, 1);
    await rememberSession(db, K);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.members.count()).toBe(1);
    await db.delete();
  });
});
