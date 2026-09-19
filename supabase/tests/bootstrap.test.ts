// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { addUser, asUser, freshDb } from './harness';

type U = { id: string; email: string };
let db: PGlite;
let kahrman: U;
let megan: U;

const bootstrap = (u: U, name: string | null = null) =>
  asUser(db, u, async () => (await db.query<{ bootstrap: string }>('select public.bootstrap($1) as bootstrap', [name])).rows[0].bootstrap);

beforeEach(async () => {
  db = await freshDb();
  kahrman = await addUser(db, 'kahrman@example.com');
  megan = await addUser(db, 'Megan@Example.com');
});

describe('bootstrap', () => {
  it('sets up a first-time person with a name and a shelf they own', async () => {
    const shelf = await bootstrap(kahrman, 'Kahrman');
    const profile = await db.query<{ display_name: string }>('select display_name from public.profiles where id = $1', [kahrman.id]);
    const members = await db.query<{ role: string }>('select role from public.shelf_members where shelf_id = $1 and user_id = $2', [shelf, kahrman.id]);
    expect(profile.rows[0].display_name).toBe('Kahrman');
    expect(members.rows[0].role).toBe('owner');
  });

  it('returns the same shelf every time and never duplicates anything', async () => {
    const first = await bootstrap(kahrman, 'Kahrman');
    const again = await bootstrap(kahrman);
    expect(again).toBe(first);
    expect((await db.query('select * from public.shelves')).rows).toHaveLength(1);
    expect((await db.query<{ display_name: string }>('select display_name from public.profiles')).rows[0].display_name).toBe('Kahrman');
  });

  it('falls back to the email name when no name is given', async () => {
    await bootstrap(kahrman);
    expect((await db.query<{ display_name: string }>('select display_name from public.profiles')).rows[0].display_name).toBe('kahrman');
  });

  it('puts an invited person on the inviter’s shelf, whatever case their email is in', async () => {
    const shelf = await bootstrap(kahrman, 'Kahrman');
    await asUser(db, kahrman, () =>
      db.query(`insert into public.shelf_invites (shelf_id, email, invited_by) values ($1, 'megan@example.com', $2)`, [shelf, kahrman.id]),
    );
    expect(await bootstrap(megan, 'Megan')).toBe(shelf);
    const invite = await db.query<{ accepted_at: Date | null }>('select accepted_at from public.shelf_invites');
    expect(invite.rows[0].accepted_at).not.toBeNull();
    expect((await db.query('select * from public.shelves')).rows).toHaveLength(1);
  });

  it('swaps an invited person’s own empty shelf for the one they were invited to', async () => {
    const own = await bootstrap(megan, 'Megan');
    const shelf = await bootstrap(kahrman, 'Kahrman');
    await asUser(db, kahrman, () =>
      db.query(`insert into public.shelf_invites (shelf_id, email, invited_by) values ($1, 'megan@example.com', $2)`, [shelf, kahrman.id]),
    );
    expect(await bootstrap(megan)).toBe(shelf);
    expect((await db.query('select * from public.shelves where id = $1', [own])).rows).toHaveLength(0);
  });

  it('keeps an invited person’s own shelf if it has records on it', async () => {
    const own = await bootstrap(megan, 'Megan');
    await db.query(`insert into public.records (id, shelf_id, status, artist, title, genre, added_by) values ($1, $2, 'owned', 'A', 'B', 'popsoul', $3)`, [
      crypto.randomUUID(), own, megan.id,
    ]);
    const shelf = await bootstrap(kahrman, 'Kahrman');
    await asUser(db, kahrman, () =>
      db.query(`insert into public.shelf_invites (shelf_id, email, invited_by) values ($1, 'megan@example.com', $2)`, [shelf, kahrman.id]),
    );
    expect(await bootstrap(megan)).toBe(own);
    const invite = await db.query<{ accepted_at: Date | null }>('select accepted_at from public.shelf_invites');
    expect(invite.rows[0].accepted_at).toBeNull();
    const membership = await db.query('select 1 from public.shelf_members where shelf_id = $1 and user_id = $2', [shelf, megan.id]);
    expect(membership.rows).toHaveLength(0);
  });

  it('keeps its owner on their own shelf even when a stranger invites them', async () => {
    const shelf = await bootstrap(kahrman, 'Kahrman');
    await db.query(`insert into public.records (id, shelf_id, status, artist, title, genre, added_by) values ($1, $2, 'owned', 'A', 'B', 'popsoul', $3)`, [
      crypto.randomUUID(), shelf, kahrman.id,
    ]);
    const meganShelf = await bootstrap(megan, 'Megan');
    await asUser(db, megan, () =>
      db.query(`insert into public.shelf_invites (shelf_id, email, invited_by) values ($1, 'kahrman@example.com', $2)`, [meganShelf, megan.id]),
    );
    expect(await bootstrap(kahrman)).toBe(shelf);
    const invite = await db.query<{ accepted_at: Date | null }>('select accepted_at from public.shelf_invites');
    expect(invite.rows[0].accepted_at).toBeNull();
    const membership = await db.query('select 1 from public.shelf_members where shelf_id = $1 and user_id = $2', [meganShelf, kahrman.id]);
    expect(membership.rows).toHaveLength(0);
  });

  it('does not accept an invite for an email the person has not confirmed', async () => {
    const shelf = await bootstrap(kahrman, 'Kahrman');
    const dana = await addUser(db, 'dana@example.com', { confirmed: false });
    await asUser(db, kahrman, () =>
      db.query(`insert into public.shelf_invites (shelf_id, email, invited_by) values ($1, 'dana@example.com', $2)`, [shelf, kahrman.id]),
    );
    const danaShelf = await bootstrap(dana, 'Dana');
    expect(danaShelf).not.toBe(shelf);
    const invite = await db.query<{ accepted_at: Date | null }>('select accepted_at from public.shelf_invites where email = $1', ['dana@example.com']);
    expect(invite.rows[0].accepted_at).toBeNull();
    const membership = await db.query('select 1 from public.shelf_members where shelf_id = $1 and user_id = $2', [shelf, dana.id]);
    expect(membership.rows).toHaveLength(0);
  });

  it('refuses a display name over 60 characters', async () => {
    await expect(bootstrap(kahrman, 'x'.repeat(61))).rejects.toThrow(/Name is too long/);
  });

  it('refuses when nobody is signed in', async () => {
    await expect(asUser(db, null, () => db.query('select public.bootstrap(null)'))).rejects.toThrow(/permission denied/);
  });
});

describe('ping', () => {
  it('answers even when signed out, so the keep-awake job can call it', async () => {
    const result = await asUser(db, null, () => db.query<{ ping: boolean }>('select public.ping() as ping'));
    expect(result.rows[0].ping).toBe(true);
  });
});
