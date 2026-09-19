# Plan 2: One Shelf for Two, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kahrman and Megan sign in with an email code on their own phones and see the same shelf, kept in Supabase and pulled onto each phone for offline use. Ends with the shelf-filling opening on the sign-in screen.

**Architecture:** Supabase Postgres holds profiles, shelves, members, invites, records and ratings, with row-level security on every table and a `bootstrap()` function that sets a person up on each sign-in. The app talks to Supabase only through a small `Backend` interface (a real Supabase implementation and an in-memory fake for tests). Each phone keeps its Dexie notebook and fills it with a pull-only sync. Database tests run in PGlite (Postgres in WebAssembly) with a stand-in `auth` schema, so no Docker is needed.

**Tech Stack:** existing Plan 1 stack + `@supabase/supabase-js`, Supabase CLI (`npx supabase`), `@electric-sql/pglite` (tests), `tsx` (scripts), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-18-the-shelf-design.md` (§6 data model, §9 architecture, §15 Plan 2 decisions). **Handoff from Plan 1:** `docs/superpowers/notes/plan-2-handoff.md`.

**Not in this plan (Plan 3):** the outbox and every write feature except invites (Bought it, rating, editing, add record, photos, want list screens).

## Global Constraints

- Everything in Plan 1's Global Constraints still holds (genres, grades, shares, $3 floor, artist-first rows, price paid never on rows or the price check, colour rule, ratings per person, estimate copy, fail loudly, inputs ≥16px, tap targets ≥48px, no emoji or exclamation marks in UI copy).
- Every id is a uuid: records, ratings' `userId`, `shelfId`, `addedBy`.
- The secret key never enters git, the app bundle, or a test. Only `.env.local` on Kahrman's Mac holds it. The app reads only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Supabase project ref: `rlhhrzkaosngafcoxaas` (URL `https://rlhhrzkaosngafcoxaas.supabase.co`).
- The app reaches Supabase only through the `Backend` interface in `src/data/backend.ts`; screens never import `@supabase/supabase-js`.
- Sync is pull-only; the only write the app makes in this plan is an invite.
- Sign-in copy: email step button "Send my code"; code step button "Sign in"; wrong code "That code didn’t work. Check it, or send a new one."; expired code "That code expired. Send a new one."; name step "What should we call you?" with button "Start".
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `src/env.d.ts` | Types for the two `VITE_` variables |
| `.env.example` | The three variables, no values |
| `src/data/supabase.ts` | Read config (fail loudly), create the one Supabase client |
| `src/data/rowMapping.ts` | Database rows ⇄ app records/ratings, validated |
| `supabase/config.toml` | Created by `npx supabase init` |
| `supabase/migrations/20260919120000_shelf.sql` | Tables, types, triggers, RLS |
| `supabase/migrations/20260919120100_bootstrap.sql` | `bootstrap()` and `ping()` |
| `supabase/tests/harness.ts` | PGlite + stand-in `auth` schema + "act as this person" |
| `supabase/tests/*.test.ts` | RLS and bootstrap tests |
| `src/data/backend.ts` | `Backend`/`ShelfSource` interfaces, `Member`, `BackendError` |
| `src/data/supabaseBackend.ts` | `Backend` over Supabase |
| `src/test/fakeBackend.ts` | In-memory `Backend` for tests |
| `src/data/db.ts` | Dexie v2: records, ratings, members, meta |
| `src/data/sync.ts`, `src/data/useSync.ts` | Pull a shelf; run it on open/reconnect/foreground/60 s |
| `src/data/hooks.ts` | Live queries (adds `useMembers`) |
| `src/app/BackendContext.tsx`, `src/app/CurrentShelf.tsx`, `src/app/SyncContext.tsx` | Context providers |
| `src/app/useSession.ts` | Signed out / needs name / ready / error |
| `src/screens/SignInScreen.tsx`, `src/screens/NameScreen.tsx`, `src/screens/SettingsScreen.tsx` | New screens |
| `scripts/import-collection.ts` | One-time import of `collection.json` into a shelf |
| `.github/workflows/keep-supabase-awake.yml` | Calls `ping()` every 3 days |
| `src/ui/ShelfIntro.tsx` | The opening |

---

### Task 1: Supabase client config and row mapping

**Files:**
- Create: `src/env.d.ts`, `.env.example`, `src/data/supabase.ts`, `src/data/rowMapping.ts`
- Test: `src/data/supabase.test.ts`, `src/data/rowMapping.test.ts`

**Interfaces:**
- Consumes: `RecordSchema`, `RatingSchema`, `ShelfRecord`, `Rating` (`src/data/schema.ts`)
- Produces:
  - `class ConfigError extends Error`, `readConfig(env: Record<string, string | undefined>): { url: string; key: string }`, `supabase(): SupabaseClient` (one shared client)
  - `type RecordRow` (snake_case columns of `public.records`), `type RatingRow = { record_id: string; user_id: string; value: number; updated_at: string }`
  - `class RowError extends Error { problems: string[] }`
  - `recordToRow(r: ShelfRecord): RecordRow`, `recordFromRow(row: Record<string, unknown>): ShelfRecord`, `ratingToRow(r: Rating): RatingRow`, `ratingFromRow(row: Record<string, unknown>): Rating`

- [ ] **Step 1: Install supabase-js**

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 2: Write the failing tests**

`src/data/supabase.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConfigError, readConfig } from './supabase';

describe('readConfig', () => {
  it('returns the URL and publishable key', () => {
    expect(readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })).toEqual({
      url: 'https://x.supabase.co',
      key: 'sb_publishable_abc',
    });
  });

  it('fails loudly, naming what is missing and where to put it', () => {
    expect(() => readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toThrow(ConfigError);
    expect(() => readConfig({})).toThrow(/VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.*\.env\.local/s);
  });
});
```

`src/data/rowMapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ShelfRecord } from './schema';
import { RowError, ratingFromRow, ratingToRow, recordFromRow, recordToRow } from './rowMapping';

const record: ShelfRecord = {
  id: '00000000-0000-4000-8000-000000000001', shelfId: '00000000-0000-4000-8000-0000000000aa', status: 'owned',
  wantsUpgrade: false, upgradeNote: null, artist: 'Ahmad Jamal Trio', title: 'At the Pershing', label: 'Argo',
  catalog: 'LP-628', year: 1958, format: 'Mono', genre: 'jazz', discGrade: 'G', sleeveGrade: null, pricePaid: null,
  nmEstimateLow: 12, nmEstimateHigh: 32, valueNote: null, notes: null, discogsReleaseId: null, coverPath: null,
  boughtAt: null, addedBy: '00000000-0000-4000-8000-0000000000bb', createdAt: '2025-09-17T00:00:00.000Z',
  updatedAt: '2025-09-17T00:00:00.000Z', deletedAt: null, importKey: 'ahmad-jamal-pershing',
};

describe('record rows', () => {
  it('round-trips through snake_case', () => {
    const row = recordToRow(record);
    expect(row).toMatchObject({ shelf_id: record.shelfId, nm_estimate_low: 12, import_key: 'ahmad-jamal-pershing', added_by: record.addedBy });
    expect(recordFromRow(row)).toEqual(record);
  });

  it('accepts numbers that arrive as strings', () => {
    const row = { ...recordToRow(record), nm_estimate_low: '12.00', nm_estimate_high: '32', price_paid: null };
    expect(recordFromRow(row).nmEstimateLow).toBe(12);
  });

  it('fails loudly on a row it does not understand, naming the record and field', () => {
    const row = { ...recordToRow(record), genre: 'polka' };
    expect(() => recordFromRow(row)).toThrow(RowError);
    expect(() => recordFromRow(row)).toThrow(/00000000-0000-4000-8000-000000000001: genre/);
  });
});

describe('rating rows', () => {
  it('round-trips', () => {
    const rating = { recordId: record.id, userId: record.addedBy, value: 4, updatedAt: '2025-09-17T00:00:00.000Z' };
    expect(ratingToRow(rating)).toEqual({ record_id: record.id, user_id: record.addedBy, value: 4, updated_at: rating.updatedAt });
    expect(ratingFromRow(ratingToRow(rating))).toEqual(rating);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/data/supabase.test.ts src/data/rowMapping.test.ts`
Expected: FAIL, cannot resolve `./supabase` and `./rowMapping`.

- [ ] **Step 4: Implement**

