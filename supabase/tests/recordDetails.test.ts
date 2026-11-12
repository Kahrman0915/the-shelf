// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { addUser, asUser, freshDb } from './harness';

type U = { id: string; email: string };
let db: PGlite;
let kahrman: U, megan: U, stranger: U;
let kShelf: string, sShelf: string;

async function record(): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.records (id, shelf_id, status, artist, title, genre, added_by) values ($1, $2, 'owned', 'Coltrane', 'T', 'jazz', $3)`,
    [id, kShelf, kahrman.id],
  );
  return id;
}

const asMegan = (sql: string, params: unknown[]) => asUser(db, megan, () => db.query(sql, params));

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

describe('fun fact, its source and a cover link', () => {
  it('a member can set a fun fact, its source and a cover link', async () => {
    const id = await record();
    const r = await asMegan(
      `update public.records set fun_fact = 'x', fun_fact_source = 'https://en.wikipedia.org/wiki/Ballads', cover_image_url = 'https://i.discogs.com/a.jpg' where id = $1 returning id`,
      [id],
    );
    expect(r.rows).toHaveLength(1);
  });

  it('links must be https', async () => {
    const id = await record();
    await expect(asMegan(`update public.records set fun_fact = 'x', fun_fact_source = 'http://x.com' where id = $1`, [id])).rejects.toThrow(/violates check constraint/);
    await expect(asMegan(`update public.records set cover_image_url = 'http://x.com/a.jpg' where id = $1`, [id])).rejects.toThrow(/violates check constraint/);
  });

  it('a source needs a fun fact', async () => {
    const id = await record();
    await expect(asMegan(`update public.records set fun_fact_source = 'https://x.com' where id = $1`, [id])).rejects.toThrow(/violates check constraint/);
  });

  it('a fun fact is at most 500 characters', async () => {
    const id = await record();
    await expect(asMegan(`update public.records set fun_fact = $2 where id = $1`, [id, 'a'.repeat(501)])).rejects.toThrow(/violates check constraint/);
    const ok = await asMegan(`update public.records set fun_fact = $2 where id = $1 returning id`, [id, 'a'.repeat(500)]);
    expect(ok.rows).toHaveLength(1);
  });

  it('a stranger can’t set them', async () => {
    const id = await record();
    const r = await asUser(db, stranger, () =>
      db.query(`update public.records set fun_fact = 'x', cover_image_url = 'https://x.com/a.jpg' where id = $1 returning id`, [id]),
    );
    expect(r.rows).toHaveLength(0);
  });
});
