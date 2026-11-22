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
const put = (u: U, name: string, bucket = 'covers') =>
  asUser(db, u, () => db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]));
const see = (u: U, name: string) =>
  asUser(db, u, () => db.query(`select id from storage.objects where bucket_id = 'covers' and name = $1`, [name]));

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
  // As bootstrap() does for a new shelf: records need a section to sit in.
  await db.query('select public.seed_sections($1, false), public.seed_sections($2, false)', [kShelf, sShelf]);
  await db.query(`insert into public.shelf_members (shelf_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member'), ($4, $5, 'owner')`, [
    kShelf, kahrman.id, megan.id, sShelf, stranger.id,
  ]);
});

describe('the covers bucket', () => {
  it('is private and takes only JPEGs up to 2 MB', async () => {
    const r = await db.query<{ public: boolean; file_size_limit: string | number; allowed_mime_types: string[] }>(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'covers'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].public).toBe(false);
    expect(Number(r.rows[0].file_size_limit)).toBe(2097152);
    expect(r.rows[0].allowed_mime_types).toEqual(['image/jpeg']);
  });

  it('lets a member add, see, replace and remove a photo in their shelf’s folder', async () => {
    const name = `${kShelf}/${crypto.randomUUID()}/front-${crypto.randomUUID()}.jpg`;
    await put(megan, name);
    expect((await see(megan, name)).rows).toHaveLength(1);
    const upd = await asMegan(`update storage.objects set owner = $2 where bucket_id = 'covers' and name = $1 returning id`, [name, megan.id]);
    expect(upd.rows).toHaveLength(1);
    const del = await asMegan(`delete from storage.objects where bucket_id = 'covers' and name = $1 returning id`, [name]);
    expect(del.rows).toHaveLength(1);
  });

  it('hides a shelf’s photos from, and refuses uploads by, anyone outside it', async () => {
    const name = `${kShelf}/${crypto.randomUUID()}/front-${crypto.randomUUID()}.jpg`;
    await put(kahrman, name);
    expect((await see(stranger, name)).rows).toHaveLength(0);
    await expect(put(stranger, `${kShelf}/${crypto.randomUUID()}/front-${crypto.randomUUID()}.jpg`)).rejects.toThrow(/row-level security/);
  });

  it('lets no one outside the shelf replace or remove its photos', async () => {
    const name = `${kShelf}/${crypto.randomUUID()}/front-${crypto.randomUUID()}.jpg`;
    await put(kahrman, name);
    const asStranger = (sql: string, params: unknown[]) => asUser(db, stranger, () => db.query(sql, params));
    const upd = await asStranger(`update storage.objects set owner = $2 where bucket_id = 'covers' and name = $1 returning id`, [name, stranger.id]);
    expect(upd.rows).toHaveLength(0);
    const del = await asStranger(`delete from storage.objects where bucket_id = 'covers' and name = $1 returning id`, [name]);
    expect(del.rows).toHaveLength(0);
    expect((await see(kahrman, name)).rows).toHaveLength(1);
  });

  it('refuses a member moving a photo into another shelf’s folder', async () => {
    const name = `${kShelf}/${crypto.randomUUID()}/front-${crypto.randomUUID()}.jpg`;
    await put(megan, name);
    const moved = `${sShelf}/${crypto.randomUUID()}/front-${crypto.randomUUID()}.jpg`;
    await expect(asMegan(`update storage.objects set name = $2 where bucket_id = 'covers' and name = $1`, [name, moved])).rejects.toThrow(/row-level security/);
    expect((await see(megan, name)).rows).toHaveLength(1);
  });

  it('refuses a folder that isn’t a shelf id', async () => {
    await expect(put(megan, `not-a-uuid/x/front-${crypto.randomUUID()}.jpg`)).rejects.toThrow(/row-level security/);
  });

  it('leaves other buckets untouched by these rules', async () => {
    await db.query(`insert into storage.buckets (id, name) values ('other', 'other')`);
    await expect(put(megan, `${kShelf}/x/front-${crypto.randomUUID()}.jpg`, 'other')).rejects.toThrow(/row-level security/);
  });
});

describe('a record’s photo paths', () => {
  it('lets a member point a record at its photos', async () => {
    const rec = await record();
    const r = await asMegan(
      `update public.records set cover_path = $2, back_path = $3 where id = $1 returning id`,
      [rec, `${kShelf}/${rec}/front-${crypto.randomUUID()}.jpg`, `${kShelf}/${rec}/back-${crypto.randomUUID()}.jpg`],
    );
    expect(r.rows).toHaveLength(1);
  });

  it('only accepts photos in the record’s own folder, on the right side, as JPEGs', async () => {
    const rec = await record();
    const other = crypto.randomUUID();
    const id = () => crypto.randomUUID();
    const badFronts = [
      `${sShelf}/${rec}/front-${id()}.jpg`,
      `${kShelf}/${other}/front-${id()}.jpg`,
      `${kShelf}/${rec}/back-${id()}.jpg`,
      `${kShelf}/${rec}/front-x.png`,
    ];
    for (const p of badFronts) {
      await expect(asMegan(`update public.records set cover_path = $2 where id = $1`, [rec, p])).rejects.toThrow(/violates check constraint/);
    }
    const badBacks = [
      `${sShelf}/${rec}/back-${id()}.jpg`,
      `${kShelf}/${other}/back-${id()}.jpg`,
      `${kShelf}/${rec}/front-${id()}.jpg`,
      `${kShelf}/${rec}/back-x.png`,
    ];
    for (const p of badBacks) {
      await expect(asMegan(`update public.records set back_path = $2 where id = $1`, [rec, p])).rejects.toThrow(/violates check constraint/);
    }
  });
});
