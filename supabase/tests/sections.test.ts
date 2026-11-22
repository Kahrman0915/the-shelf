// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { KAHRMANS_NINE, STARTER_SET, sectionIdFor, type LegacyGenre, type SectionSeed } from '@/domain/sections';
import { addUser, applyMigrations, asUser, freshDb } from './harness';

const SECTIONS_MIGRATION = '20261123120000';

type U = { id: string; email: string };
type SectionRow = {
  id: string;
  name: string;
  color: string;
  position: number;
  discogs_genres: string[];
  takes_holiday: boolean;
  is_catch_all: boolean;
  legacy_genre: string;
};
let db: PGlite;
let kahrman: U, megan: U, stranger: U;
let kShelf: string, sShelf: string;
/** Records written before the migration, with the genre each had. */
let before: { id: string; shelf: string; genre: LegacyGenre }[];

const k = (genre: LegacyGenre) => sectionIdFor(kShelf, genre);
const s = (genre: LegacyGenre) => sectionIdFor(sShelf, genre);

async function oldRecord(shelf: string, by: string, genre: LegacyGenre, extra: { importKey?: string; deleted?: boolean } = {}) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.records (id, shelf_id, status, artist, title, genre, added_by, import_key, deleted_at)
     values ($1, $2, 'owned', 'Coltrane', 'T', $3, $4, $5, $6)`,
    [id, shelf, genre, by, extra.importKey ?? null, extra.deleted ? new Date() : null],
  );
  before.push({ id, shelf, genre });
  return id;
}

const sectionsOf = async (shelf: string) =>
  (await db.query<SectionRow>(
    `select id, name, color, position, discogs_genres, takes_holiday, is_catch_all, legacy_genre::text
     from public.sections where shelf_id = $1 order by position`,
    [shelf],
  )).rows;

const expected = (shelf: string, set: SectionSeed[]): SectionRow[] =>
  set.map((x, i) => ({
    id: sectionIdFor(shelf, x.legacyGenre),
    name: x.name,
    color: x.color,
    position: i,
    discogs_genres: x.discogsGenres,
    takes_holiday: x.takesHoliday,
    is_catch_all: x.isCatchAll,
    legacy_genre: x.legacyGenre,
  }));

const placeOf = async (id: string) =>
  (await db.query<{ section_id: string; genre: string }>('select section_id, genre::text from public.records where id = $1', [id])).rows[0];

const as = (u: U | null, sql: string, params: unknown[] = []) => asUser(db, u, () => db.query(sql, params));

/** As the old app does: names a genre and no section. */
async function oldAppInsert(u: U, shelf: string, genre: string) {
  const id = crypto.randomUUID();
  await as(u, `insert into public.records (id, shelf_id, status, artist, title, genre, added_by) values ($1, $2, 'owned', 'A', 'B', $3, $4)`, [
    id, shelf, genre, u.id,
  ]);
  return id;
}

/** As the new app does: names a section and no genre. */
async function newAppInsert(u: U, shelf: string, sectionId: string, status = 'owned') {
  const id = crypto.randomUUID();
  await as(u, `insert into public.records (id, shelf_id, status, artist, title, section_id, added_by) values ($1, $2, $3, 'A', 'B', $4, $5)`, [
    id, shelf, status, sectionId, u.id,
  ]);
  return id;
}

const merge = (u: U | null, from: string, into: string) => as(u, 'select public.merge_section($1, $2)', [from, into]);

/** Records whose genre has drifted from their section's legacy genre (should always be none). */
const drifted = async () =>
  (await db.query('select r.id from public.records r join public.sections x on x.id = r.section_id where r.genre <> x.legacy_genre')).rows;

beforeEach(async () => {
  db = await freshDb({ before: SECTIONS_MIGRATION });
  before = [];
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
  await oldRecord(kShelf, kahrman.id, 'jazz', { importKey: 'row-1' });
  await oldRecord(kShelf, kahrman.id, 'misc');
  await oldRecord(kShelf, megan.id, 'christmas', { deleted: true });
  await oldRecord(sShelf, stranger.id, 'rock');
  await applyMigrations(db, SECTIONS_MIGRATION);
});

describe('the migration', () => {
  it('gives Kahrman’s shelf his nine, in order, with Miscellaneous the catch-all at position 4', async () => {
    const rows = await sectionsOf(kShelf);
    expect(rows).toEqual(expected(kShelf, KAHRMANS_NINE));
    expect(rows.map((r) => r.name)).toEqual([
      'Jazz / big band', 'Rock', 'Pop / soul / contemporary', 'Popular pop', 'Miscellaneous', 'Country', 'Reggae', 'Soundtracks', 'Christmas',
    ]);
    expect(rows.filter((r) => r.is_catch_all)).toEqual([expect.objectContaining({ name: 'Miscellaneous', position: 4 })]);
  });

  it('gives a shelf with no imported records the starter set', async () => {
    expect(await sectionsOf(sShelf)).toEqual(expected(sShelf, STARTER_SET));
  });

  it('puts every record in the section derived from its old genre, the same id the app works out', async () => {
    const rows = (await db.query<{ id: string; shelf_id: string; section_id: string; genre: string; derived: string }>(
      'select id, shelf_id, section_id, genre::text, public.section_id_for(shelf_id, genre) as derived from public.records',
    )).rows;
    expect(rows).toHaveLength(before.length);
    for (const b of before) {
      const row = rows.find((r) => r.id === b.id)!;
      expect(row.genre).toBe(b.genre);
      expect(row.section_id).toBe(row.derived);
      expect(row.section_id).toBe(sectionIdFor(b.shelf, b.genre));
    }
  });

  it('makes section_id required', async () => {
    const col = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'records' and column_name = 'section_id'`,
    );
    expect(col.rows[0].is_nullable).toBe('NO');
  });
});

