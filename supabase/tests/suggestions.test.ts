// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { addUser, asUser, freshDb } from './harness';

type U = { id: string; email: string };
let db: PGlite;
let kahrman: U, megan: U, stranger: U;
let kShelf: string, sShelf: string;

const as = (u: U | null, sql: string, params: unknown[] = []) => asUser(db, u, () => db.query(sql, params));

async function suggest(u: U, shelf: string, over: { artist?: string; title?: string; reason?: string; status?: string } = {}) {
  const id = crypto.randomUUID();
  await as(
    u,
    `insert into public.suggestions (id, shelf_id, artist, title, reason, status, round_at) values ($1, $2, $3, $4, $5, $6, now())`,
    [id, shelf, over.artist ?? 'Miles Davis', over.title ?? 'Kind of Blue', over.reason ?? 'You rated jazz highly.', over.status ?? 'pending'],
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
});

describe('suggestions', () => {
  it('lets a member insert one and read it back as pending, with empty Discogs facts', async () => {
    const id = await suggest(kahrman, kShelf);
    const rows = (await as(megan, 'select status, discogs_release_id, discogs_genres, discogs_styles, decided_by from public.suggestions where id = $1', [id])).rows;
    expect(rows).toEqual([{ status: 'pending', discogs_release_id: null, discogs_genres: [], discogs_styles: [], decided_by: null }]);
  });

  it('keeps a stranger out: can’t see, insert into or update Kahrman’s suggestions', async () => {
    const id = await suggest(kahrman, kShelf);
    expect((await as(stranger, 'select id from public.suggestions where id = $1', [id])).rows).toEqual([]);
    await expect(suggest(stranger, kShelf)).rejects.toThrow();
    await as(stranger, `update public.suggestions set status = 'dismissed', decided_by = $2 where id = $1`, [id, stranger.id]);
    expect((await db.query<{ status: string }>('select status from public.suggestions where id = $1', [id])).rows[0].status).toBe('pending');
  });

  it('lets Megan dismiss as herself, but not as Kahrman', async () => {
    const id = await suggest(kahrman, kShelf);
    await expect(
      as(megan, `update public.suggestions set status = 'dismissed', decided_by = $2 where id = $1`, [id, kahrman.id]),
    ).rejects.toThrow();
    await as(megan, `update public.suggestions set status = 'dismissed', decided_by = $2, decided_at = now() where id = $1`, [id, megan.id]);
    const row = (await db.query<{ status: string; decided_by: string }>('select status, decided_by from public.suggestions where id = $1', [id])).rows[0];
    expect(row).toEqual({ status: 'dismissed', decided_by: megan.id });
  });

  it('refuses updates to artist, reason or shelf_id', async () => {
    const id = await suggest(kahrman, kShelf);
    await expect(as(megan, `update public.suggestions set artist = 'X' where id = $1`, [id])).rejects.toThrow();
    await expect(as(megan, `update public.suggestions set reason = 'X' where id = $1`, [id])).rejects.toThrow();
    await expect(as(kahrman, `update public.suggestions set shelf_id = $2 where id = $1`, [id, sShelf])).rejects.toThrow();
  });

  it('refuses an insert that is not pending', async () => {
    await expect(suggest(kahrman, kShelf, { status: 'added' })).rejects.toThrow();
  });

  it('refuses bad lengths and statuses', async () => {
    await expect(suggest(kahrman, kShelf, { reason: 'x'.repeat(141) })).rejects.toThrow();
    await expect(suggest(kahrman, kShelf, { title: '' })).rejects.toThrow();
    await expect(suggest(kahrman, kShelf, { title: '   ' })).rejects.toThrow();
    await expect(suggest(kahrman, kShelf, { artist: 'x'.repeat(201) })).rejects.toThrow();
    await expect(suggest(kahrman, kShelf, { status: 'maybe' })).rejects.toThrow();
    await suggest(kahrman, kShelf, { reason: 'x'.repeat(140), artist: 'x'.repeat(200) });
  });

  it('is removed with its shelf', async () => {
    await suggest(kahrman, kShelf);
    await db.query('delete from public.shelves where id = $1', [kShelf]);
    expect((await db.query('select id from public.suggestions')).rows).toEqual([]);
  });

  it('moves updated_at on update', async () => {
    const id = await suggest(kahrman, kShelf);
    await db.query(`update public.suggestions set updated_at = now() - interval '1 day' where id = $1`, [id]);
    const old = (await db.query<{ t: string }>('select updated_at::text t from public.suggestions where id = $1', [id])).rows[0].t;
    await as(kahrman, `update public.suggestions set status = 'dismissed', decided_by = $2 where id = $1`, [id, kahrman.id]);
    const now = (await db.query<{ t: string }>('select updated_at::text t from public.suggestions where id = $1', [id])).rows[0].t;
    expect(now).not.toBe(old);
  });
});
