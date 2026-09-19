// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { addUser, asUser, freshDb } from './harness';

type U = { id: string; email: string };
let db: PGlite;
let kahrman: U, megan: U, stranger: U;
let kShelf: string, sShelf: string, kRecord: string, sRecord: string;

async function record(shelf: string, by: string, artist: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.records (id, shelf_id, status, artist, title, genre, added_by) values ($1, $2, 'owned', $3, 'T', 'jazz', $4)`,
    [id, shelf, artist, by],
  );
  return id;
}

beforeEach(async () => {
  db = await freshDb();
  kahrman = await addUser(db, 'kahrman@example.com');
  megan = await addUser(db, 'megan@example.com');
  stranger = await addUser(db, 'stranger@example.com');
  for (const [u, name] of [[kahrman, 'Kahrman'], [megan, 'Megan'], [stranger, 'Stranger']] as const) {
    await db.query('insert into public.profiles (id, display_name) values ($1, $2)', [u.id, name]);
  }
  kShelf = (await db.query<{ id: string }>(`insert into public.shelves (name, created_by) values ('The Shelf', $1) returning id`, [kahrman.id])).rows[0].id;
  sShelf = (await db.query<{ id: string }>(`insert into public.shelves (name, created_by) values ('Other', $1) returning id`, [stranger.id])).rows[0].id;
  await db.query(`insert into public.shelf_members (shelf_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member'), ($4, $5, 'owner')`, [
    kShelf, kahrman.id, megan.id, sShelf, stranger.id,
  ]);
  kRecord = await record(kShelf, kahrman.id, 'Coltrane');
  sRecord = await record(sShelf, stranger.id, 'Someone else');
  await db.query('insert into public.ratings (record_id, user_id, value) values ($1, $2, 5)', [kRecord, kahrman.id]);
});