describe('bootstrap', () => {
  it('seeds a new person’s shelf with the starter set', async () => {
    const newcomer = await addUser(db, 'newcomer@example.com');
    const shelf = (await as(newcomer, 'select public.bootstrap($1) as shelf', ['New'])).rows[0] as { shelf: string };
    expect(await sectionsOf(shelf.shelf)).toEqual(expected(shelf.shelf, STARTER_SET));
  });

  it('seeds nothing more when the person comes back', async () => {
    const newcomer = await addUser(db, 'newcomer@example.com');
    await as(newcomer, 'select public.bootstrap(null)');
    const shelf = ((await as(newcomer, 'select public.bootstrap(null) as shelf')).rows[0] as { shelf: string }).shelf;
    expect(await sectionsOf(shelf)).toHaveLength(STARTER_SET.length);
  });

  it('still drops an invited person’s own empty shelf, sections and all', async () => {
    const newcomer = await addUser(db, 'newcomer@example.com');
    const own = ((await as(newcomer, 'select public.bootstrap(null) as shelf')).rows[0] as { shelf: string }).shelf;
    await as(kahrman, `insert into public.shelf_invites (shelf_id, email, invited_by) values ($1, 'newcomer@example.com', $2)`, [kShelf, kahrman.id]);
    expect(((await as(newcomer, 'select public.bootstrap(null) as shelf')).rows[0] as { shelf: string }).shelf).toBe(kShelf);
    expect(await sectionsOf(own)).toEqual([]);
  });
});

