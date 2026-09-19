import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { ShelfDB, clearPhone } from './db';

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