describe('who can see what', () => {
  it('members see their shelf’s records and nothing else', async () => {
    const rows = await asUser(db, megan, () => db.query<{ id: string }>('select id from public.records'));
    expect(rows.rows.map((r) => r.id)).toEqual([kRecord]);
  });

  it('a stranger sees nothing of Kahrman’s shelf, its members or its people', async () => {
    const recs = await asUser(db, stranger, () => db.query('select * from public.records where shelf_id = $1', [kShelf]));
    const members = await asUser(db, stranger, () => db.query('select * from public.shelf_members where shelf_id = $1', [kShelf]));
    const people = await asUser(db, stranger, () => db.query('select * from public.profiles where id = $1', [megan.id]));
    expect([recs.rows.length, members.rows.length, people.rows.length]).toEqual([0, 0, 0]);
  });

  it('shelf-mates can see each other’s names', async () => {
    const people = await asUser(db, megan, () => db.query<{ display_name: string }>('select display_name from public.profiles order by display_name'));
    expect(people.rows.map((p) => p.display_name)).toEqual(['Kahrman', 'Megan']);
  });

  it('signed-out visitors can read nothing at all', async () => {
    await expect(asUser(db, null, () => db.query('select * from public.records'))).rejects.toThrow(/permission denied/);
  });

  it('a stranger sees no shelves, invites or ratings tied to Kahrman’s shelf', async () => {
    await db.query(`insert into public.shelf_invites (shelf_id, email, invited_by) values ($1, 'friend@example.com', $2)`, [kShelf, kahrman.id]);
    const shelves = await asUser(db, stranger, () => db.query('select * from public.shelves where id = $1', [kShelf]));
    const invites = await asUser(db, stranger, () => db.query('select * from public.shelf_invites where shelf_id = $1', [kShelf]));
    const ratings = await asUser(db, stranger, () => db.query('select * from public.ratings where record_id = $1', [kRecord]));
    expect([shelves.rows.length, invites.rows.length, ratings.rows.length]).toEqual([0, 0, 0]);
  });

  it('a stranger cannot insert into profiles directly', async () => {
    const nobody = await addUser(db, 'nobody@example.com');
    await expect(
      asUser(db, stranger, () => db.query('insert into public.profiles (id, display_name) values ($1, $2)', [nobody.id, 'Fake'])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('who can change what', () => {
  it('a member can rate for herself but not for Kahrman', async () => {
    await asUser(db, megan, () => db.query('insert into public.ratings (record_id, user_id, value) values ($1, $2, 4)', [kRecord, megan.id]));
    await expect(
      asUser(db, megan, () => db.query('insert into public.ratings (record_id, user_id, value) values ($1, $2, 5)', [kRecord, kahrman.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it('nobody can rate a record on a shelf they are not on', async () => {
    await expect(
      asUser(db, megan, () => db.query('insert into public.ratings (record_id, user_id, value) values ($1, $2, 3)', [sRecord, megan.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it('only the owner can invite', async () => {
    await expect(
      asUser(db, megan, () => db.query(`insert into public.shelf_invites (shelf_id, email, invited_by) values ($1, 'friend@example.com', $2)`, [kShelf, megan.id])),
    ).rejects.toThrow(/row-level security/);
    await asUser(db, kahrman, () =>
      db.query(`insert into public.shelf_invites (shelf_id, email, invited_by) values ($1, 'friend@example.com', $2)`, [kShelf, kahrman.id]),
    );
    const invites = await db.query('select * from public.shelf_invites');
    expect(invites.rows).toHaveLength(1);
  });

  it('nobody can add records to someone else’s shelf', async () => {
    await expect(
      asUser(db, stranger, () =>
        db.query(`insert into public.records (id, shelf_id, status, artist, title, genre, added_by) values ($1, $2, 'owned', 'X', 'Y', 'rock', $3)`, [
          crypto.randomUUID(), kShelf, stranger.id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('records cannot be hard-deleted, only soft-deleted', async () => {
    await asUser(db, kahrman, () => db.query('delete from public.records where id = $1', [kRecord]));
    expect((await db.query('select * from public.records where id = $1', [kRecord])).rows).toHaveLength(1);
  });

  it('people and shelves are only created through bootstrap(), not directly', async () => {
    await expect(asUser(db, stranger, () => db.query(`insert into public.shelves (name, created_by) values ('Sneaky', $1)`, [stranger.id]))).rejects.toThrow(
      /row-level security/,
    );
  });

  it('a signed-in member cannot truncate records', async () => {
    await expect(asUser(db, kahrman, () => db.query('truncate public.records cascade'))).rejects.toThrow(/permission denied/);
  });

  it('a member cannot move a record to another shelf', async () => {
    await expect(
      asUser(db, megan, () => db.query('update public.records set shelf_id = $1 where id = $2', [sShelf, kRecord])),
    ).rejects.toThrow(/row-level security/);
  });

  it('a member cannot change or delete Kahrman’s rating', async () => {
    const updated = await asUser(db, megan, () =>
      db.query('update public.ratings set value = 1 where record_id = $1 and user_id = $2', [kRecord, kahrman.id]),
    );
    expect(updated.affectedRows).toBe(0);
    const deleted = await asUser(db, megan, () =>
      db.query('delete from public.ratings where record_id = $1 and user_id = $2', [kRecord, kahrman.id]),
    );
    expect(deleted.affectedRows).toBe(0);
    const rating = await db.query<{ value: number }>('select value from public.ratings where record_id = $1 and user_id = $2', [kRecord, kahrman.id]);
    expect(rating.rows).toHaveLength(1);
    expect(rating.rows[0].value).toBe(5);
  });

  it('a plain member cannot remove anyone from shelf_members', async () => {
    const result = await asUser(db, megan, () =>
      db.query('delete from public.shelf_members where shelf_id = $1 and user_id = $2', [kShelf, kahrman.id]),
    );
    expect(result.affectedRows).toBe(0);
    const members = await db.query('select 1 from public.shelf_members where shelf_id = $1 and user_id = $2', [kShelf, kahrman.id]);
    expect(members.rows).toHaveLength(1);
  });
});

describe('the database refuses bad data', () => {
  it('rejects a rating of 7, a genre outside the nine, and an estimate with low above high', async () => {
    await expect(db.query('insert into public.ratings (record_id, user_id, value) values ($1, $2, 7)', [kRecord, kahrman.id])).rejects.toThrow();
    await expect(
      db.query(`insert into public.records (id, shelf_id, status, artist, title, genre, added_by) values ($1, $2, 'owned', 'X', 'Y', 'polka', $3)`, [
        crypto.randomUUID(), kShelf, kahrman.id,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into public.records (id, shelf_id, status, artist, title, genre, added_by, nm_estimate_low, nm_estimate_high) values ($1, $2, 'owned', 'X', 'Y', 'rock', $3, 40, 20)`,
        [crypto.randomUUID(), kShelf, kahrman.id],
      ),
    ).rejects.toThrow();
  });

  it('keeps import keys unique per shelf, not across shelves', async () => {
    const insert = (shelf: string, by: string) =>
      db.query(`insert into public.records (id, shelf_id, status, artist, title, genre, added_by, import_key) values ($1, $2, 'owned', 'X', 'Y', 'rock', $3, 'same-key')`, [
        crypto.randomUUID(), shelf, by,
      ]);
    await insert(kShelf, kahrman.id);
    await insert(sShelf, stranger.id);
    await expect(insert(kShelf, kahrman.id)).rejects.toThrow(/unique|duplicate/);
  });

  it('stamps updated_at on every change', async () => {
    const before = (await db.query<{ updated_at: Date }>('select updated_at from public.records where id = $1', [kRecord])).rows[0].updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await asUser(db, megan, () => db.query(`update public.records set notes = 'Plays great' where id = $1`, [kRecord]));
    const after = (await db.query<{ updated_at: Date }>('select updated_at from public.records where id = $1', [kRecord])).rows[0].updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});