describe('an old app, which writes genre', () => {
  it('lands an insert with a genre and no section in that genre’s section', async () => {
    const id = await oldAppInsert(megan, kShelf, 'rock');
    expect(await placeOf(id)).toEqual({ section_id: k('rock'), genre: 'rock' });
  });

  it('moves a record when only its genre changes', async () => {
    const id = await oldAppInsert(megan, kShelf, 'rock');
    await as(megan, `update public.records set genre = 'jazz' where id = $1`, [id]);
    expect(await placeOf(id)).toEqual({ section_id: k('jazz'), genre: 'jazz' });
  });

  it('uses the first section by position when two carry the genre', async () => {
    await db.query(`insert into public.sections (shelf_id, name, color, position, legacy_genre) values ($1, 'Later rock', 'teal', 20, 'rock')`, [kShelf]);
    const id = await oldAppInsert(megan, kShelf, 'rock');
    expect((await placeOf(id)).section_id).toBe(k('rock'));
  });

  it('lands a genre with no section of its own in the catch-all', async () => {
    await as(stranger, 'delete from public.sections where id = $1', [s('reggae')]);
    const id = await oldAppInsert(stranger, sShelf, 'reggae');
    expect(await placeOf(id)).toEqual({ section_id: s('misc'), genre: 'misc' });
  });

  it('leaves the section alone when an edit doesn’t touch the genre', async () => {
    const id = await newAppInsert(megan, kShelf, k('reggae'));
    await as(megan, `update public.records set title = 'Changed', genre = 'reggae' where id = $1`, [id]);
    expect(await placeOf(id)).toEqual({ section_id: k('reggae'), genre: 'reggae' });
  });

  it('keeps genre equal to the section’s legacy genre after any write', async () => {
    const extra = (await db.query<{ id: string }>(
      `insert into public.sections (shelf_id, name, color, position) values ($1, 'Blues', 'slate', 9) returning id`, [kShelf],
    )).rows[0].id;
    const a = await oldAppInsert(megan, kShelf, 'country');
    const b = await newAppInsert(megan, kShelf, extra);
    await as(megan, 'update public.records set section_id = $2 where id = $1', [a, extra]);
    await as(megan, `update public.records set genre = 'soundtracks' where id = $1`, [b]);
    await as(megan, `update public.records set genre = 'jazz', section_id = $2 where id = $1`, [a, k('reggae')]);
    await merge(megan, k('rock'), extra);
    expect(await placeOf(a)).toEqual({ section_id: k('reggae'), genre: 'reggae' });
    expect(await placeOf(b)).toEqual({ section_id: k('soundtracks'), genre: 'soundtracks' });
    expect(await drifted()).toEqual([]);
  });
});

describe('the new app, which writes section_id', () => {
  it('inserts with a section and no genre, and the genre is filled in', async () => {
    const id = await newAppInsert(megan, kShelf, k('popsoul'));
    expect(await placeOf(id)).toEqual({ section_id: k('popsoul'), genre: 'popsoul' });
  });

  it('a section made later fills genre with misc', async () => {
    const extra = (await as(megan, `insert into public.sections (shelf_id, name, color, position) values ($1, 'Blues', 'slate', 9) returning id`, [kShelf]))
      .rows[0] as { id: string };
    const id = await newAppInsert(megan, kShelf, extra.id);
    expect(await placeOf(id)).toEqual({ section_id: extra.id, genre: 'misc' });
  });

  it('moves a record by changing only section_id', async () => {
    const id = await newAppInsert(megan, kShelf, k('popsoul'));
    await as(megan, 'update public.records set section_id = $2 where id = $1', [id, k('jazz')]);
    expect(await placeOf(id)).toEqual({ section_id: k('jazz'), genre: 'jazz' });
  });
});

describe('rerouting late writes', () => {
  it('lands a write to a merged section in the section it was merged into', async () => {
    const existing = await newAppInsert(megan, kShelf, k('popsoul'));
    await merge(kahrman, k('rock'), k('jazz'));
    const inserted = await newAppInsert(megan, kShelf, k('rock'));
    await as(megan, 'update public.records set section_id = $2 where id = $1', [existing, k('rock')]);
    expect(await placeOf(inserted)).toEqual({ section_id: k('jazz'), genre: 'jazz' });
    expect(await placeOf(existing)).toEqual({ section_id: k('jazz'), genre: 'jazz' });
  });

  it('follows a section merged twice to where it ended up', async () => {
    await merge(kahrman, k('rock'), k('jazz'));
    await merge(kahrman, k('jazz'), k('country'));
    const id = await newAppInsert(megan, kShelf, k('rock'));
    expect(await placeOf(id)).toEqual({ section_id: k('country'), genre: 'country' });
  });

  it('lands an unknown section in the catch-all', async () => {
    const id = await newAppInsert(megan, kShelf, crypto.randomUUID());
    expect(await placeOf(id)).toEqual({ section_id: k('misc'), genre: 'misc' });
  });

  it('refuses a section from another shelf', async () => {
    await expect(newAppInsert(megan, kShelf, s('rock'))).rejects.toThrow(/section belongs to another shelf/);
    const id = await newAppInsert(megan, kShelf, k('rock'));
    await expect(as(megan, 'update public.records set section_id = $2 where id = $1', [id, s('jazz')])).rejects.toThrow(
      /section belongs to another shelf/,
    );
  });
});