`src/env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`.env.example`:

```bash
# Copy to .env.local (never committed) and fill in from Supabase → Project Settings → API Keys.
VITE_SUPABASE_URL=https://rlhhrzkaosngafcoxaas.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=
# Only for scripts/import-collection.ts on your Mac. Never in Vercel, never in the app.
SUPABASE_SECRET_KEY=
```

`src/data/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function readConfig(env: Record<string, string | undefined>): { url: string; key: string } {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const missing = [!url && 'VITE_SUPABASE_URL', !key && 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
  if (missing.length > 0 || !url || !key) {
    throw new ConfigError(`Missing ${missing.join(' and ')}. Add them to .env.local on your Mac, and to Vercel → Settings → Environment Variables.`);
  }
  return { url, key };
}

let client: SupabaseClient | null = null;

/** The one Supabase client. Screens never call this; only src/data/supabaseBackend.ts does. */
export function supabase(): SupabaseClient {
  if (!client) {
    const { url, key } = readConfig(import.meta.env as Record<string, string | undefined>);
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }
  return client;
}
```

`src/data/rowMapping.ts`:

```ts
import { RatingSchema, RecordSchema, type Rating, type ShelfRecord } from './schema';

export type RecordRow = {
  id: string;
  shelf_id: string;
  status: ShelfRecord['status'];
  wants_upgrade: boolean;
  upgrade_note: string | null;
  artist: string;
  title: string;
  label: string | null;
  catalog: string | null;
  year: number | null;
  format: string | null;
  genre: ShelfRecord['genre'];
  disc_grade: ShelfRecord['discGrade'];
  sleeve_grade: ShelfRecord['sleeveGrade'];
  price_paid: number | null;
  nm_estimate_low: number | null;
  nm_estimate_high: number | null;
  value_note: string | null;
  notes: string | null;
  discogs_release_id: number | null;
  cover_path: string | null;
  bought_at: string | null;
  added_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  import_key: string | null;
};

export type RatingRow = { record_id: string; user_id: string; value: number; updated_at: string };

export class RowError extends Error {
  constructor(public problems: string[]) {
    super(`The shelf sent data this app doesn’t understand:\n${problems.join('\n')}`);
    this.name = 'RowError';
  }
}

/** Postgres numeric can arrive as a string; everything else passes through for the schema to judge. */
function num(v: unknown): unknown {
  return typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
}

export function recordToRow(r: ShelfRecord): RecordRow {
  return {
    id: r.id,
    shelf_id: r.shelfId,
    status: r.status,
    wants_upgrade: r.wantsUpgrade,
    upgrade_note: r.upgradeNote,
    artist: r.artist,
    title: r.title,
    label: r.label,
    catalog: r.catalog,
    year: r.year,
    format: r.format,
    genre: r.genre,
    disc_grade: r.discGrade,
    sleeve_grade: r.sleeveGrade,
    price_paid: r.pricePaid,
    nm_estimate_low: r.nmEstimateLow,
    nm_estimate_high: r.nmEstimateHigh,
    value_note: r.valueNote,
    notes: r.notes,
    discogs_release_id: r.discogsReleaseId,
    cover_path: r.coverPath,
    bought_at: r.boughtAt,
    added_by: r.addedBy,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    deleted_at: r.deletedAt,
    import_key: r.importKey,
  };
}

export function recordFromRow(row: Record<string, unknown>): ShelfRecord {
  const parsed = RecordSchema.safeParse({
    id: row.id,
    shelfId: row.shelf_id,
    status: row.status,
    wantsUpgrade: row.wants_upgrade,
    upgradeNote: row.upgrade_note,
    artist: row.artist,
    title: row.title,
    label: row.label,
    catalog: row.catalog,
    year: num(row.year),
    format: row.format,
    genre: row.genre,
    discGrade: row.disc_grade,
    sleeveGrade: row.sleeve_grade,
    pricePaid: num(row.price_paid),
    nmEstimateLow: num(row.nm_estimate_low),
    nmEstimateHigh: num(row.nm_estimate_high),
    valueNote: row.value_note,
    notes: row.notes,
    discogsReleaseId: num(row.discogs_release_id),
    coverPath: row.cover_path,
    boughtAt: row.bought_at,
    addedBy: row.added_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    importKey: row.import_key,
  });
  if (!parsed.success) {
    const name = typeof row.id === 'string' ? row.id : 'record';
    throw new RowError(parsed.error.issues.map((i) => `${name}: ${i.path.join('.') || '(record)'} ${i.message}`));
  }
  return parsed.data;
}

export function ratingToRow(r: Rating): RatingRow {
  return { record_id: r.recordId, user_id: r.userId, value: r.value, updated_at: r.updatedAt };
}

export function ratingFromRow(row: Record<string, unknown>): Rating {
  const parsed = RatingSchema.safeParse({ recordId: row.record_id, userId: row.user_id, value: num(row.value), updatedAt: row.updated_at });
  if (!parsed.success) {
    throw new RowError(parsed.error.issues.map((i) => `rating ${String(row.record_id)}: ${i.path.join('.')} ${i.message}`));
  }
  return parsed.data;
}
```

- [ ] **Step 5: Run to verify they pass, then the full suite**

Run: `npx vitest run src/data && npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add the Supabase client config and database row mapping

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: Database schema and row-level security, tested in PGlite

**Files:**
- Create: `supabase/config.toml` (via `npx supabase init`), `supabase/migrations/20260919120000_shelf.sql`, `supabase/tests/harness.ts`
- Test: `supabase/tests/rls.test.ts`

**Interfaces:**
- Produces (SQL): types `genre`, `grade`, `record_status`, `member_role`; tables `profiles`, `shelves`, `shelf_members`, `shelf_invites`, `records`, `ratings`; helper functions `is_member(uuid)`, `is_owner(uuid)`, `shares_shelf_with(uuid)`, `record_is_visible(uuid)`.
- Produces (tests): `freshDb(): Promise<PGlite>` (stand-in auth + every migration applied), `addUser(db, email): Promise<{ id: string; email: string }>`, `asUser<T>(db, user | null, fn: () => Promise<T>): Promise<T>` (null = signed out).

Note: `supabase/tests/*.ts` run under Vitest but are not part of `tsc -b` (they use Node APIs); Vitest still strips their types.

- [ ] **Step 1: Install and initialise**

```bash
npm install -D @electric-sql/pglite
npx supabase init
```

If `supabase init` asks about VS Code or IntelliJ settings, answer **N** to both. Expected: `supabase/config.toml` exists. Add to `.gitignore`: `supabase/.temp/` and `supabase/.branches/`.

- [ ] **Step 2: Write the test harness**

`supabase/tests/harness.ts`:

```ts
// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/** Just enough of Supabase's auth schema and roles for our policies to run. Real Supabase provides these. */
const AUTH_STANDIN = `
  create schema auth;
  create table auth.users (id uuid primary key, email text not null);
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`;

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STANDIN);
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  return db;
}

export async function addUser(db: PGlite, email: string): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  return { id, email };
}

/** Run fn as a signed-in person (or signed out, with null), the way PostgREST would. */
export async function asUser<T>(db: PGlite, user: { id: string; email: string } | null, fn: () => Promise<T>): Promise<T> {
  const claims = user ? JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' }) : '';
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
```

- [ ] **Step 3: Write the failing RLS tests**

`supabase/tests/rls.test.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify they fail**

Run: `npx vitest run supabase/tests/rls.test.ts`
Expected: FAIL (the migrations folder has no SQL yet, so `public.profiles` doesn't exist). If instead PGlite itself errors on `create role` or `set role`, stop and report BLOCKED with the output: the whole testing approach depends on it.

- [ ] **Step 5: Write the migration**

`supabase/migrations/20260919120000_shelf.sql`:

```sql
-- The Shelf: people, shelves, members, invites, records and ratings.
-- Picture: the shelf is a house, members hold keys, records sit on it, ratings are one sticky note per person.
-- Row-level security is on for every table; the app's rules and these rules are two locks on the same door.

create type public.genre as enum ('jazz', 'rock', 'popsoul', 'popularpop', 'misc', 'country', 'reggae', 'soundtracks', 'christmas');
create type public.grade as enum ('Sealed', 'M', 'NM', 'VG+', 'VG', 'G+', 'G', 'P');
create type public.record_status as enum ('wanted', 'new_arrival', 'owned');
create type public.member_role as enum ('owner', 'member');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now()
);

create table public.shelves (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.shelf_members (
  shelf_id uuid not null references public.shelves (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (shelf_id, user_id)
);

create table public.shelf_invites (
  id uuid primary key default gen_random_uuid(),
  shelf_id uuid not null references public.shelves (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  invited_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (shelf_id, email)
);

create table public.records (
  id uuid primary key,
  shelf_id uuid not null references public.shelves (id) on delete cascade,
  status public.record_status not null,
  wants_upgrade boolean not null default false,
  upgrade_note text,
  artist text not null check (length(trim(artist)) > 0),
  title text not null check (length(trim(title)) > 0),
  label text,
  catalog text,
  year smallint check (year between 1900 and 2100),
  format text,
  genre public.genre not null,
  disc_grade public.grade,
  sleeve_grade public.grade,
  price_paid numeric(8, 2) check (price_paid >= 0),
  nm_estimate_low numeric(8, 2) check (nm_estimate_low >= 0),
  nm_estimate_high numeric(8, 2) check (nm_estimate_high >= 0),
  value_note text,
  notes text,
  discogs_release_id integer check (discogs_release_id > 0),
  cover_path text,
  bought_at timestamptz,
  added_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  import_key text,
  unique (shelf_id, import_key),
  check ((nm_estimate_low is null) = (nm_estimate_high is null)),
  check (nm_estimate_low is null or nm_estimate_low <= nm_estimate_high)
);
create index records_shelf_updated on public.records (shelf_id, updated_at);

create table public.ratings (
  record_id uuid not null references public.records (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value smallint not null check (value between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (record_id, user_id)
);
create index ratings_user on public.ratings (user_id);

-- Every change moves updated_at, which is how phones know what to pull.
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger records_touch before update on public.records for each row execute function public.touch_updated_at();
create trigger ratings_touch before update on public.ratings for each row execute function public.touch_updated_at();

-- Helpers run with the owner's rights so policies don't loop through shelf_members' own policy.
create function public.is_member(p_shelf uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shelf_members m where m.shelf_id = p_shelf and m.user_id = auth.uid())
$$;
create function public.is_owner(p_shelf uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shelf_members m where m.shelf_id = p_shelf and m.user_id = auth.uid() and m.role = 'owner')
$$;
create function public.shares_shelf_with(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shelf_members a join public.shelf_members b on a.shelf_id = b.shelf_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;
create function public.record_is_visible(p_record uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.records r join public.shelf_members m on m.shelf_id = r.shelf_id
    where r.id = p_record and m.user_id = auth.uid()
  )
$$;

alter table public.profiles enable row level security;
alter table public.shelves enable row level security;
alter table public.shelf_members enable row level security;
alter table public.shelf_invites enable row level security;
alter table public.records enable row level security;
alter table public.ratings enable row level security;

create policy "see yourself and shelf-mates" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_shelf_with(id));
create policy "rename yourself" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members see their shelves" on public.shelves for select to authenticated using (public.is_member(id));
create policy "owners rename shelves" on public.shelves for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

create policy "members see who is on the shelf" on public.shelf_members for select to authenticated using (public.is_member(shelf_id));
create policy "owners remove other members" on public.shelf_members for delete to authenticated
  using (public.is_owner(shelf_id) and user_id <> auth.uid());

create policy "members see invites" on public.shelf_invites for select to authenticated using (public.is_member(shelf_id));
create policy "owners invite" on public.shelf_invites for insert to authenticated
  with check (public.is_owner(shelf_id) and invited_by = auth.uid());
create policy "owners cancel invites" on public.shelf_invites for delete to authenticated using (public.is_owner(shelf_id));

create policy "members see records" on public.records for select to authenticated using (public.is_member(shelf_id));
create policy "members add records" on public.records for insert to authenticated
  with check (public.is_member(shelf_id) and added_by = auth.uid());
create policy "members edit records" on public.records for update to authenticated
  using (public.is_member(shelf_id)) with check (public.is_member(shelf_id));

create policy "members see ratings" on public.ratings for select to authenticated using (public.record_is_visible(record_id));
create policy "rate for yourself" on public.ratings for insert to authenticated
  with check (user_id = auth.uid() and public.record_is_visible(record_id));
create policy "change your own rating" on public.ratings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.record_is_visible(record_id));
create policy "remove your own rating" on public.ratings for delete to authenticated using (user_id = auth.uid());

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on function public.is_member(uuid), public.is_owner(uuid), public.shares_shelf_with(uuid), public.record_is_visible(uuid) from public, anon;
grant execute on function public.is_member(uuid), public.is_owner(uuid), public.shares_shelf_with(uuid), public.record_is_visible(uuid) to authenticated;
```

- [ ] **Step 6: Run to verify they pass, then the full suite**

Run: `npx vitest run supabase/tests && npm test && npm run typecheck`
Expected: all pass, no warnings.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add the shared-shelf database with row-level security, tested in PGlite

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: `bootstrap()` and `ping()`

**Files:**
- Create: `supabase/migrations/20260919120100_bootstrap.sql`
- Test: `supabase/tests/bootstrap.test.ts`

**Interfaces:**
- Consumes: the Task 2 schema and test harness (`freshDb`, `addUser`, `asUser`)
- Produces (SQL):
  - `public.bootstrap(p_display_name text default null) returns uuid`: callable by signed-in people only. Ensures the profile (new name if given, otherwise keeps the old one, otherwise the email's part before `@`), accepts every open invite for the caller's email (and deletes the caller's own shelves that are empty and unshared once they join another), creates a shelf named "The Shelf" if they have none, and returns the shelf they joined most recently.
  - `public.ping() returns boolean`: returns true; callable while signed out (for the keep-awake job).

- [ ] **Step 1: Write the failing tests**

`supabase/tests/bootstrap.test.ts`:

```ts
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
    expect(await bootstrap(megan)).toBe(shelf);
    expect((await db.query('select * from public.shelves where id = $1', [own])).rows).toHaveLength(1);
  });

  it('refuses when nobody is signed in', async () => {
    await expect(asUser(db, null, () => db.query('select public.bootstrap(null)'))).rejects.toThrow(/permission denied|Not signed in/);
  });
});

