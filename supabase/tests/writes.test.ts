// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { addUser, asUser, freshDb } from './harness';

type U = { id: string; email: string };
let db: PGlite;
let kahrman: U, megan: U, stranger: U;
let kShelf: string, sShelf: string;

async function record(shelf: string, by: string, status: 'owned' | 'wanted' | 'new_arrival'): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.records (id, shelf_id, status, artist, title, genre, added_by) values ($1, $2, $3, 'Coltrane', 'T', 'jazz', $4)`,
    [id, shelf, status, by],
  );
  return id;
}

const statusOf = async (id: string) =>
  (await db.query<{ status: string }>('select status from public.records where id = $1', [id])).rows[0].status;

const rate = (u: U, recordId: string, value = 5) =>
  asUser(db, u, () => db.query('insert into public.ratings (record_id, user_id, value) values ($1, $2, $3)', [recordId, u.id, value]));

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
});

describe('shelving on the first rating', () => {
  it('first rating moves a new arrival to the shelf', async () => {
    const id = await record(kShelf, kahrman.id, 'new_arrival');
    await rate(megan, id);
    expect(await statusOf(id)).toBe('owned');
  });

  it('a changed rating moves nothing', async () => {
    const id = await record(kShelf, kahrman.id, 'new_arrival');
    await rate(kahrman, id, 5);
    await db.query(`update public.records set status = 'new_arrival' where id = $1`, [id]);
    await asUser(db, kahrman, () => db.query('update public.ratings set value = 3 where record_id = $1 and user_id = $2', [id, kahrman.id]));
    expect(await statusOf(id)).toBe('new_arrival');
  });

  it('a rating on a want moves nothing', async () => {
    const id = await record(kShelf, kahrman.id, 'wanted');
    await rate(kahrman, id);
    expect(await statusOf(id)).toBe('wanted');
  });

  it('both people rating the same new arrival: one move, both ratings kept', async () => {
    const id = await record(kShelf, kahrman.id, 'new_arrival');
    await rate(kahrman, id, 5);
    await rate(megan, id, 4);
    expect(await statusOf(id)).toBe('owned');
    const count = await db.query<{ count: number }>('select count(*)::int as count from public.ratings where record_id = $1', [id]);
    expect(count.rows[0].count).toBe(2);
  });

  it('nobody can execute the trigger function', async () => {
    const r = await db.query<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.shelve_on_first_rating()', 'execute') as ok`);
    expect(r.rows[0].ok).toBe(false);
  });
});

describe('write paths under the grants', () => {
  it('members can patch the editable fields, including deleted_at', async () => {
    const id = await record(kShelf, kahrman.id, 'wanted');
    const r = await asUser(db, megan, () =>
      db.query(
        `update public.records set status = 'new_arrival', disc_grade = 'VG+', price_paid = 15, bought_at = now(), deleted_at = now() where id = $1 returning id`,
        [id],
      ),
    );
    expect(r.rows).toHaveLength(1);
  });

  it('identity columns stay frozen', async () => {
    const id = await record(kShelf, kahrman.id, 'owned');
    await expect(
      asUser(db, megan, () => db.query('update public.records set added_by = $2 where id = $1', [id, megan.id])),
    ).rejects.toThrow(/permission denied/);
  });

  it('the rating write path works under the grants', async () => {
    const id = await record(kShelf, kahrman.id, 'owned');
    const update = () =>
      asUser(db, kahrman, () =>
        db.query('update public.ratings set value = 4 where record_id = $1 and user_id = $2 returning record_id', [id, kahrman.id]),
      );
    expect((await update()).rows).toHaveLength(0);
    await rate(kahrman, id, 5);
    expect((await update()).rows).toHaveLength(1);
  });

  it('a stranger can neither patch nor rate Kahrman’s records', async () => {
    const id = await record(kShelf, kahrman.id, 'owned');
    const patched = await asUser(db, stranger, () =>
      db.query(`update public.records set notes = 'x' where id = $1 returning id`, [id]),
    );
    expect(patched.rows).toHaveLength(0);
    await expect(rate(stranger, id)).rejects.toThrow(/row-level security/);
  });
});