describe('merge_section', () => {
  it('moves live and deleted records, then removes the section', async () => {
    const live = await newAppInsert(megan, kShelf, k('christmas'));
    const deleted = before.find((b) => b.genre === 'christmas')!.id;
    await merge(megan, k('christmas'), k('misc'));
    expect(await placeOf(live)).toEqual({ section_id: k('misc'), genre: 'misc' });
    expect(await placeOf(deleted)).toEqual({ section_id: k('misc'), genre: 'misc' });
    expect((await db.query('select 1 from public.sections where id = $1', [k('christmas')])).rows).toEqual([]);
    expect((await db.query('select into_id, shelf_id from public.section_redirects where from_id = $1', [k('christmas')])).rows).toEqual([
      { into_id: k('misc'), shelf_id: kShelf },
    ]);
  });

  it('hands over its Discogs genres and its holiday flag', async () => {
    await as(megan, 'update public.sections set takes_holiday = true where id = $1', [k('rock')]);
    await as(megan, `update public.sections set discogs_genres = '{Jazz,Blues}' where id = $1`, [k('jazz')]);
    await as(megan, `update public.sections set discogs_genres = '{Rock,Blues}' where id = $1`, [k('rock')]);
    await merge(megan, k('rock'), k('jazz'));
    const jazz = (await sectionsOf(kShelf)).find((x) => x.id === k('jazz'))!;
    expect(jazz.discogs_genres).toEqual(['Jazz', 'Rock', 'Blues']);
    expect(jazz.takes_holiday).toBe(true);
  });

  it('re-points earlier redirects at the survivor', async () => {
    await merge(kahrman, k('rock'), k('jazz'));
    await merge(kahrman, k('jazz'), k('country'));
    const rows = (await db.query<{ from_id: string; into_id: string }>('select from_id, into_id from public.section_redirects order by from_id')).rows;
    expect(rows).toEqual(
      [{ from_id: k('rock'), into_id: k('country') }, { from_id: k('jazz'), into_id: k('country') }].sort((a, b) => a.from_id.localeCompare(b.from_id)),
    );
  });

  it('refuses to merge away the catch-all', async () => {
    await expect(merge(kahrman, k('misc'), k('jazz'))).rejects.toThrow(/catch-all/);
  });

  it('refuses sections on two shelves, or a section into itself', async () => {
    await expect(merge(kahrman, k('rock'), s('rock'))).rejects.toThrow();
    await expect(merge(kahrman, k('rock'), k('rock'))).rejects.toThrow();
  });

  it('a stranger can’t merge', async () => {
    await expect(merge(stranger, k('rock'), k('jazz'))).rejects.toThrow();
    expect(await sectionsOf(kShelf)).toHaveLength(9);
  });

  it('can’t be run when signed out', async () => {
    await expect(merge(null, k('rock'), k('jazz'))).rejects.toThrow(/permission denied/);
  });
});

describe('claims', () => {
  it('setting takes_holiday on one section clears it on the other', async () => {
    await as(megan, 'update public.sections set takes_holiday = true where id = $1', [k('rock')]);
    const holiday = (await sectionsOf(kShelf)).filter((x) => x.takes_holiday).map((x) => x.id);
    expect(holiday).toEqual([k('rock')]);
  });

  it('claiming a Discogs genre takes it off the section that had it', async () => {
    await as(megan, `update public.sections set discogs_genres = '{Jazz,Rock}' where id = $1`, [k('jazz')]);
    const rows = await sectionsOf(kShelf);
    expect(rows.find((x) => x.id === k('jazz'))!.discogs_genres).toEqual(['Jazz', 'Rock']);
    expect(rows.find((x) => x.id === k('rock'))!.discogs_genres).toEqual([]);
  });

  it('a new section can claim too', async () => {
    await as(megan, `insert into public.sections (shelf_id, name, color, position, discogs_genres, takes_holiday) values ($1, 'Mine', 'sand', 9, '{Pop}', true)`, [
      kShelf,
    ]);
    const rows = await sectionsOf(kShelf);
    expect(rows.find((x) => x.id === k('popularpop'))!.discogs_genres).toEqual([]);
    expect(rows.find((x) => x.id === k('christmas'))!.takes_holiday).toBe(false);
  });

  it('claims stay on one shelf', async () => {
    await as(megan, `update public.sections set discogs_genres = '{Jazz,Rock}' where id = $1`, [k('jazz')]);
    expect((await sectionsOf(sShelf)).find((x) => x.id === s('rock'))!.discogs_genres).toEqual(['Rock']);
  });
});