describe('ping', () => {
  it('answers even when signed out, so the keep-awake job can call it', async () => {
    const result = await asUser(db, null, () => db.query<{ ping: boolean }>('select public.ping() as ping'));
    expect(result.rows[0].ping).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run supabase/tests/bootstrap.test.ts`
Expected: FAIL, `function public.bootstrap(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260919120100_bootstrap.sql`:

```sql
-- bootstrap(): runs on every sign-in and app open. Sets the person up and tells the app which shelf is theirs.
create function public.bootstrap(p_display_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(auth.jwt() ->> 'email'));
  v_name text := nullif(trim(coalesce(p_display_name, '')), '');
  v_shelf uuid;
  v_invite record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, coalesce(v_name, nullif(split_part(v_email, '@', 1), ''), 'Me'))
  on conflict (id) do update set display_name = coalesce(v_name, public.profiles.display_name);

  for v_invite in
    select i.id, i.shelf_id from public.shelf_invites i where i.email = v_email and i.accepted_at is null
  loop
    insert into public.shelf_members (shelf_id, user_id, role) values (v_invite.shelf_id, v_uid, 'member')
    on conflict (shelf_id, user_id) do nothing;
    update public.shelf_invites set accepted_at = now() where id = v_invite.id;

    -- One shelf per person for now: drop their own shelves that are empty and unshared.
    delete from public.shelves s
    where s.created_by = v_uid
      and s.id <> v_invite.shelf_id
      and not exists (select 1 from public.records r where r.shelf_id = s.id)
      and (select count(*) from public.shelf_members m where m.shelf_id = s.id) = 1;
  end loop;

  select m.shelf_id into v_shelf
  from public.shelf_members m where m.user_id = v_uid
  order by m.created_at desc limit 1;

  if v_shelf is null then
    insert into public.shelves (name, created_by) values ('The Shelf', v_uid) returning id into v_shelf;
    insert into public.shelf_members (shelf_id, user_id, role) values (v_shelf, v_uid, 'owner');
  end if;

  return v_shelf;
end $$;

revoke all on function public.bootstrap(text) from public, anon;
grant execute on function public.bootstrap(text) to authenticated;

-- ping(): the keep-awake job calls this every few days so the free project never pauses.
create function public.ping() returns boolean language sql stable set search_path = '' as $$ select true $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
```

- [ ] **Step 4: Run to verify they pass, then the full suite**

Run: `npx vitest run supabase/tests && npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add bootstrap() to set people up and accept invites, and ping() for keep-awake

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: The `Backend` interface, its Supabase version and an in-memory fake

**Files:**
- Create: `src/data/backend.ts`, `src/data/supabaseBackend.ts`, `src/test/fakeBackend.ts`
- Test: `src/test/fakeBackend.test.ts`

**Interfaces:**
- Consumes: `supabase()` (Task 1), `RecordRow`, `RatingRow`, `recordToRow`, `ratingToRow` (Task 1), `importCollection` (Plan 1)
- Produces:
  - `type SignedIn = { userId: string; email: string }`
  - `type Member = { shelfId: string; userId: string; role: 'owner' | 'member'; displayName: string }`
  - `type Invite = { email: string; acceptedAt: string | null }`
  - `interface ShelfSource { recordsSince(shelfId: string, since: string | null): Promise<Record<string, unknown>[]>; ratings(shelfId: string): Promise<Record<string, unknown>[]>; members(shelfId: string): Promise<Member[]> }`
  - `interface Backend extends ShelfSource { currentUser(): Promise<SignedIn | null>; sendCode(email: string): Promise<void>; verifyCode(email: string, code: string): Promise<SignedIn>; hasProfile(userId: string): Promise<boolean>; bootstrap(displayName: string | null): Promise<string>; invites(shelfId: string): Promise<Invite[]>; invite(shelfId: string, email: string, invitedBy: string): Promise<void>; signOut(): Promise<void> }`
  - `class BackendError extends Error` (message is written for the person holding the phone)
  - `supabaseBackend(client?: SupabaseClient): Backend`
  - Test-only: `class FakeBackend implements Backend` with public `online: boolean`, `signedIn: SignedIn | null`, `sentCodesTo: string[]`; constructor options `{ users?: Record<string, string> /* email → userId */; profiles?: Record<string, string> /* userId → name */; shelfFor?: Record<string, string> /* userId → shelfId */; records?: RecordRow[]; ratings?: RatingRow[]; members?: Member[]; signedIn?: SignedIn | null }`; the only valid code is `123456`. `collectionRows(shelfId: string, userId: string): { records: RecordRow[]; ratings: RatingRow[] }` builds rows from the real `collection.json`.

- [ ] **Step 1: Write the failing test (the fake is the contract the app tests will lean on)**

`src/test/fakeBackend.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/fakeBackend.test.ts`
Expected: FAIL, cannot resolve `@/data/backend`.

- [ ] **Step 3: Implement**

`src/data/backend.ts`:

```ts
/** Everything the app needs from the server. Screens use this, never Supabase directly. */
export type SignedIn = { userId: string; email: string };
export type Member = { shelfId: string; userId: string; role: 'owner' | 'member'; displayName: string };
export type Invite = { email: string; acceptedAt: string | null };

export interface ShelfSource {
  /** Raw record rows for a shelf, only those changed after `since` (all of them when null), oldest change first. */
  recordsSince(shelfId: string, since: string | null): Promise<Record<string, unknown>[]>;
  /** Every rating on the shelf, as raw rows. */
  ratings(shelfId: string): Promise<Record<string, unknown>[]>;
  members(shelfId: string): Promise<Member[]>;
}

export interface Backend extends ShelfSource {
  currentUser(): Promise<SignedIn | null>;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<SignedIn>;
  hasProfile(userId: string): Promise<boolean>;
  /** Sets the signed-in person up (see the bootstrap() migration) and returns their shelf id. */
  bootstrap(displayName: string | null): Promise<string>;
  invites(shelfId: string): Promise<Invite[]>;
  invite(shelfId: string, email: string, invitedBy: string): Promise<void>;
  signOut(): Promise<void>;
}

/** A failure worth showing to the person holding the phone; the message says what to do. */
export class BackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendError';
  }
}

export const NO_SIGNAL = 'No signal. Try again when you’re back online.';
```

`src/data/supabaseBackend.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendError, NO_SIGNAL, type Backend, type Invite, type Member, type SignedIn } from './backend';
import { supabase } from './supabase';

const PAGE = 1000;

function fail(action: string, error: { message: string; code?: string } | null): never {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  throw new BackendError(offline || /fetch|network/i.test(error?.message ?? '') ? NO_SIGNAL : `${action}: ${error?.message ?? 'unknown error'}`);
}

export function supabaseBackend(client: SupabaseClient = supabase()): Backend {
  return {
    async currentUser(): Promise<SignedIn | null> {
      const { data } = await client.auth.getSession();
      const user = data.session?.user;
      return user ? { userId: user.id, email: user.email ?? '' } : null;
    },

    async sendCode(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) fail('Couldn’t send a code', error);
    },

    async verifyCode(email, code) {
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) {
        if (error.code === 'otp_expired' || /expired/i.test(error.message)) throw new BackendError('That code expired. Send a new one.');
        if (/fetch|network/i.test(error.message)) throw new BackendError(NO_SIGNAL);
        throw new BackendError('That code didn’t work. Check it, or send a new one.');
      }
      const user = data.user ?? data.session?.user;
      if (!user) throw new BackendError('Signed in, but no account came back. Try again.');
      return { userId: user.id, email: user.email ?? email };
    },

    async hasProfile(userId) {
      const { data, error } = await client.from('profiles').select('id').eq('id', userId).maybeSingle();
      if (error) fail('Couldn’t check your profile', error);
      return data !== null;
    },

    async bootstrap(displayName) {
      const { data, error } = await client.rpc('bootstrap', { p_display_name: displayName });
      if (error) fail('Couldn’t open your shelf', error);
      if (typeof data !== 'string') throw new BackendError('Couldn’t open your shelf: no shelf came back.');
      return data;
    },

    async recordsSince(shelfId, since) {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        let query = client.from('records').select('*').eq('shelf_id', shelfId);
        if (since) query = query.gt('updated_at', since);
        const { data, error } = await query.order('updated_at').range(from, from + PAGE - 1);
        if (error) fail('Couldn’t fetch records', error);
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < PAGE) return rows;
      }
    },

    async ratings(shelfId) {
      const { data, error } = await client
        .from('ratings')
        .select('record_id, user_id, value, updated_at, records!inner(shelf_id)')
        .eq('records.shelf_id', shelfId);
      if (error) fail('Couldn’t fetch ratings', error);
      return (data as Record<string, unknown>[]).map(({ records: _shelf, ...rating }) => rating);
    },

    async members(shelfId): Promise<Member[]> {
      const { data, error } = await client.from('shelf_members').select('user_id, role, profiles(display_name)').eq('shelf_id', shelfId);
      if (error) fail('Couldn’t fetch who’s on the shelf', error);
      const rows = data as unknown as { user_id: string; role: 'owner' | 'member'; profiles: { display_name: string } | null }[];
      return rows.map((m) => ({ shelfId, userId: m.user_id, role: m.role, displayName: m.profiles?.display_name ?? 'Someone' }));
    },

    async invites(shelfId): Promise<Invite[]> {
      const { data, error } = await client.from('shelf_invites').select('email, accepted_at').eq('shelf_id', shelfId).order('created_at');
      if (error) fail('Couldn’t fetch invites', error);
      return (data as { email: string; accepted_at: string | null }[]).map((i) => ({ email: i.email, acceptedAt: i.accepted_at }));
    },

    async invite(shelfId, email, invitedBy) {
      const clean = email.trim().toLowerCase();
      const { error } = await client.from('shelf_invites').insert({ shelf_id: shelfId, email: clean, invited_by: invitedBy });
      if (error?.code === '23505') throw new BackendError('That email is already invited.');
      if (error) fail('Couldn’t send the invite', error);
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) fail('Couldn’t sign out', error);
    },
  };
}
```

`src/test/fakeBackend.ts`:

```ts
import collection from '../../collection.json';
import { BackendError, NO_SIGNAL, type Backend, type Invite, type Member, type SignedIn } from '@/data/backend';
import { importCollection } from '@/data/importCollection';
import { ratingToRow, recordToRow, type RatingRow, type RecordRow } from '@/data/rowMapping';

type Options = {
  users?: Record<string, string>;
  profiles?: Record<string, string>;
  shelfFor?: Record<string, string>;
  records?: RecordRow[];
  ratings?: RatingRow[];
  members?: Member[];
  signedIn?: SignedIn | null;
};

/** An in-memory stand-in for Supabase. The only code that works is 123456. */
export class FakeBackend implements Backend {
  online = true;
  signedIn: SignedIn | null;
  sentCodesTo: string[] = [];
  private users: Record<string, string>;
  private profiles: Record<string, string>;
  private shelfFor: Record<string, string>;
  private recordRows: RecordRow[];
  private ratingRows: RatingRow[];
  private memberList: Member[];
  private inviteList: (Invite & { shelfId: string })[] = [];

  constructor(o: Options) {
    this.users = { ...o.users };
    this.profiles = { ...o.profiles };
    this.shelfFor = { ...o.shelfFor };
    this.recordRows = [...(o.records ?? [])];
    this.ratingRows = [...(o.ratings ?? [])];
    this.memberList = [...(o.members ?? [])];
    this.signedIn = o.signedIn ?? null;
  }

  private guard() {
    if (!this.online) throw new BackendError(NO_SIGNAL);
  }

  async currentUser() {
    return this.signedIn;
  }

  async sendCode(email: string) {
    this.guard();
    this.sentCodesTo.push(email);
  }

  async verifyCode(email: string, code: string) {
    this.guard();
    if (code !== '123456') throw new BackendError('That code didn’t work. Check it, or send a new one.');
    const userId = this.users[email] ?? crypto.randomUUID();
    this.users[email] = userId;
    this.signedIn = { userId, email };
    return this.signedIn;
  }

  async hasProfile(userId: string) {
    this.guard();
    return userId in this.profiles;
  }

  async bootstrap(displayName: string | null) {
    this.guard();
    const me = this.signedIn;
    if (!me) throw new BackendError('Not signed in');
    this.profiles[me.userId] = displayName ?? this.profiles[me.userId] ?? me.email.split('@')[0];
    let shelf = this.shelfFor[me.userId];
    if (!shelf) {
      shelf = crypto.randomUUID();
      this.shelfFor[me.userId] = shelf;
    }
    const mine = this.memberList.find((m) => m.shelfId === shelf && m.userId === me.userId);
    if (mine) mine.displayName = this.profiles[me.userId];
    else this.memberList.push({ shelfId: shelf, userId: me.userId, role: 'owner', displayName: this.profiles[me.userId] });
    return shelf;
  }

  async recordsSince(shelfId: string, since: string | null) {
    this.guard();
    return this.recordRows
      .filter((r) => r.shelf_id === shelfId && (since === null || r.updated_at > since))
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at)) as unknown as Record<string, unknown>[];
  }

  async ratings(shelfId: string) {
    this.guard();
    const ids = new Set(this.recordRows.filter((r) => r.shelf_id === shelfId).map((r) => r.id));
    return this.ratingRows.filter((r) => ids.has(r.record_id)) as unknown as Record<string, unknown>[];
  }

  async members(shelfId: string) {
    this.guard();
    return this.memberList.filter((m) => m.shelfId === shelfId).map((m) => ({ ...m }));
  }

  async invites(shelfId: string) {
    this.guard();
    return this.inviteList.filter((i) => i.shelfId === shelfId).map(({ email, acceptedAt }) => ({ email, acceptedAt }));
  }

  async invite(shelfId: string, email: string) {
    this.guard();
    const clean = email.trim().toLowerCase();
    if (this.inviteList.some((i) => i.shelfId === shelfId && i.email === clean)) throw new BackendError('That email is already invited.');
    this.inviteList.push({ shelfId, email: clean, acceptedAt: null });
  }

  async signOut() {
    this.signedIn = null;
  }

  /** Test helper: change a record on the "server" as if another phone had. */
  touchRecord(id: string, change: Partial<RecordRow>) {
    const row = this.recordRows.find((r) => r.id === id);
    if (!row) throw new Error(`No record ${id}`);
    Object.assign(row, change, { updated_at: new Date().toISOString() });
  }

  /** Test helper: remove a rating on the "server". */
  dropRating(recordId: string, userId: string) {
    this.ratingRows = this.ratingRows.filter((r) => !(r.record_id === recordId && r.user_id === userId));
  }
}

export function collectionRows(shelfId: string, userId: string): { records: RecordRow[]; ratings: RatingRow[] } {
  const { records, ratings } = importCollection(collection, { shelfId, userId, newId: () => crypto.randomUUID() });
  return { records: records.map(recordToRow), ratings: ratings.map(ratingToRow) };
}
```

- [ ] **Step 4: Run to verify it passes, then the full suite**

Run: `npx vitest run src/test/fakeBackend.test.ts && npm test && npm run typecheck`
Expected: all pass. (`supabaseBackend.ts` has no unit test: it is thin glue over supabase-js and is exercised on real phones in Task 9. It must typecheck.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add the Backend interface with a Supabase version and an in-memory fake

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: The phone's notebook v2 and pull sync

**Files:**
- Modify: `src/data/db.ts` (add version 2), `src/data/hooks.ts` (add `useMembers`)
- Create: `src/data/sync.ts`, `src/data/useSync.ts`
- Test: `src/data/sync.test.ts`, `src/data/db.test.ts`

**Interfaces:**
- Consumes: `ShelfSource`, `Member` (Task 4), `recordFromRow`, `ratingFromRow`, `RowError` (Task 1), `FakeBackend`, `collectionRows` (Task 4, tests only)
- Produces:
  - `ShelfDB` gains `members: Table<Member, [string, string]>` and `meta: EntityTable<{ key: string; value: string }, 'key'>`; version 2 clears Plan 1's local-only records and ratings.
  - `clearPhone(db: ShelfDB): Promise<void>` (empties every table)
  - `pullShelf(db: ShelfDB, source: ShelfSource, shelfId: string): Promise<void>`
  - `type SyncStatus = { lastSyncedAt: string | null; error: string | null }`, `useSync(source: ShelfSource, shelfId: string, database?: ShelfDB): SyncStatus`
  - `useMembers(shelfId: string): Member[] | undefined`

- [ ] **Step 1: Write the failing tests**

`src/data/db.test.ts`:

```ts
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
```

`src/data/sync.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeBackend, collectionRows } from '@/test/fakeBackend';
import { ShelfDB } from './db';
import { RowError, type RecordRow } from './rowMapping';
import { pullShelf } from './sync';

const K = '11111111-1111-4111-8111-111111111111';
const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db: ShelfDB;
let backend: FakeBackend;
let rows: { records: RecordRow[]; ratings: ReturnType<typeof collectionRows>['ratings'] };

beforeEach(() => {
  db = new ShelfDB(`sync-${crypto.randomUUID()}`);
  rows = collectionRows(SHELF, K);
  backend = new FakeBackend({
    records: rows.records,
    ratings: rows.ratings,
    members: [{ shelfId: SHELF, userId: K, role: 'owner', displayName: 'Kahrman' }],
  });
});

afterEach(async () => {
  await db.delete();
});

describe('pullShelf', () => {
  it('fills an empty phone with the shelf, its ratings and its people', async () => {
    await pullShelf(db, backend, SHELF);
    expect(await db.records.count()).toBe(11);
    expect(await db.ratings.count()).toBe(6);
    expect(await db.members.toArray()).toEqual([{ shelfId: SHELF, userId: K, role: 'owner', displayName: 'Kahrman' }]);
  });

  it('picks up a change made on another phone', async () => {
    await pullShelf(db, backend, SHELF);
    const pershing = rows.records.find((r) => r.import_key === 'ahmad-jamal-pershing')!;
    backend.touchRecord(pershing.id, { notes: 'Megan says play side B first' });
    await pullShelf(db, backend, SHELF);
    expect((await db.records.get(pershing.id))?.notes).toBe('Megan says play side B first');
  });

  it('drops a rating that was removed on the server', async () => {
    await pullShelf(db, backend, SHELF);
    const rated = rows.ratings[0];
    backend.dropRating(rated.record_id, rated.user_id);
    await pullShelf(db, backend, SHELF);
    expect(await db.ratings.count()).toBe(5);
  });

  it('keeps soft-deleted records so every phone learns about the delete', async () => {
    await pullShelf(db, backend, SHELF);
    const gone = rows.records[0];
    backend.touchRecord(gone.id, { deleted_at: new Date().toISOString() });
    await pullShelf(db, backend, SHELF);
    expect((await db.records.get(gone.id))?.deletedAt).not.toBeNull();
  });

  it('writes nothing when the server sends a row it doesn’t understand', async () => {
    const bad = new FakeBackend({ records: [{ ...rows.records[0], genre: 'polka' as RecordRow['genre'] }], ratings: [], members: [] });
    await expect(pullShelf(db, bad, SHELF)).rejects.toBeInstanceOf(RowError);
    expect(await db.records.count()).toBe(0);
  });

  it('keeps what is on the phone when there is no signal', async () => {
    await pullShelf(db, backend, SHELF);
    backend.online = false;
    await expect(pullShelf(db, backend, SHELF)).rejects.toThrow('No signal');
    expect(await db.records.count()).toBe(11);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/data/db.test.ts src/data/sync.test.ts`
Expected: FAIL (`clearPhone` and `./sync` don't exist; `db.meta` undefined).

- [ ] **Step 3: Implement**

Replace `src/data/db.ts`:

```ts
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Member } from './backend';
import type { Rating, ShelfRecord } from './schema';

export type Meta = { key: string; value: string };

/** The notebook on the phone. Every screen reads from here; sync fills it from Supabase. */
export class ShelfDB extends Dexie {
  records!: EntityTable<ShelfRecord, 'id'>;
  ratings!: Table<Rating, [string, string]>;
  members!: Table<Member, [string, string]>;
  meta!: EntityTable<Meta, 'key'>;

  constructor(name = 'the-shelf') {
    super(name);
    this.version(1).stores({
      records: 'id, shelfId, status, genre, &importKey',
      ratings: '[recordId+userId], recordId, userId',
    });
    this.version(2)
      .stores({
        records: 'id, shelfId, status, genre, importKey',
        ratings: '[recordId+userId], recordId, userId',
        members: '[shelfId+userId], shelfId',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        // Plan 1 kept a phone-only copy seeded from collection.json. The shelf now lives in Supabase.
        await tx.table('records').clear();
        await tx.table('ratings').clear();
      });
  }
}

export const db = new ShelfDB();

/** Empty the notebook: used on sign-out and when a different person signs in. */
export async function clearPhone(database: ShelfDB): Promise<void> {
  await database.transaction('rw', [database.records, database.ratings, database.members, database.meta], async () => {
    await Promise.all([database.records.clear(), database.ratings.clear(), database.members.clear(), database.meta.clear()]);
  });
}
```

`src/data/sync.ts`:

```ts
import type { ShelfSource } from './backend';
import type { ShelfDB } from './db';
import { ratingFromRow, recordFromRow } from './rowMapping';

/** Re-ask for the last five minutes each time, so a change committed a moment late isn't missed. */
const OVERLAP_MS = 5 * 60 * 1000;

const lastPulledKey = (shelfId: string) => `lastPulledAt:${shelfId}`;

/**
 * The courier's pickup run: fetch what changed on the shelf since last time, plus every rating and member,
 * check it all, then write it in one go. If anything fails, the phone keeps what it had.
 */
export async function pullShelf(db: ShelfDB, source: ShelfSource, shelfId: string): Promise<void> {
  const last = (await db.meta.get(lastPulledKey(shelfId)))?.value ?? null;
  const since = last ? new Date(Date.parse(last) - OVERLAP_MS).toISOString() : null;

  const [recordRows, ratingRows, members] = await Promise.all([source.recordsSince(shelfId, since), source.ratings(shelfId), source.members(shelfId)]);
  const records = recordRows.map(recordFromRow);
  const ratings = ratingRows.map(ratingFromRow);
  const newest = records.reduce<string | null>((max, r) => (max === null || Date.parse(r.updatedAt) > Date.parse(max) ? r.updatedAt : max), last);

  await db.transaction('rw', [db.records, db.ratings, db.members, db.meta], async () => {
    await db.records.bulkPut(records);
    const onShelf = await db.records.where('shelfId').equals(shelfId).primaryKeys();
    await db.ratings.where('recordId').anyOf(onShelf).delete();
    await db.ratings.bulkPut(ratings);
    await db.members.where('shelfId').equals(shelfId).delete();
    await db.members.bulkPut(members);
    if (newest) await db.meta.put({ key: lastPulledKey(shelfId), value: newest });
  });
}
```

`src/data/useSync.ts`:

```ts
import { useEffect, useState } from 'react';
import type { ShelfSource } from './backend';
import { db as defaultDb, type ShelfDB } from './db';
import { pullShelf } from './sync';

export type SyncStatus = { lastSyncedAt: string | null; error: string | null };

const EVERY_MS = 60_000;

/** Pull the shelf on open, when signal comes back, when the app returns to the front, and every minute while visible. */
export function useSync(source: ShelfSource, shelfId: string, database: ShelfDB = defaultDb): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ lastSyncedAt: null, error: null });

  useEffect(() => {
    let live = true;
    let running = false;

    async function run() {
      if (running) return;
      running = true;
      try {
        await pullShelf(database, source, shelfId);
        if (live) setStatus({ lastSyncedAt: new Date().toISOString(), error: null });
      } catch (e) {
        if (live) setStatus((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      } finally {
        running = false;
      }
    }

    const whenVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const onOnline = () => void run();

    void run();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', whenVisible);
    const timer = window.setInterval(whenVisible, EVERY_MS);
    return () => {
      live = false;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', whenVisible);
      window.clearInterval(timer);
    };
  }, [source, shelfId, database]);

  return status;
}
```

In `src/data/hooks.ts`, add (keep the existing hooks as they are):

```ts
import type { Member } from './backend';

export function useMembers(shelfId: string): Member[] | undefined {
  return useLiveQuery(() => db.members.where('shelfId').equals(shelfId).toArray(), [shelfId]);
}
```

- [ ] **Step 4: Run to verify they pass, then the full suite**

Run: `npx vitest run src/data && npm test && npm run typecheck`
Expected: all pass. (Plan 1's `seed.test.ts` still passes here: version 2 keeps the `records` table; `importKey` is just no longer unique on the phone. Seeding is removed in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add the phone notebook v2 and a pull-only sync from the shared shelf

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Sign-in, the session, and the app on the shared shelf

**Files:**
- Create: `src/app/BackendContext.tsx`, `src/app/CurrentShelf.tsx`, `src/app/SyncContext.tsx`, `src/app/useSession.ts`, `src/screens/SignInScreen.tsx`, `src/screens/NameScreen.tsx`
- Modify: `src/app/App.tsx`, `src/main.tsx`, `src/screens/BootError.tsx`, `src/screens/ShelfScreen.tsx`, `src/screens/ShowScreen.tsx`, `src/data/schema.ts`
- Replace tests: `src/app/App.test.tsx`, `src/screens/BootError.test.tsx`; update `src/data/importCollection.test.ts`
- Delete: `src/app/useBoot.ts`, `src/data/seed.ts`, `src/data/seed.test.ts`, `src/data/session.ts`

**Interfaces:**
- Consumes: `Backend`, `SignedIn`, `BackendError` (Task 4), `supabaseBackend` (Task 4), `db`, `clearPhone`, `ShelfDB` (Task 5), `useSync`, `SyncStatus` (Task 5), `FakeBackend`, `collectionRows` (tests)
- Produces:
  - `BackendProvider({ backend, children })`, `useBackend(): Backend`
  - `type CurrentShelf = { shelfId: string; userId: string; email: string; signOut: () => Promise<void> }`, `CurrentShelfProvider({ value, children })`, `useCurrentShelf(): CurrentShelf`
  - `SyncProvider({ source, shelfId, children })`, `useSyncStatus(): SyncStatus`, `SyncNotice()` (renders "Couldn’t reach the shelf. Showing what’s on this phone." when the last pull failed)
  - `type Session = { state: 'loading' } | { state: 'signed-out' } | { state: 'needs-name'; user: SignedIn } | { state: 'ready'; user: SignedIn; shelfId: string } | { state: 'error'; user: SignedIn; message: string }`
  - `useSession(backend: Backend, db: ShelfDB): { session: Session; verified(user: SignedIn): Promise<void>; chooseName(name: string): Promise<void>; retry(): void; signOut(): Promise<void> }`
  - `SignInScreen({ backend, onVerified })`, `NameScreen({ onSubmit })`, `BootError({ problems })`

- [ ] **Step 1: Write the failing app tests**

Replace `src/app/App.test.tsx` entirely:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { FakeBackend, collectionRows } from '@/test/fakeBackend';
import App from './App';
import { BackendProvider } from './BackendContext';

const K = { userId: '11111111-1111-4111-8111-111111111111', email: 'kahrman@example.com' };
const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function kahrmansShelf(extra: { profiles?: Record<string, string>; signedIn?: typeof K | null } = {}) {
  const rows = collectionRows(SHELF, K.userId);
  return new FakeBackend({
    users: { [K.email]: K.userId },
    shelfFor: { [K.userId]: SHELF },
    records: rows.records,
    ratings: rows.ratings,
    members: [{ shelfId: SHELF, userId: K.userId, role: 'owner', displayName: 'Kahrman' }],
    ...extra,
  });
}

const returning = () => kahrmansShelf({ profiles: { [K.userId]: 'Kahrman' }, signedIn: K });

function renderApp(backend: FakeBackend, path = '/') {
  return render(
    <BackendProvider backend={backend}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </BackendProvider>,
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  localStorage.clear();
});

describe('signing in', () => {
  it('takes a first-timer from email to code to name to their shelf', async () => {
    const backend = kahrmansShelf();
    renderApp(backend);
    await userEvent.type(await screen.findByLabelText('Your email'), 'kahrman@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send my code' }));
    await userEvent.type(await screen.findByLabelText('Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.type(await screen.findByLabelText('What should we call you?'), 'Kahrman');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
    expect(backend.sentCodesTo).toEqual(['kahrman@example.com']);
  });

  it('says so when the code is wrong, and lets you try again', async () => {
    renderApp(kahrmansShelf());
    await userEvent.type(await screen.findByLabelText('Your email'), 'kahrman@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send my code' }));
    await userEvent.type(await screen.findByLabelText('Code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code didn’t work. Check it, or send a new one.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('refuses something that isn’t an email before sending anything', async () => {
    const backend = kahrmansShelf();
    renderApp(backend);
    await userEvent.type(await screen.findByLabelText('Your email'), 'kahrman');
    await userEvent.click(screen.getByRole('button', { name: 'Send my code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That doesn’t look like an email address.');
    expect(backend.sentCodesTo).toEqual([]);
  });
});

describe('a signed-in person', () => {
  it('goes straight to their midnight shelf', async () => {
    renderApp(returning());
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('midnight');
  });

  it('finds a record at the show, checks its price, and comes back to the same search', async () => {
    renderApp(returning());
    await screen.findByText('Ahmad Jamal Trio');
    await userEvent.click(screen.getByRole('link', { name: 'At the show' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your records' }), 'pershing');
    const row = await screen.findByRole('button', { name: /At the Pershing/ });
    expect(within(row).getByText('Own it')).toBeInTheDocument();
    await userEvent.click(row);
    expect(await screen.findByText('~$12 – $32')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: /Back to search/ }));
    expect(await screen.findByRole('searchbox', { name: 'Search your records' })).toHaveValue('pershing');
  });

  it('says plainly when a search finds nothing', async () => {
    renderApp(returning(), '/show');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search your records' }), 'zeppelin');
    expect(await screen.findByText('Not in your collection or want list.')).toBeInTheDocument();
  });

  it('keeps working from the phone’s copy with no signal', async () => {
    const backend = returning();
    const first = renderApp(backend);
    await screen.findByText('Ahmad Jamal Trio');
    first.unmount();
    backend.online = false;
    renderApp(backend);
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
    expect(await screen.findByText('Couldn’t reach the shelf. Showing what’s on this phone.')).toBeInTheDocument();
  });

  it('shows a clear error, not an empty shelf, when there is no signal and nothing on the phone yet', async () => {
    const backend = returning();
    backend.online = false;
    renderApp(backend);
    expect(await screen.findByRole('heading', { name: 'Couldn’t open your shelf' })).toBeInTheDocument();
    expect(screen.getByText('No signal. Try again when you’re back online.')).toBeInTheDocument();
    backend.online = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
  });
});
```

Replace `src/screens/BootError.test.tsx` entirely:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootError } from './BootError';

describe('BootError', () => {
  it('says the app couldn’t open and lists what went wrong', () => {
    render(<BootError problems={['Missing VITE_SUPABASE_URL. Add it to .env.local on your Mac.']} />);
    expect(screen.getByRole('heading', { name: 'Couldn’t open The Shelf' })).toBeInTheDocument();
    expect(screen.getByText(/Missing VITE_SUPABASE_URL/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app src/screens`
Expected: FAIL (no `./BackendContext`, App still seeds locally, BootError still wants `kind`).

- [ ] **Step 3: Tighten ids to uuids and remove Plan 1's local seeding**

In `src/data/schema.ts`: `shelfId: z.string().min(1)` → `shelfId: z.uuid()`, `addedBy: z.string().min(1)` → `addedBy: z.uuid()`, and in `RatingSchema` `userId: z.string().min(1)` → `userId: z.uuid()`.

In `src/data/importCollection.test.ts`, add at the top `const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';` and `const USER = '11111111-1111-4111-8111-111111111111';`, then replace every `'shelf-1'` with `SHELF` and every `'user-k'` with `USER` (in `ctx` and in the assertions).

Delete `src/app/useBoot.ts`, `src/data/seed.ts`, `src/data/seed.test.ts`, `src/data/session.ts`:

```bash
git rm src/app/useBoot.ts src/data/seed.ts src/data/seed.test.ts src/data/session.ts
```

- [ ] **Step 4: Add the contexts and the session**

`src/app/BackendContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { Backend } from '@/data/backend';

const BackendContext = createContext<Backend | null>(null);

export function BackendProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
}

export function useBackend(): Backend {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error('useBackend() needs <BackendProvider> around the app.');
  return backend;
}
```

`src/app/CurrentShelf.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';

export type CurrentShelf = { shelfId: string; userId: string; email: string; signOut: () => Promise<void> };

const CurrentShelfContext = createContext<CurrentShelf | null>(null);

export function CurrentShelfProvider({ value, children }: { value: CurrentShelf; children: ReactNode }) {
  return <CurrentShelfContext.Provider value={value}>{children}</CurrentShelfContext.Provider>;
}

export function useCurrentShelf(): CurrentShelf {
  const shelf = useContext(CurrentShelfContext);
  if (!shelf) throw new Error('useCurrentShelf() needs a signed-in shelf around it.');
  return shelf;
}
```

`src/app/SyncContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { ShelfSource } from '@/data/backend';
import { useSync, type SyncStatus } from '@/data/useSync';

const SyncContext = createContext<SyncStatus>({ lastSyncedAt: null, error: null });

export function SyncProvider({ source, shelfId, children }: { source: ShelfSource; shelfId: string; children: ReactNode }) {
  const status = useSync(source, shelfId);
  return <SyncContext.Provider value={status}>{children}</SyncContext.Provider>;
}

export function useSyncStatus(): SyncStatus {
  return useContext(SyncContext);
}

export function SyncNotice() {
  const { error } = useSyncStatus();
  if (!error) return null;
  return (
    <p role="status" className="px-4 pb-3 text-[15px] leading-[22px] text-ink-muted">
      Couldn’t reach the shelf. Showing what’s on this phone.
    </p>
  );
}
```

`src/app/useSession.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { Backend, SignedIn } from '@/data/backend';
import { clearPhone, type ShelfDB } from '@/data/db';

export type Session =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'needs-name'; user: SignedIn }
  | { state: 'ready'; user: SignedIn; shelfId: string }
  | { state: 'error'; user: SignedIn; message: string };

type Remembered = { userId: string; shelfId: string };
const SESSION_KEY = 'session';

async function remembered(db: ShelfDB): Promise<Remembered | null> {
  const row = await db.meta.get(SESSION_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Remembered;
  } catch {
    return null;
  }
}

/** Remember who this phone belongs to, so it can open offline. A different person means a clean notebook. */
async function remember(db: ShelfDB, r: Remembered): Promise<void> {
  const previous = await remembered(db);
  if (previous && previous.userId !== r.userId) await clearPhone(db);
  await db.meta.put({ key: SESSION_KEY, value: JSON.stringify(r) });
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useSession(backend: Backend, db: ShelfDB) {
  const [session, setSession] = useState<Session>({ state: 'loading' });

  const settle = useCallback(
    async (user: SignedIn) => {
      try {
        if (!(await backend.hasProfile(user.userId))) {
          setSession({ state: 'needs-name', user });
          return;
        }
        const shelfId = await backend.bootstrap(null);
        await remember(db, { userId: user.userId, shelfId });
        setSession({ state: 'ready', user, shelfId });
      } catch (e) {
        // No signal: open from the phone's copy if it belongs to this person.
        const cached = await remembered(db);
        if (cached && cached.userId === user.userId) setSession({ state: 'ready', user, shelfId: cached.shelfId });
        else setSession({ state: 'error', user, message: messageOf(e) });
      }
    },
    [backend, db],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      const user = await backend.currentUser();
      if (!live) return;
      if (user) {
        await settle(user);
      } else {
        await clearPhone(db);
        if (live) setSession({ state: 'signed-out' });
      }
    })();
    return () => {
      live = false;
    };
  }, [backend, db, settle]);

  const chooseName = async (name: string) => {
    if (session.state !== 'needs-name') return;
    const shelfId = await backend.bootstrap(name); // errors go back to the name screen
    await remember(db, { userId: session.user.userId, shelfId });
    setSession({ state: 'ready', user: session.user, shelfId });
  };

  const retry = () => {
    if (session.state !== 'error') return;
    setSession({ state: 'loading' });
    void settle(session.user);
  };

  const signOut = async () => {
    await backend.signOut();
    await clearPhone(db);
    setSession({ state: 'signed-out' });
  };

  return { session, verified: settle, chooseName, retry, signOut };
}
```

- [ ] **Step 5: Add the sign-in and name screens**

`src/screens/SignInScreen.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Backend, SignedIn } from '@/data/backend';

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted';
const PRIMARY = 'h-12 w-full rounded-lg font-display text-[22px] tracking-[0.04em]';
const FIELD = 'h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk text-base';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Step = { name: 'email' } | { name: 'code'; email: string };

/** Email → 6-digit code. No passwords, and no magic links (they open Safari, not the home-screen app). */
export function SignInScreen({ backend, onVerified }: { backend: Backend; onVerified: (user: SignedIn) => void | Promise<void> }) {
  const [step, setStep] = useState<Step>({ name: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL.test(clean)) {
      setError('That doesn’t look like an email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.sendCode(clean);
      setCode('');
      setStep({ name: 'code', email: clean });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (step.name !== 'code') return;
    if (!/^\d{6}$/.test(code)) {
      setError('The code is 6 digits.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onVerified(await backend.verifyCode(step.email, code));
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+1.5rem))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <h1 className="font-display text-[56px] leading-[52px] tracking-[0.01em]">The Shelf</h1>
      {step.name === 'email' ? (
        <form onSubmit={sendCode} noValidate className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className={LABEL}>Your email</span>
            <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
          </label>
          <p className="text-[15px] leading-[22px] text-ink-muted">We’ll email you a 6-digit code. No password.</p>
          <Button type="submit" disabled={busy} className={PRIMARY}>
            {busy ? 'Sending…' : 'Send my code'}
          </Button>
        </form>
      ) : (
        <form onSubmit={signIn} noValidate className="flex flex-col gap-4">
          <p className="text-base text-ink">We sent a 6-digit code to {step.email}.</p>
          <label className="flex flex-col gap-2">
            <span className={LABEL}>Code</span>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="h-14 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk font-mono text-[28px] tracking-[0.3em]"
            />
          </label>
          <Button type="submit" disabled={busy} className={PRIMARY}>
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
          <div className="flex flex-wrap justify-between gap-2">
            <Button type="button" variant="ghost" className="h-12 px-3" onClick={() => { setStep({ name: 'email' }); setError(null); }}>
              Use a different email
            </Button>
            <Button type="button" variant="ghost" className="h-12 px-3" disabled={busy} onClick={() => void sendCode()}>
              Send a new code
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-base text-brick-ink">
          {error}
        </p>
      )}
    </main>
  );
}
```

`src/screens/NameScreen.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** First sign-in only: the name that shows next to this person's ratings. */
export function NameScreen({ onSubmit }: { onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (clean === '' || clean.length > 40) {
      setError('A first name is enough, up to 40 letters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(clean);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+1.5rem))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <form onSubmit={start} noValidate className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-display text-[28px] leading-7 tracking-[0.02em]">What should we call you?</span>
          <Input autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} className="h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk text-base" />
        </label>
        <p className="text-[15px] leading-[22px] text-ink-muted">It shows next to your ratings, like “Megan: Love it”.</p>
        <Button type="submit" disabled={busy} className="h-12 w-full rounded-lg font-display text-[22px] tracking-[0.04em]">
          {busy ? 'Opening your shelf…' : 'Start'}
        </Button>
        {error && (
          <p role="alert" className="text-base text-brick-ink">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Point the app, the screens and the entry point at the session**

Replace `src/screens/BootError.tsx`:

```tsx
/** Shown only when the app itself can't start (e.g. missing configuration). */
export function BootError({ problems }: { problems: string[] }) {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-12">
      <h1 className="font-display text-[44px] leading-[44px] text-brick-ink">Couldn’t open The Shelf</h1>
      <p className="text-ink">Nothing on this phone was changed. Here’s what went wrong:</p>
      <ul className="flex flex-col gap-1 font-mono text-sm text-ink">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </main>
  );
}
```

In `src/app/App.tsx`, keep `MODE_KEY`, `readMode`, `useModeTheme` and `RedirectOnce` exactly as they are, and replace the imports and the `App` component with:

```tsx
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { db } from '@/data/db';
import { NameScreen } from '@/screens/NameScreen';
import { PriceCheckScreen } from '@/screens/PriceCheckScreen';
import { ShelfScreen } from '@/screens/ShelfScreen';
import { ShowScreen } from '@/screens/ShowScreen';
import { SignInScreen } from '@/screens/SignInScreen';
import { useBackend } from './BackendContext';
import { CurrentShelfProvider } from './CurrentShelf';
import { SyncProvider } from './SyncContext';
import { useSession } from './useSession';

// … MODE_KEY, readMode, useModeTheme, RedirectOnce unchanged …

export default function App() {
  const backend = useBackend();
  const { session, verified, chooseName, retry, signOut } = useSession(backend, db);
  const { pathname } = useLocation();
  // Read once, before useModeTheme overwrites the stored mode.
  const [startInShow, setStartInShow] = useState(() => readMode() === 'show' && pathname === '/');
  useModeTheme();

  if (session.state === 'loading') return null;
  if (session.state === 'signed-out') return <SignInScreen backend={backend} onVerified={verified} />;
  if (session.state === 'needs-name') return <NameScreen onSubmit={chooseName} />;
  if (session.state === 'error') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <h1 className="font-display text-[44px] leading-[44px]">Couldn’t open your shelf</h1>
        <p className="text-ink-muted">{session.message}</p>
        <Button className="h-12 rounded-lg font-display text-[22px] tracking-[0.04em]" onClick={retry}>
          Try again
        </Button>
        <Button variant="ghost" className="h-12" onClick={() => void signOut()}>
          Sign out
        </Button>
      </main>
    );
  }

  return (
    <CurrentShelfProvider value={{ shelfId: session.shelfId, userId: session.user.userId, email: session.user.email, signOut }}>
      <SyncProvider source={backend} shelfId={session.shelfId}>
        <Routes>
          <Route
            path="/"
            element={startInShow ? <RedirectOnce to="/show" onDone={() => setStartInShow(false)} /> : <ShelfScreen />}
          />
          <Route path="/show" element={<ShowScreen />} />
          <Route path="/price/:id" element={<PriceCheckScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SyncProvider>
    </CurrentShelfProvider>
  );
}
```

In `src/screens/ShelfScreen.tsx`:
- Replace `import { LOCAL_SHELF_ID, LOCAL_USER_ID } from '@/data/session';` with `import { useCurrentShelf } from '@/app/CurrentShelf';` and `import { SyncNotice, useSyncStatus } from '@/app/SyncContext';`.
- Replace `const items = useShelfItems(LOCAL_SHELF_ID, LOCAL_USER_ID);` with:

```tsx
  const { shelfId, userId } = useCurrentShelf();
  const items = useShelfItems(shelfId, userId);
  const { lastSyncedAt } = useSyncStatus();
```

- Directly after `</header>`, add `<SyncNotice />`.
- Replace the list block `{items === undefined ? null : rows.length === 0 ? (…) : (…)}` so an empty shelf and an empty filter say different things:

```tsx
      {items === undefined ? null : items.filter((i) => i.record.status === 'owned').length === 0 ? (
        <p className="px-4 py-8 text-ink-muted">{lastSyncedAt ? 'Nothing on the shelf yet.' : 'Filling the shelf…'}</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-8 text-ink-muted">Nothing on the shelf matches that.</p>
      ) : (
        <div className="border-t border-line">
          {rows.map((item) => (
            <SpineRow key={item.record.id} record={item.record} rating={item.myRating} color={spineColor(item.record, genre)} tag={shelfTag(item)} />
          ))}
        </div>
      )}
```

In `src/screens/ShowScreen.tsx`:
- Replace `import { LOCAL_SHELF_ID, LOCAL_USER_ID } from '@/data/session';` with `import { useCurrentShelf } from '@/app/CurrentShelf';` and `import { SyncNotice } from '@/app/SyncContext';`.
- Replace `const items = useShelfItems(LOCAL_SHELF_ID, LOCAL_USER_ID);` with `const { shelfId, userId } = useCurrentShelf();` and `const items = useShelfItems(shelfId, userId);`.
- Directly after `</header>`, add `<SyncNotice />`.

Replace `src/main.tsx`:

```tsx
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from '@/app/App';
import { BackendProvider } from '@/app/BackendContext';
import { supabaseBackend } from '@/data/supabaseBackend';
import { BootError } from '@/screens/BootError';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/libre-franklin/400.css';
import '@fontsource/libre-franklin/600.css';
import '@fontsource/libre-franklin/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@/index.css';

let app: ReactNode;
try {
  app = (
    <BackendProvider backend={supabaseBackend()}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </BackendProvider>
  );
} catch (e) {
  // Missing configuration: say exactly what's missing instead of a blank screen.
  app = <BootError problems={[e instanceof Error ? e.message : String(e)]} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
```

- [ ] **Step 7: Run to verify, then the full suite and build**

Run: `npx vitest run src/app src/screens && npm test && npm run typecheck && npm run build`
Expected: all pass with pristine output; build succeeds. (`npm run dev` now shows "Couldn’t open The Shelf" until `.env.local` exists; that is intended and is set up in Task 9.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Sign in with an email code and open the shared shelf, offline-capable

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Shelf settings: who's on the shelf, invite, sign out

**Files:**
- Create: `src/screens/SettingsScreen.tsx`
- Modify: `src/app/App.tsx` (add the `/settings` route), `src/screens/ShelfScreen.tsx` (settings button in the header)
- Test: `src/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `useCurrentShelf` (Task 6), `useBackend` (Task 6), `useMembers` (Task 5), `Backend.invites`/`invite` (Task 4), `FakeBackend` (tests)
- Produces: route `/settings` → `SettingsScreen()`; a 48px icon link "Shelf settings" (Lucide `Settings`) in the Shelf header.

- [ ] **Step 1: Write the failing tests**

`src/screens/SettingsScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '@/app/App';
import { BackendProvider } from '@/app/BackendContext';
import { db } from '@/data/db';
import { FakeBackend } from '@/test/fakeBackend';

const K = { userId: '11111111-1111-4111-8111-111111111111', email: 'kahrman@example.com' };
const M = { userId: '22222222-2222-4222-8222-222222222222', email: 'megan@example.com' };
const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const members = [
  { shelfId: SHELF, userId: K.userId, role: 'owner' as const, displayName: 'Kahrman' },
  { shelfId: SHELF, userId: M.userId, role: 'member' as const, displayName: 'Megan' },
];

function backendFor(who: typeof K) {
  return new FakeBackend({
    users: { [K.email]: K.userId, [M.email]: M.userId },
    profiles: { [K.userId]: 'Kahrman', [M.userId]: 'Megan' },
    shelfFor: { [K.userId]: SHELF, [M.userId]: SHELF },
    members,
    signedIn: who,
  });
}

function renderSettings(backend: FakeBackend) {
  return render(
    <BackendProvider backend={backend}>
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>
    </BackendProvider>,
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  localStorage.clear();
});

describe('Shelf settings', () => {
  it('lists who is on the shelf', async () => {
    renderSettings(backendFor(K));
    expect(await screen.findByText('Kahrman')).toBeInTheDocument();
    expect(await screen.findByText('Megan')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('lets the owner invite someone by email, and shows them as waiting', async () => {
    renderSettings(backendFor(K));
    await userEvent.type(await screen.findByLabelText('Their email'), 'Friend@Example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByText('friend@example.com')).toBeInTheDocument();
    expect(screen.getByText('Waiting for them to sign in')).toBeInTheDocument();
  });

  it('says so when an email is already invited', async () => {
    renderSettings(backendFor(K));
    const field = await screen.findByLabelText('Their email');
    await userEvent.type(field, 'friend@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    await screen.findByText('friend@example.com');
    await userEvent.type(field, 'friend@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That email is already invited.');
  });

  it('does not offer invites to someone who isn’t the owner', async () => {
    renderSettings(backendFor(M));
    await screen.findByText('Megan');
    expect(screen.queryByLabelText('Their email')).toBeNull();
    expect(screen.getByText('Only the shelf’s owner can invite people.')).toBeInTheDocument();
  });

  it('signs out, clears the phone and returns to sign-in', async () => {
    renderSettings(backendFor(K));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Your email')).toBeInTheDocument();
    expect(await db.members.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/screens/SettingsScreen.test.tsx`
Expected: FAIL (no `/settings` route, so the app redirects to the shelf).

- [ ] **Step 3: Implement**

`src/screens/SettingsScreen.tsx`:

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useBackend } from '@/app/BackendContext';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Invite } from '@/data/backend';
import { useMembers } from '@/data/hooks';

const SECTION = 'font-display text-[28px] leading-7 tracking-[0.02em]';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SettingsScreen() {
  const backend = useBackend();
  const { shelfId, userId, signOut } = useCurrentShelf();
  const members = useMembers(shelfId);
  const isOwner = members?.some((m) => m.userId === userId && m.role === 'owner') ?? false;
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    try {
      setInvites(await backend.invites(shelfId));
      setInvitesError(null);
    } catch (e) {
      setInvitesError(e instanceof Error ? e.message : String(e));
    }
  }, [backend, shelfId]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL.test(clean)) {
      setError('That doesn’t look like an email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.invite(shelfId, clean, userId);
      setEmail('');
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const waiting = invites?.filter((i) => i.acceptedAt === null) ?? [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <Button asChild variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold">
        <Link to="/">
          <ArrowLeft className="size-5" />
          Back to the shelf
        </Link>
      </Button>
      <h1 className="font-display text-[56px] leading-[52px] tracking-[0.01em]">Shelf settings</h1>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION}>On this shelf</h2>
        <ul className="flex flex-col border-t border-line">
          {(members ?? []).map((m) => (
            <li key={m.userId} className="flex min-h-12 items-center justify-between border-b border-line">
              <span className="text-[17px] font-bold">{m.displayName}</span>
              {m.role === 'owner' && <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Owner</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION}>Invite someone</h2>
        {isOwner ? (
          <form onSubmit={sendInvite} noValidate className="flex flex-col gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">Their email</span>
              <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk text-base" />
            </label>
            <p className="text-[15px] leading-[22px] text-ink-muted">They join this shelf the next time they sign in with that email.</p>
            <Button type="submit" disabled={busy} className="h-12 rounded-lg font-display text-[22px] tracking-[0.04em]">
              {busy ? 'Sending…' : 'Send invite'}
            </Button>
            {error && (
              <p role="alert" className="text-base text-brick-ink">
                {error}
              </p>
            )}
          </form>
        ) : (
          <p className="text-ink-muted">Only the shelf’s owner can invite people.</p>
        )}
        {invitesError && <p className="text-[15px] text-ink-muted">Invites need signal. {invitesError}</p>}
        {waiting.length > 0 && (
          <ul className="flex flex-col border-t border-line">
            {waiting.map((i) => (
              <li key={i.email} className="flex min-h-12 flex-col justify-center border-b border-line py-2">
                <span className="text-base">{i.email}</span>
                <span className="text-[13px] text-ink-muted">Waiting for them to sign in</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <Button variant="outline" className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent text-[15px] font-semibold" onClick={() => void signOut()}>
          Sign out
        </Button>
        <p className="text-[15px] leading-[22px] text-ink-muted">Signing out clears the shelf from this phone. It stays safe in your account.</p>
      </section>
    </main>
  );
}
```

In `src/app/App.tsx`: import `SettingsScreen` from `@/screens/SettingsScreen` and add `<Route path="/settings" element={<SettingsScreen />} />` before the `*` route.

In `src/screens/ShelfScreen.tsx`: import `Settings` from `lucide-react` alongside `Search`, and replace the single "At the show" button in the header with:

```tsx
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent px-5 text-[15px] font-semibold">
            <Link to="/show">At the show</Link>
          </Button>
          <Button asChild variant="ghost" className="size-12 rounded-lg p-0">
            <Link to="/settings" aria-label="Shelf settings">
              <Settings className="size-5" />
            </Link>
          </Button>
        </div>
```

- [ ] **Step 4: Run to verify, then the full suite**

Run: `npx vitest run src/screens && npm test && npm run typecheck`
Expected: all pass, pristine output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add shelf settings: members, invites and sign out

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: One-time import script and the keep-awake job

**Files:**
- Create: `scripts/import-collection.ts`, `.github/workflows/keep-supabase-awake.yml`
- Modify: `package.json` (add `tsx`, add script `import:collection`)

**Interfaces:**
- Consumes: `importCollection` (Plan 1), `recordToRow`, `ratingToRow` (Task 1), `public.ping()` (Task 3)
- Produces: `npm run import:collection -- you@example.com` (reads `.env.local`); a scheduled workflow that fails visibly if the database stops answering.

These talk to the real Supabase project, so they have no unit tests; Task 9 runs them for real. They must still be safe to re-run.

- [ ] **Step 1: Install tsx and add the script entry**

```bash
npm install -D tsx
npm pkg set scripts.import:collection="tsx --env-file=.env.local scripts/import-collection.ts"
```

- [ ] **Step 2: Write the import script**

`scripts/import-collection.ts`:

```ts
// One-time: copy collection.json onto a person's shelf in Supabase, with their ratings.
// Safe to re-run: records already on the shelf (same import key) are skipped, ratings are only added if missing.
// Usage: npm run import:collection -- you@example.com
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { importCollection } from '../src/data/importCollection';
import { ratingToRow, recordToRow } from '../src/data/rowMapping';

function stop(message: string): never {
  console.error(`Import stopped.\n${message}`);
  process.exit(1);
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email) stop('Say whose shelf: npm run import:collection -- you@example.com');

const url = process.env.VITE_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) stop('Missing VITE_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local.');

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

// 1. Who is it?
let userId: string | undefined;
for (let page = 1; userId === undefined; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) stop(`Couldn't list accounts: ${error.message}`);
  userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
  if (data.users.length < 200) break;
}
if (!userId) stop(`No one has signed in as ${email} yet. Sign in on your phone first, then run this again.`);

// 2. Which shelf do they own?
const { data: owned, error: shelfError } = await admin.from('shelf_members').select('shelf_id').eq('user_id', userId).eq('role', 'owner');
if (shelfError) stop(`Couldn't find the shelf: ${shelfError.message}`);
if (!owned || owned.length !== 1) stop(`Expected ${email} to own exactly one shelf, found ${owned?.length ?? 0}.`);
const shelfId = owned[0].shelf_id as string;

// 3. Check the whole file before touching anything.
const json: unknown = JSON.parse(readFileSync(new URL('../collection.json', import.meta.url), 'utf8'));
let prepared: ReturnType<typeof importCollection>;
try {
  prepared = importCollection(json, { shelfId, userId, newId: () => crypto.randomUUID() });
} catch (e) {
  stop(`Nothing was saved.\n${e instanceof Error ? e.message : String(e)}`);
}

// 4. Add the records that aren't there yet.
const { data: existing, error: existingError } = await admin.from('records').select('id, import_key').eq('shelf_id', shelfId).not('import_key', 'is', null);
if (existingError) stop(`Couldn't read the shelf: ${existingError.message}`);
const serverIdByKey = new Map(existing.map((r) => [r.import_key as string, r.id as string]));
const newRecords = prepared.records.filter((r) => r.importKey !== null && !serverIdByKey.has(r.importKey));
if (newRecords.length > 0) {
  const { error } = await admin.from('records').insert(newRecords.map(recordToRow));
  if (error) stop(`Nothing was saved: ${error.message}`);
  for (const r of newRecords) serverIdByKey.set(r.importKey as string, r.id);
}

// 5. Add ratings that are missing, matched by import key so re-runs repair a half-finished import.
const keyByLocalId = new Map(prepared.records.map((r) => [r.id, r.importKey as string]));
const ratingRows = prepared.ratings.map((r) => ({ ...r, recordId: serverIdByKey.get(keyByLocalId.get(r.recordId)!)! })).map(ratingToRow);
if (ratingRows.length > 0) {
  const { error } = await admin.from('ratings').upsert(ratingRows, { onConflict: 'record_id,user_id', ignoreDuplicates: true });
  if (error) stop(`The ${newRecords.length} records were added, but ratings failed: ${error.message}\nRun the same command again to finish.`);
}

console.log(`Done. ${newRecords.length} records added (${prepared.records.length - newRecords.length} were already there). Ratings checked: ${ratingRows.length}.`);
```

- [ ] **Step 3: Check it at least parses and refuses to run without its inputs**

Run: `npx tsx scripts/import-collection.ts`
Expected: exits with `Import stopped.` and `Say whose shelf: …` (no email given).
Run: `npx tsx scripts/import-collection.ts someone@example.com`
Expected (no `.env.local` yet): `Import stopped.` and `Missing VITE_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local.`

- [ ] **Step 4: Write the keep-awake workflow**

`.github/workflows/keep-supabase-awake.yml`:

```yaml
# Free Supabase projects pause after a week without use. This asks the database a harmless question every 3 days.
name: Keep Supabase awake

on:
  schedule:
    - cron: '17 9 */3 * *'
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ask the database if it's there
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}
        run: |
          response=$(curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/ping" \
            -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" -d '{}')
          echo "Supabase said: $response"
          test "$response" = "true"
```

- [ ] **Step 5: Verify the suite still passes and commit**

Run: `npm test && npm run typecheck`
Expected: all pass.

```bash
git add -A
git commit -m "Add the one-time collection import script and a keep-awake job

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 9: The opening: the shelf fills, the title drops, sign-in rises

**Files:**
- Create: `src/ui/ShelfIntro.tsx`
- Modify: `src/index.css` (intro styles), `src/screens/SignInScreen.tsx` and `src/screens/NameScreen.tsx` (render inside the intro)
- Test: `src/ui/ShelfIntro.test.tsx`

**Interfaces:**
- Consumes: `GENRE_KEYS` (Plan 1)
- Produces: `makeShelves(rows: number, perRow: number, seed?: number): Spine[][]` with `type Spine = { width: number; height: number; color: string; band: boolean }`; `ShelfIntro({ children })`, which renders the spine wall (decorative, `aria-hidden`), the "The Shelf" heading and a bottom panel holding `children`. Modes on the root's `data-intro`: `full` (first time on this device: spines slide in row by row over ~1.5 s, the title drops at 1.5 s, the panel rises at 2 s), `quick` (every later time: the wall is already full, title and panel fade in over 200 ms), `still` (reduced motion: no animation).

- [ ] **Step 1: Write the failing tests**

`src/ui/ShelfIntro.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShelfIntro, makeShelves } from './ShelfIntro';

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  localStorage.clear();
  mockReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('makeShelves', () => {
  it('builds the same wall every time from the same seed', () => {
    expect(makeShelves(5, 28)).toEqual(makeShelves(5, 28));
    expect(makeShelves(5, 28).flat()).toHaveLength(140);
  });

  it('keeps spines within believable sizes and paints them in the shelf palette', () => {
    for (const s of makeShelves(5, 28).flat()) {
      expect(s.width).toBeGreaterThanOrEqual(10);
      expect(s.width).toBeLessThanOrEqual(26);
      expect(s.height).toBeGreaterThanOrEqual(70);
      expect(s.height).toBeLessThanOrEqual(96);
      expect(s.color).toMatch(/^var\(--(genre-[a-z]+|bourbon|ink-muted)\)$/);
    }
  });
});

describe('ShelfIntro', () => {
  it('plays in full the first time, and quickly after that', () => {
    const first = render(<ShelfIntro>form</ShelfIntro>);
    expect(first.container.querySelector('[data-intro]')).toHaveAttribute('data-intro', 'full');
    first.unmount();
    const again = render(<ShelfIntro>form</ShelfIntro>);
    expect(again.container.querySelector('[data-intro]')).toHaveAttribute('data-intro', 'quick');
  });

  it('stays still for people who asked for less motion', () => {
    mockReducedMotion(true);
    const { container } = render(<ShelfIntro>form</ShelfIntro>);
    expect(container.querySelector('[data-intro]')).toHaveAttribute('data-intro', 'still');
  });

  it('keeps the wall out of the accessibility tree and the title and form in it', () => {
    render(<ShelfIntro><button type="button">Send my code</button></ShelfIntro>);
    expect(screen.getByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send my code' })).toBeInTheDocument();
    expect(document.querySelector('.shelf-intro__wall')).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/ShelfIntro.test.tsx`
Expected: FAIL, cannot resolve `./ShelfIntro`.

- [ ] **Step 3: Implement**

`src/ui/ShelfIntro.tsx`:

```tsx
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GENRE_KEYS } from '@/domain/genres';

export type Spine = { width: number; height: number; color: string; band: boolean };

const PLAYED_KEY = 'shelf:intro-played';
const COLORS = [...GENRE_KEYS.map((k) => `var(--genre-${k})`), 'var(--bourbon)', 'var(--ink-muted)'];

/** Small seeded random numbers, so the wall is the same on every visit and in every test. */
function seeded(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeShelves(rows: number, perRow: number, seed = 7): Spine[][] {
  const random = seeded(seed);
  return Array.from({ length: rows }, () =>
    Array.from({ length: perRow }, () => ({
      width: 10 + Math.floor(random() * 17),
      height: 70 + Math.floor(random() * 27),
      color: COLORS[Math.floor(random() * COLORS.length)],
      band: random() < 0.33,
    })),
  );
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playedBefore(): boolean {
  try {
    return localStorage.getItem(PLAYED_KEY) === '1';
  } catch {
    return false;
  }
}

/** The opening: record spines fill the shelf, "The Shelf" drops in, then the sign-in panel rises over it. */
export function ShelfIntro({ children }: { children: ReactNode }) {
  const [mode] = useState<'full' | 'quick' | 'still'>(() => (prefersReducedMotion() ? 'still' : playedBefore() ? 'quick' : 'full'));
  const shelves = useMemo(() => makeShelves(5, 28), []);

  useEffect(() => {
    try {
      localStorage.setItem(PLAYED_KEY, '1');
    } catch {
      // Private browsing: it just plays in full again next time.
    }
  }, []);

  return (
    <div className="shelf-intro" data-intro={mode}>
      <div className="shelf-intro__wall" aria-hidden="true">
        {shelves.map((row, r) => (
          <div key={r} className="shelf-intro__row">
            <div className="shelf-intro__spines">
              {row.map((s, i) => (
                <span
                  key={i}
                  className="shelf-intro__spine"
                  style={{ width: s.width, height: `${s.height}%`, background: s.color, animationDelay: `${r * 140 + i * 22}ms` }}
                >
                  {s.band && <span className="shelf-intro__band" />}
                </span>
              ))}
            </div>
            <div className="shelf-intro__plank" />
          </div>
        ))}
      </div>
      <h1 className="shelf-intro__title">The Shelf</h1>
      <div className="shelf-intro__panel">{children}</div>
    </div>
  );
}
```

Append to `src/index.css`:

```css
/* The opening: spines fill the shelf, the title drops, sign-in rises. Flat poster colour, square spines. */
.shelf-intro {
  position: relative;
  display: flex;
  min-height: 100dvh;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  background: var(--surface);
}
.shelf-intro__wall {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: calc(env(safe-area-inset-top) + 12px) 0 12px;
}
.shelf-intro__row { display: flex; flex: 1; flex-direction: column; }
.shelf-intro__spines { display: flex; flex: 1; align-items: flex-end; gap: 3px; overflow: hidden; padding: 0 8px; }
.shelf-intro__spine { position: relative; flex: none; }
.shelf-intro__band { position: absolute; top: 16%; right: 0; left: 0; height: 6px; background: var(--surface); opacity: 0.35; }
.shelf-intro__plank { height: 8px; background: var(--line); }
.shelf-intro__title {
  position: relative;
  z-index: 1;
  align-self: center;
  margin-top: max(18vh, calc(env(safe-area-inset-top) + 4rem));
  padding: 4px 20px 0;
  background: var(--surface);
  font-family: var(--font-display);
  font-size: 88px;
  line-height: 0.95;
  letter-spacing: 0.01em;
  color: var(--ink);
}
.shelf-intro__panel {
  position: relative;
  z-index: 1;
  border-radius: 24px 24px 0 0;
  background: var(--surface-raised);
  box-shadow: 0 -8px 28px #000000b3;
}
/* The screens inside the panel don't need their own full-height layout or title. */
.shelf-intro__panel > main { min-height: 0; padding-top: 24px; }
.shelf-intro__panel > main > h1 { display: none; }

@keyframes intro-spine { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }
@keyframes intro-title { from { opacity: 0; transform: translateY(-48px); } to { opacity: 1; transform: none; } }
@keyframes intro-panel { from { transform: translateY(100%); } to { transform: none; } }
@keyframes intro-fade { from { opacity: 0; } to { opacity: 1; } }

.shelf-intro[data-intro='full'] .shelf-intro__spine { animation: intro-spine 380ms cubic-bezier(0, 0, 0.2, 1) both; }
.shelf-intro[data-intro='full'] .shelf-intro__title { animation: intro-title 520ms cubic-bezier(0, 0, 0.2, 1) 1500ms both; }
.shelf-intro[data-intro='full'] .shelf-intro__panel { animation: intro-panel 500ms cubic-bezier(0, 0, 0.2, 1) 2000ms both; }
.shelf-intro[data-intro='quick'] .shelf-intro__title,
.shelf-intro[data-intro='quick'] .shelf-intro__panel { animation: intro-fade 200ms ease-out both; }

@media (prefers-reduced-motion: reduce) {
  .shelf-intro * { animation: none !important; }
}
```

In `src/screens/SignInScreen.tsx` and `src/screens/NameScreen.tsx`: import `ShelfIntro` from `@/ui/ShelfIntro` and wrap each screen's returned `<main>…</main>` in `<ShelfIntro>…</ShelfIntro>`. Leave the `<h1>` in `SignInScreen` in place: the intro's CSS hides it, and the intro's own heading is the one on screen. (Keep exactly one accessible heading: add `aria-hidden="true"` to the `<h1>` inside `SignInScreen`.)

- [ ] **Step 4: Run to verify, then the full suite and build**

Run: `npx vitest run src/ui/ShelfIntro.test.tsx && npm test && npm run typecheck && npm run build`
Expected: all pass; the App sign-in tests still pass (the form is inside the intro's panel).

- [ ] **Step 5: Look at it (controller)**

With `.env.local` in place, `npm run dev`, sign out, and watch at 375×812: spines slide in row by row, "THE SHELF" drops in, the sign-in panel rises; reload shows the quick version. Check both themes' contrast on the title plate.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Open with the shelf filling up before sign-in rises into view

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 10: Go live (Kahrman and the controller, on the real accounts)

This task is done by hand, not by a subagent: it uses Kahrman's accounts, passwords and phone. The controller runs the commands marked **(controller)** and confirms each result; Kahrman does the steps marked **(Kahrman)**. Nothing merges to `main` (and so nothing deploys) until Step 7 passes.

- [ ] **Step 1 (Kahrman): Connect the Supabase CLI to the project.** In a terminal in `~/Developer/the-shelf`:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref rlhhrzkaosngafcoxaas
```

`link` asks for the database password saved when the project was created.

- [ ] **Step 2 (Kahrman): Create the tables.** Still in the terminal:

```bash
npx supabase db push
```

Expected: it lists the two migrations and applies them. (Controller then checks in the Supabase dashboard → Table Editor that `profiles`, `shelves`, `shelf_members`, `shelf_invites`, `records`, `ratings` exist, each marked RLS enabled.)

- [ ] **Step 3 (Kahrman): Make the sign-in email carry the code.** Supabase dashboard → **Authentication → Emails** (Templates). For both **Magic Link** and **Confirm signup**, set the subject to `Your code for The Shelf` and the body to:

```html
<h2>Your code for The Shelf</h2>
<p>Type this into the app:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:bold">{{ .Token }}</p>
<p>It works for one hour. If you didn't ask for it, you can ignore this email.</p>
```

Then **Authentication → Sign In / Providers → Email**: Email enabled, **Email OTP Length 6**. Save.

- [ ] **Step 4 (Kahrman): Put the keys where they belong.** Dashboard → **Project Settings → API Keys**.
  1. On the Mac: copy `.env.example` to `.env.local` (`cp .env.example .env.local`) and paste the **publishable** key and the **secret** key into it. Never paste the secret key anywhere else.
  2. Vercel → the-shelf → **Settings → Environment Variables**: add `VITE_SUPABASE_URL` = `https://rlhhrzkaosngafcoxaas.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY` = the publishable key, for Production and Preview. (Not the secret key.)

- [ ] **Step 5 (controller): Keep-awake secrets and a test run.** Read the two values from `.env.local` without printing them:

```bash
set -a; source .env.local; set +a
printf '%s' "$VITE_SUPABASE_URL" | gh secret set SUPABASE_URL
printf '%s' "$VITE_SUPABASE_PUBLISHABLE_KEY" | gh secret set SUPABASE_PUBLISHABLE_KEY
```

(After the branch is merged and pushed in Step 8, run `gh workflow run keep-supabase-awake.yml` and confirm it passes with `gh run list --workflow keep-supabase-awake.yml`.)

- [ ] **Step 6 (Kahrman, then controller): First sign-in and the import.**
  1. Kahrman: `npm run dev`, open the local address, sign in with his email and the code, name "Kahrman". The shelf reads "Nothing on the shelf yet."
  2. Controller: `npm run import:collection -- <Kahrman's email>`. Expected: `Done. 11 records added (0 were already there). Ratings checked: 6.`
  3. Controller: run it again. Expected: `Done. 0 records added (11 were already there). Ratings checked: 6.`
  4. Kahrman: within a minute (or on reopening the tab) all 11 records appear with his ratings.

- [ ] **Step 7 (Kahrman, Megan): Two people, one shelf.**
  1. Supabase dashboard → **Organization → Team → Invite**: Megan's email (so the built-in sender will deliver her code). She accepts the team invite email.
  2. Kahrman (local app) → Shelf settings → invite Megan's email. It shows "Waiting for them to sign in".
  3. Megan signs in on the local app with her email, names herself "Megan". She sees Kahrman's 11 records; Shelf settings lists Kahrman (Owner) and Megan.

- [ ] **Step 8 (controller): Merge and deploy.** Only after Step 7 passes: finish the branch (merge to `main`), push, confirm Vercel's deployment picks up the environment variables (the live site shows the sign-in screen, not "Couldn’t open The Shelf"), then run the keep-awake workflow once.

- [ ] **Step 9 (Kahrman, Megan): On the phones.** Each opens the live site in Safari (the app on the home screen updates itself), signs in, and sees the shared shelf. Airplane mode test: the shelf still opens and search/price check still work, with "Couldn’t reach the shelf. Showing what’s on this phone."

---

## After this plan

- **Plan 3, buying and logging:** the outbox (changes made offline wait and send), Bought it, New arrivals, rating a record (per person, full-size dots, both people's ratings on the Record screen), want list and upgrades, add/edit, cover photos, poster placeholder. Carry-overs from `docs/superpowers/notes/plan-2-handoff.md` (roving tabindex in GradePicker, SpineRow accessible name, `navigator.storage.persist()` before the outbox holds unsent changes).
- **When friends join:** a domain plus Resend for sign-in email, and a way to belong to more than one shelf.