describe('rules', () => {
  it('a stranger can’t see or change another shelf’s sections or redirects', async () => {
    await merge(kahrman, k('rock'), k('jazz'));
    expect((await as(stranger, 'select id from public.sections where shelf_id = $1', [kShelf])).rows).toEqual([]);
    expect((await as(stranger, 'select from_id from public.section_redirects where shelf_id = $1', [kShelf])).rows).toEqual([]);
    expect((await as(stranger, `update public.sections set name = 'Mine' where shelf_id = $1 returning id`, [kShelf])).rows).toEqual([]);
    expect((await as(stranger, 'delete from public.sections where id = $1 returning id', [k('country')])).rows).toEqual([]);
    await expect(
      as(stranger, `insert into public.sections (shelf_id, name, color, position) values ($1, 'Mine', 'teal', 9)`, [kShelf]),
    ).rejects.toThrow(/row-level security/);
  });

  it('signed out, nothing is visible', async () => {
    await expect(as(null, 'select id from public.sections')).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select from_id from public.section_redirects')).rejects.toThrow(/permission denied/);
  });

  it('a member sees the shelf’s redirects', async () => {
    await merge(kahrman, k('rock'), k('jazz'));
    expect((await as(megan, 'select from_id from public.section_redirects')).rows).toEqual([{ from_id: k('rock') }]);
  });

  it('a member can add a section, but not a catch-all or one with a legacy genre', async () => {
    const added = await as(megan, `insert into public.sections (shelf_id, name, color, position) values ($1, 'Blues', 'teal', 9) returning legacy_genre::text`, [
      kShelf,
    ]);
    expect(added.rows).toEqual([{ legacy_genre: 'misc' }]);
    await expect(
      as(megan, `insert into public.sections (shelf_id, name, color, position, is_catch_all) values ($1, 'Other', 'teal', 10, true)`, [kShelf]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(megan, `insert into public.sections (shelf_id, name, color, position, legacy_genre) values ($1, 'Other', 'teal', 10, 'rock')`, [kShelf]),
    ).rejects.toThrow(/row-level security/);
  });

  it('a member can rename, recolour and reorder', async () => {
    const r = await as(megan, `update public.sections set name = 'Rock & roll', color = 'slate', position = 12 where id = $1 returning name, color, position`, [
      k('rock'),
    ]);
    expect(r.rows).toEqual([{ name: 'Rock & roll', color: 'slate', position: 12 }]);
  });

  it('nobody can change which shelf, catch-all or legacy genre a section has', async () => {
    await expect(as(megan, 'update public.sections set is_catch_all = true where id = $1', [k('rock')])).rejects.toThrow(/permission denied/);
    await expect(as(megan, `update public.sections set legacy_genre = 'jazz' where id = $1`, [k('rock')])).rejects.toThrow(/permission denied/);
    await expect(as(megan, 'update public.sections set shelf_id = $2 where id = $1', [k('rock'), sShelf])).rejects.toThrow(/permission denied/);
  });

  it('a redirect only ever runs from a live section to another on the same shelf, and is never removed', async () => {
    const redirect = (from: string, into: string, shelf: string) =>
      as(megan, 'insert into public.section_redirects (from_id, into_id, shelf_id) values ($1, $2, $3)', [from, into, shelf]);
    await expect(redirect(crypto.randomUUID(), k('jazz'), kShelf)).rejects.toThrow(/row-level security/);
    await expect(redirect(k('misc'), k('jazz'), kShelf)).rejects.toThrow(/row-level security/);
    await expect(redirect(k('rock'), s('jazz'), kShelf)).rejects.toThrow(/row-level security/);
    await expect(redirect(s('rock'), s('jazz'), sShelf)).rejects.toThrow(/row-level security/);
    await merge(kahrman, k('rock'), k('jazz'));
    await expect(as(megan, 'update public.section_redirects set into_id = $1', [s('jazz')])).rejects.toThrow(/row-level security/);
    await expect(as(megan, 'delete from public.section_redirects')).rejects.toThrow(/permission denied/);
    await expect(as(kahrman, 'truncate public.sections cascade')).rejects.toThrow(/permission denied/);
  });

  it('a member can delete an empty section', async () => {
    expect((await as(megan, 'delete from public.sections where id = $1 returning id', [k('reggae')])).rows).toEqual([{ id: k('reggae') }]);
  });

  it('the catch-all can’t be deleted', async () => {
    expect((await as(kahrman, 'delete from public.sections where id = $1 returning id', [k('misc')])).rows).toEqual([]);
    expect((await sectionsOf(kShelf)).some((x) => x.id === k('misc'))).toBe(true);
  });

  it('a section with records can’t be deleted, even if they’re all deleted', async () => {
    await expect(as(megan, 'delete from public.sections where id = $1', [k('jazz')])).rejects.toThrow(/foreign key/);
    await expect(as(megan, 'delete from public.sections where id = $1', [k('christmas')])).rejects.toThrow(/foreign key/);
  });

  it('a shelf can still be removed, records, sections and all', async () => {
    await db.query('delete from public.shelves where id = $1', [kShelf]);
    expect((await db.query('select 1 from public.sections where shelf_id = $1', [kShelf])).rows).toEqual([]);
    expect((await db.query('select 1 from public.records where shelf_id = $1', [kShelf])).rows).toEqual([]);
  });
});

describe('checks', () => {
  const update = (sql: string, value: unknown) => as(megan, `update public.sections set ${sql} where id = $1`, [k('rock'), value]);

  it('a name is 1–40 characters once trimmed', async () => {
    await expect(update('name = $2', 'a'.repeat(41))).rejects.toThrow(/violates check constraint/);
    await expect(update('name = $2', '   ')).rejects.toThrow(/violates check constraint/);
    await expect(update('name = $2', 'a'.repeat(40))).resolves.toBeDefined();
  });

  it('a colour is one of the swatch keys', async () => {
    await expect(update('color = $2', 'purple')).rejects.toThrow(/violates check constraint/);
    await expect(update('color = $2', 'sand')).resolves.toBeDefined();
  });

  it('a Discogs genre is one of Discogs’ fifteen', async () => {
    await expect(update('discogs_genres = $2', ['Rock', 'Grunge'])).rejects.toThrow(/violates check constraint/);
    await expect(update('discogs_genres = $2', ['Rock', 'Hip Hop'])).resolves.toBeDefined();
  });
});

describe('earlier triggers', () => {
  it('a first rating still moves a new arrival onto the shelf, in the same section', async () => {
    const id = await newAppInsert(megan, kShelf, k('reggae'), 'new_arrival');
    await as(megan, 'insert into public.ratings (record_id, user_id, value) values ($1, $2, 5)', [id, megan.id]);
    const row = (await db.query<{ status: string; section_id: string }>('select status, section_id from public.records where id = $1', [id])).rows[0];
    expect(row).toEqual({ status: 'owned', section_id: k('reggae') });
  });

  it('every write still moves updated_at', async () => {
    const id = await newAppInsert(megan, kShelf, k('reggae'));
    const first = (await db.query<{ updated_at: Date }>('select updated_at from public.records where id = $1', [id])).rows[0].updated_at;
    await as(megan, 'update public.records set section_id = $2 where id = $1', [id, k('jazz')]);
    const second = (await db.query<{ updated_at: Date }>('select updated_at from public.records where id = $1', [id])).rows[0].updated_at;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });
});
