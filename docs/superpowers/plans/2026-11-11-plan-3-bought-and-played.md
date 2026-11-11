# Plan 3: Bought It, Then Played It, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At a record show, one tap logs a purchase into New arrivals, even with no signal. At home, rating it on the Record screen moves it to the shelf on both phones.

**Architecture:**
- **Saving:** every write goes into a Dexie `outbox` of "postcards" (only the changed fields), and is applied to the notebook in the same transaction.
- **The courier:** sends postcards in order, safe to repeat, then pulls and re-applies whatever hasn't been sent. So the notebook always equals the server plus my unsent changes.
- **Actions** (Bought it, Undo, Didn't buy it, Rate) are pure functions that return postcards.
- **One database trigger** moves a new arrival to the shelf on its first rating.
- **New screens:** Record, New arrivals, and the Bought it sheet. The poster is a deterministic SVG.

**Tech Stack:** existing (React 19, TypeScript, Vite, Dexie 4 + dexie-react-hooks, Supabase JS, Zod 4, Tailwind 4 + shadcn/Radix via `radix-ui`, Vitest + Testing Library + fake-indexeddb, PGlite for database tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-plan-3-bought-and-played-design.md` (read it first; § numbers below refer to it). Background: `docs/superpowers/specs/2026-09-18-the-shelf-design.md`, `docs/superpowers/notes/plan-2-handoff.md`.

**Baseline before Task 1:** branch `plan-3-bought-and-played`; `npx vitest run` → 23 files, 129 tests pass; `npx tsc -b` clean.

## Global Constraints

- **Plans 1 and 2 still hold:**
  - the nine genres and their order; Goldmine grades; artist reads first;
  - price paid never on a spine row;
  - ratings are per person;
  - fail loudly;
  - inputs ≥ 16px; tap targets ≥ 48px;
  - no emoji or exclamation marks in UI copy;
  - every id is a uuid.
- **Server access:**
  - Screens, actions and the courier reach the server only through `Backend` (`src/data/backend.ts`). Nothing outside `src/data/supabase*.ts` imports `@supabase/supabase-js`.
  - **No `.upsert()`** for records or ratings (the column-level UPDATE grants make it fail).
  - `updated_at` is stamped only by the server. `bought_at` uses the phone's clock (`new Date().toISOString()`).
- **The notebook:**
  - Every check-then-write on it runs inside one Dexie `rw` transaction.
  - `applyPostcard` is the only code that turns a postcard into notebook changes.
- **New SQL:**
  - New SQL functions use `security invoker` (unless the spec says otherwise) and `set search_path = ''`, and explicitly `revoke execute … from public, anon, authenticated` unless a role needs it.
  - Never edit an existing migration file; add a new one.
- **Timings and routes:**
  - Undo window: **8000 ms**.
  - Show-mode (paper) routes: `/show` and `/price/*`. Home (midnight) routes: `/`, `/arrivals`, `/record/*`. `/settings` stays paper.
- **Exact copy** (curly apostrophes as in the existing code):
  - **Outbox waiting:** `Saved on this phone · 1 waiting to send` / `Saved on this phone · {n} waiting to send`
  - **Rejected:** `1 change couldn’t be saved: {reason}` / `{n} changes couldn’t be saved: {reason}` (the reason of the oldest rejected postcard), with buttons `Try again` and `Discard`
  - **Pull, no signal:** `Couldn’t reach the shelf. Showing what’s on this phone.` (unchanged)
  - **Pull failures:**
    - unreadable: `The shelf sent something this app can’t read: {first problem}`
    - permission: `You don’t have access to this shelf any more.`
  - **Rejection reasons:**
    - `That record is no longer on your shelf.`
    - `You don’t have permission to change this record.`
    - `The shelf refused a value that’s out of range.`
    - `The shelf refused a value it doesn’t recognise.`
    - fallback: `The shelf refused this change. ({code})`
  - **Sign out:** `1 change hasn’t reached the shelf yet. Signing out deletes it.` / `{n} changes haven’t reached the shelf yet. Signing out deletes them.`, with buttons `Stay signed in` (primary) and `Sign out and delete` (danger)
  - **Previous person:** `{n} changes from the previous person on this phone haven’t been sent. Continuing deletes them.` (singular: `1 change … hasn’t been sent. Continuing deletes it.`), with buttons `Go back` (primary) and `Continue and delete` (danger)
  - **Storage:** `This phone may clear unsent changes if it runs low on space.`
  - **Undo bar:** `In New arrivals` or `Upgrade logged`, with button `Undo`
  - **Price check:**
    - button `Bought it`
    - line `Logs {grade} · {money} paid` or `Logs {grade}`
  - **Show search:** `Not in your collection or want list.` + button `Bought it`
  - **Sheet:**
    - title `Bought it`
    - labels `Artist`, `Title`, `Genre`, `Price paid`; GradePicker `part="Disc"`
    - genre placeholder `Choose a genre`
    - errors `Add the artist`, `Add the title`, `Choose a genre`
    - submit `Bought it`
  - **Pile row:** `New arrivals · {n}`, accessible name `New arrivals, {n} waiting`
  - **New arrivals empty:** `Nothing waiting. Records you buy at a show land here.`
  - **Record screen:**
    - `not graded`, `Your rating`
    - `{Name} · {word}` / `{Name} · Unplayed`
    - rating confirm `{word} · On the shelf · {GENRE_LABELS[genre]}`
    - `Paid {money}`
    - `Didn’t buy it`; confirm `Remove {title} from New arrivals?` with `Remove it` (danger) / `Keep it`
  - **Poster:** `aria-label="Poster for {artist}, {title}"`
- **Money display:** `formatMoney(15)` → `$15`, `formatMoney(15.5)` → `$15.50`.
- **Every task ends green:** `npx vitest run` and `npx tsc -b`.
- **Commits:** messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge to `main` without Kahrman's explicit OK (Vercel deploys `main`).

## Review Focus

1. **A double tap on Bought it** (price check or sheet) logs exactly one purchase. Tests: Task 12 Step 1, Task 13 Step 1.
2. **Undo after the purchase has already reached the server** still reverses it there (online, the courier sends within a second). Test: Task 6 Step 1.
3. **Prices typed with a comma** (`15,50`, `1,200`) or a `$` log the amount meant ($15.50, $1,200), never $1,550. Test: Task 12 Step 1.
4. **Both people rating the same new arrival** (each offline, then both send): one move to the shelf, and both ratings kept. Test: Task 1 Step 1.
5. **A very long artist name** stays inside the poster's band (shrinks to 18, then truncates with `…`). Test: Task 8 Step 1.

## File Map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261111120000_shelve_on_first_rating.sql` | The trigger (§4.6) |
| `supabase/tests/writes.test.ts` | Trigger, grants and RLS on the write paths |
| `src/data/backend.ts` | + `ShelfWriter`, `REJECTED` copy |
| `src/data/rowMapping.ts` | + `NewRecordRow`, `RecordPatchRow`, `newRecordToRow`, `patchToRow` |
| `src/data/supabaseBackend.ts` | + `insertRecord`, `patchRecord`, `setRating`, `rejectionReason` |
| `src/test/fakeBackend.ts` | + writes, trigger emulation, fault switches |
| `src/data/db.ts` | Dexie v3 `outbox`; `clearPhone` clears it |
| `src/data/outbox.ts` | Postcard types, `applyPostcard`, `savePostcards`, storage persistence |
| `src/data/courier.ts` | `pushOutbox`, `syncOnce`, `retryPostcard`, `discardPostcard` |
| `src/data/sync.ts` | `pullShelf` re-applies the outbox; `forgetLastPull` |
| `src/data/useSync.ts`, `src/app/SyncContext.tsx` | Run the courier; the header notice |
| `src/data/actions.ts` | Pure actions + `perform` |
| `src/app/useSession.ts` | Sign-out guard, startup with unsent changes |
| `src/ui/ConfirmDialog.tsx` | Radix AlertDialog wrapper |
| `src/domain/search.ts` | `normalise` keeps letters in any script |
| `src/domain/poster.ts`, `src/ui/Poster.tsx` | The poster |
| `src/data/hooks.ts` | `useRecord(shelfId, id)`, `useRatings`, `useOutbox` |
| `src/screens/RecordScreen.tsx`, `src/ui/RatingRecords.tsx` | Record screen and rating |
| `src/ui/PileRow.tsx`, `src/screens/ArrivalsScreen.tsx` | New arrivals |
| `src/app/UndoContext.tsx` | Undo bar |
| `src/domain/price.ts`, `src/ui/PriceCheck.tsx` | `parsePrice`, `formatMoney`, Bought it |
| `src/ui/BuyNewSheet.tsx`, `src/screens/ShowScreen.tsx` | Bought it for records you don't own |

---

### Task 1: Database: shelve on first rating, and the write paths

**Files:**
- Create: `supabase/migrations/20261111120000_shelve_on_first_rating.sql`, `supabase/tests/writes.test.ts`
- Modify: `supabase/tests/bootstrap.test.ts` (four missing tests from the Plan 2 handoff)

**Interfaces:**
- Consumes: `freshDb`, `addUser`, `asUser` from `supabase/tests/harness.ts`. Reuse the setup pattern in `supabase/tests/rls.test.ts` (Kahrman + Megan on one shelf, a stranger on another).
- Produces: the trigger `ratings_shelve_on_first_rating` on `public.ratings`.

- [ ] **Step 1: Write the failing tests in `supabase/tests/writes.test.ts`** (`// @vitest-environment node` first line). Records are inserted as the superuser with the given `status`.
  - `first rating moves a new arrival to the shelf`: Megan inserts a rating on a `new_arrival` → `status` is `owned`.
  - `a changed rating moves nothing`: create a `new_arrival`, insert Kahrman's rating, set `status` back to `new_arrival` as superuser, then Kahrman updates his rating value → `status` is still `new_arrival`.
  - `a rating on a want moves nothing`: `wanted` stays `wanted`.
  - `both people rating the same new arrival: one move, both ratings kept` (Review Focus 4): both insert → `owned`, `select count(*) from ratings where record_id = $1` is 2.
  - `members can patch the editable fields, including deleted_at`: as Megan, `update … set status='new_arrival', disc_grade='VG+', price_paid=15, bought_at=now(), deleted_at=now() where id=$1 returning id` returns 1 row.
  - `identity columns stay frozen`: as Megan, `update … set added_by=$megan` rejects with `/permission denied/`.
  - `the rating write path works under the grants`: as Kahrman, `update ratings set value=4 where record_id=$1 and user_id=$2 returning record_id` returns 0 rows when none exists; the `insert` then succeeds; the same `update` then returns 1 row.
  - `a stranger can neither patch nor rate Kahrman’s records`: the stranger's `update … returning id` returns 0 rows; the stranger's rating insert rejects with `/row-level security/`.
  - `nobody can execute the trigger function`: `select has_function_privilege('authenticated', 'public.shelve_on_first_rating()', 'execute')` is `false`.

- [ ] **Step 2: Add to `supabase/tests/bootstrap.test.ts`** (read `supabase/migrations/20260919120100_bootstrap.sql` first):
  - `keeps the invitee’s own shelf when someone else is on it`: Megan owns shelf M, which has a second member, and Megan has an open invite to K. Bootstrap as Megan → M still exists.
  - `leaves another person’s empty shelf alone`: the stranger's empty shelf still exists after Megan's bootstrap.
  - `refuses a sign-in whose JWT has no email`: claims without `email` → `bootstrap(null)` rejects, and no `shelf_members` row exists for that user.
  - `does not process an accepted invite again`: accept Megan's invite, have the owner delete Megan's membership, bootstrap as Megan again → no `shelf_members` row for Megan on K.

- [ ] **Step 3: Run them and see the trigger tests fail**

Run: `npx vitest run supabase/tests`
Expected: the first two trigger tests and "both people…" FAIL (status stays `new_arrival`), and `has_function_privilege` errors (no such function). If a bootstrap test fails, `bootstrap()` has a real bug: fix it in a **new** migration, not the old file.

- [ ] **Step 4: Create the migration.** The security choices here are deliberate (spec §4.6):

```sql
-- A first rating means someone has played it: move it from New arrivals onto the shelf.
-- Runs with the rater's own rights (they already hold update(status) and pass "members edit records").
create function public.shelve_on_first_rating() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.records set status = 'owned' where id = new.record_id and status = 'new_arrival';
  return null;
end $$;
revoke execute on function public.shelve_on_first_rating() from public, anon, authenticated;
create trigger ratings_shelve_on_first_rating after insert on public.ratings
  for each row execute function public.shelve_on_first_rating();
```

- [ ] **Step 5: Run the database tests**

Run: `npx vitest run supabase/tests`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261111120000_shelve_on_first_rating.sql supabase/tests/writes.test.ts supabase/tests/bootstrap.test.ts
git commit -F - <<'EOF'
Move a new arrival to the shelf on its first rating, and test the write paths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Backend write calls (real and fake)

**Files:**
- Modify: `src/data/rowMapping.ts`, `src/data/backend.ts`, `src/data/supabaseBackend.ts`, `src/test/fakeBackend.ts`
- Test: `src/data/rowMapping.test.ts`, `src/data/supabaseBackend.test.ts`, `src/test/fakeBackend.test.ts`

**Interfaces:**
- Consumes: `RecordRow`, `recordToRow`, `ShelfRecord`, `BackendError`, `NO_SIGNAL`.
- Produces:
  - `rowMapping.ts`:
    - `export const EDITABLE_FIELDS` (the camelCase names of the columns in the `grant update (…)` list, minus `updatedAt`)
    - `type NewRecordRow = Omit<RecordRow, 'created_at' | 'updated_at'>`
    - `type RecordPatchRow = Partial<RecordRow>`
    - `newRecordToRow(r: ShelfRecord): NewRecordRow`
    - `patchToRow(fields: Partial<ShelfRecord>): RecordPatchRow`, which throws `Error('Not an editable field: <name>')` for anything outside `EDITABLE_FIELDS`
  - `backend.ts`:
    ```ts
    export interface ShelfWriter {
      insertRecord(row: NewRecordRow): Promise<'inserted' | 'already-there'>;
      patchRecord(id: string, fields: RecordPatchRow): Promise<'patched' | 'missing'>;
      setRating(recordId: string, userId: string, value: number): Promise<void>;
    }
    export interface Backend extends ShelfSource, ShelfWriter { /* existing members */ }
    export const REJECTED: { missing: string; permission: string; range: string; unknownValue: string; other: (code: string) => string };
    ```
    The copy is in Global Constraints.
  - `supabaseBackend.ts`: `export function rejectionReason(e: { code?: string; message: string }): string`. Mapping:
    - `42501`, or a message matching `/row-level security|permission denied/` → `permission`
    - `23514` → `range`
    - `22P02` → `unknownValue`
    - `23503` → `missing`
    - otherwise `other(code ?? 'unknown')`
  - `FakeBackend`: public `loseNextReply = false`, `rejectNext: string | null = null`, and test helpers `recordRow(id): RecordRow | undefined`, `ratingRow(recordId, userId): RatingRow | undefined`.

- [ ] **Step 1: Write the failing tests**
  - **rowMapping:**
    - `patchToRow({ discGrade: 'VG+', pricePaid: 15 })` equals `{ disc_grade: 'VG+', price_paid: 15 }`;
    - `patchToRow({ addedBy: 'x' } as never)` throws `/Not an editable field: addedBy/`;
    - `newRecordToRow` has no `created_at` or `updated_at` keys.
  - **supabaseBackend** (extend the existing mocked-client style):
    - `insertRecord` resolves `'inserted'`; it resolves `'already-there'` on `{ code: '23505' }`; it throws `BackendError(NO_SIGNAL)` on `{ message: 'Failed to fetch' }`; it throws `BackendError(REJECTED.permission)` on `{ code: '42501', message: 'permission denied for table records' }`.
    - `patchRecord` calls `.update(fields).eq('id', id).select('id')`; `[]` → `'missing'`; `[{ id }]` → `'patched'`.
    - `setRating`: an update returning `[]` is followed by `insert({ record_id, user_id, value })`; an insert failing with `23505` is followed by a second update; it never calls `upsert` (the mock has no `upsert`).
    - `rejectionReason({ code: 'XX000', message: 'boom' })` is `'The shelf refused this change. (XX000)'`.
  - **FakeBackend:**
    - after `insertRecord`, `recordRow(id)` has an `updated_at`;
    - a second `insertRecord` with the same id → `'already-there'`;
    - `patchRecord` on an unknown id → `'missing'`;
    - `setRating` on a `new_arrival` makes `recordRow(id).status === 'owned'` (mirrors the trigger), while changing an existing rating doesn't;
    - with `loseNextReply = true`, `insertRecord` stores the row **and** throws `NO_SIGNAL`, then `loseNextReply` is false again;
    - with `rejectNext = REJECTED.permission`, the call throws that message, stores nothing, and resets `rejectNext` to null;
    - with `online = false`, all three throw `NO_SIGNAL`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/data/rowMapping.test.ts src/data/supabaseBackend.test.ts src/test/fakeBackend.test.ts`
Expected: FAIL (functions not defined).

- [ ] **Step 3: Implement.** `supabaseBackend` writes:
  - Offline-looking errors throw `NO_SIGNAL` (reuse `offlineLooking`).
  - Every other error throws `new BackendError(rejectionReason(error))`.
  - The fake stamps `updated_at` with a strictly increasing ISO time.

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run && npx tsc -b`
Expected: all pass. `App.test.tsx` and the other users of `FakeBackend` still compile, because `FakeBackend implements Backend`.

- [ ] **Step 5: Commit** (`Add record and rating writes to the Backend, with a fault-injecting fake`)

---

### Task 3: The outbox table and `applyPostcard`

**Files:**
- Create: `src/data/outbox.ts`, `src/data/outbox.test.ts`
- Modify: `src/data/db.ts` (Dexie version 3; `clearPhone`), `src/data/db.test.ts`

**Interfaces:**
- Consumes: `ShelfDB`, `RecordSchema`, `ShelfRecord`, `BackendError`.
- Produces (`outbox.ts`):
  ```ts
  type Base = { seq: number; shelfId: string; recordId: string; userId: string; createdAt: string; state: 'waiting' | 'rejected'; reason: string | null };
  export type Postcard =
    | (Base & { kind: 'record.create'; fields: ShelfRecord })
    | (Base & { kind: 'record.patch'; fields: Partial<ShelfRecord> })
    | (Base & { kind: 'rating.set'; fields: { value: number } });
  type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
  export type NewPostcard = DistributiveOmit<Postcard, 'seq' | 'state' | 'reason'>;
  /** Call inside a rw transaction over records + ratings. Validates the resulting record with RecordSchema; throws BackendError on failure. */
  export async function applyPostcard(db: ShelfDB, p: NewPostcard | Postcard): Promise<void>;
  /** One transaction over records, ratings, outbox: apply each, then add each with state 'waiting'. Then ensureStorageKept. */
  export async function savePostcards(db: ShelfDB, postcards: NewPostcard[]): Promise<void>;
  export async function ensureStorageKept(db: ShelfDB, storage?: { persist(): Promise<boolean> }): Promise<boolean>;
  export async function storageKept(db: ShelfDB): Promise<boolean | null>; // meta 'storagePersisted'
  ```
- `db.ts`:
  - `outbox!: EntityTable<Postcard, 'seq'>`;
  - `this.version(3).stores({ …v2 stores…, outbox: '++seq, recordId, state' })` (no upgrade function needed);
  - `clearPhone` also clears `outbox`.

- [ ] **Step 1: Write the failing tests** (`outbox.test.ts`; use a fresh `new ShelfDB('outbox-test-' + crypto.randomUUID())` per test, and a `ShelfRecord` fixture factory):
  - `record.create puts the record when it is missing` / `…and leaves an existing record alone` (the re-apply case).
  - `record.patch merges only the given fields` / `record.patch on a missing record changes nothing`.
  - `rating.set stores my rating with the postcard’s createdAt as updatedAt`.
  - `rating.set moves a new arrival to owned`; `rating.set leaves owned and wanted as they were`.
  - `a patch that breaks the record rules throws and writes nothing` (`{ artist: '' }` → rejects `BackendError`).
  - `savePostcards is all or nothing`: `[valid patch, invalid patch]` → rejects, and neither the record nor the outbox changed.
  - `savePostcards queues postcards in order with state waiting`.
  - `ensureStorageKept asks once and remembers`: a stub `persist` called once across two calls; `storageKept` → true. With no storage argument and no `navigator.storage` → stores and returns false.
  - In `db.test.ts`: `clearPhone empties the outbox too`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/data/outbox.test.ts src/data/db.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `db.ts` v3 and `outbox.ts`. `ensureStorageKept` defaults to `globalThis.navigator?.storage`, and skips asking when meta already has `storagePersisted`.

- [ ] **Step 4: Run the tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add the outbox: postcards saved with the notebook in one transaction`)

---

### Task 4: The courier: push, then pull with re-apply

**Files:**
- Create: `src/data/courier.ts`, `src/data/courier.test.ts`
- Modify: `src/data/sync.ts`, `src/data/sync.test.ts`

**Interfaces:**
- Consumes: `Postcard`, `applyPostcard` (Task 3); `ShelfWriter`, `REJECTED`, `NO_SIGNAL` (Task 2); `newRecordToRow`, `patchToRow`; `pullShelf`.
- Produces:
  ```ts
  export type PushResult = { sent: number; rejected: number; noSignal: boolean };
  export async function pushOutbox(db: ShelfDB, writer: ShelfWriter): Promise<PushResult>;
  /** Push; then, unless the push stopped for no signal, pull. Pull errors are thrown. */
  export async function syncOnce(db: ShelfDB, backend: ShelfSource & ShelfWriter, shelfId: string): Promise<PushResult>;
  export async function retryPostcard(db: ShelfDB, seq: number): Promise<void>;
  /** Delete this postcard and every later one for the same record, forget the last pull, pull everything. */
  export async function discardPostcard(db: ShelfDB, source: ShelfSource, shelfId: string, seq: number): Promise<void>;
  // sync.ts
  export async function forgetLastPull(db: ShelfDB, shelfId: string): Promise<void>;
  ```
- **Push rules** (spec §4.3):
  - Walk the `waiting` postcards in `seq` order.
  - A record is **blocked** if any `rejected` postcard has its `recordId`, including ones rejected earlier in the same run. Skip waiting postcards for blocked records.
  - Calls by kind: create → `insertRecord(newRecordToRow(fields))`; patch → `patchRecord(recordId, patchToRow(fields))`; rating → `setRating(recordId, userId, value)`.
  - `'missing'` → reject with `REJECTED.missing`.
  - Success (including `'already-there'`) → delete the postcard.
  - `BackendError` with `NO_SIGNAL` → `noSignal: true`, stop.
  - Any other error → `state: 'rejected'`, `reason: message`.
- **Pull change:** inside `pullShelf`'s existing transaction (add `db.outbox` to its table list), after the ratings and members are written, re-apply every outbox postcard (both states) in `seq` order with `applyPostcard`.

- [ ] **Step 1: Write the failing tests** (`courier.test.ts`, using `FakeBackend` with an empty shelf plus a fixture record, and a fresh `ShelfDB`):
  - `sends postcards in order`: a create then a patch of the same record → the fake's row has the patched value; the outbox is empty; `{ sent: 2, rejected: 0, noSignal: false }`.
  - `stops and keeps everything when there is no signal`.
  - `a lost reply is resent without a duplicate`: `loseNextReply` on the create; run 1 → `noSignal`; run 2 → sent; the fake holds one row. Repeat for `rating.set`: one rating row.
  - `a rejection holds later postcards for that record only`: `rejectNext` on record A's create; A's later patch stays `waiting`; record B's postcard is sent; A's create is `rejected` with the reason.
  - `retryPostcard sends it on the next run`.
  - `discardPostcard drops it and the record’s later postcards, then matches the server`: a local patch is reverted in the notebook; another record's postcards are untouched.
  - `syncOnce skips the pull when there is no signal` (the fake's `recordsSince` is not called: spy on it).
  - In `sync.test.ts`:
    - `a pull keeps my waiting patch on top` (the server has `discGrade: 'NM'`, the outbox patch has `'VG+'` → the notebook shows `'VG+'` after the pull);
    - `a pull keeps my waiting rating and its shelf move` (the server says `new_arrival` with no rating; the outbox has `rating.set` → the notebook is `owned` with my rating).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/data/courier.test.ts src/data/sync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `courier.ts` and the `sync.ts` changes.

- [ ] **Step 4: Run the tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add the courier: send postcards safely, then pull and re-apply unsent changes`)

---

### Task 5: Run the courier from `useSync`, and the header notice

**Files:**
- Modify: `src/data/useSync.ts`, `src/app/SyncContext.tsx`, `src/data/hooks.ts`, `src/app/App.tsx` (prop name), plus any other reader of the old `error` field (`grep -rn "useSyncStatus" src`)
- Create: `src/data/useSync.test.tsx`, `src/app/SyncNotice.test.tsx`

**Interfaces:**
- Consumes: `syncOnce`, `retryPostcard`, `discardPostcard` (Task 4); `RowError`; `BackendError`, `NO_SIGNAL`.
- Produces:
  ```ts
  export type SyncProblem = { kind: 'no-signal' } | { kind: 'failed'; message: string };
  export type SyncStatus = { lastSyncedAt: string | null; problem: SyncProblem | null };
  export function describeSyncError(e: unknown): SyncProblem; // NO_SIGNAL → no-signal; RowError → failed with "The shelf sent something this app can’t read: {problems[0]}"; /permission denied/ → failed with the access copy; else failed with e.message
  export function useSync(backend: ShelfSource & ShelfWriter, shelfId: string, database?: ShelfDB): SyncStatus & { runNow(): void };
  // SyncContext
  export function SyncProvider(props: { backend: ShelfSource & ShelfWriter; shelfId: string; children: ReactNode }): JSX.Element;
  export function useSyncStatus(): SyncStatus & { runNow(): void; retry(seq: number): Promise<void>; discard(seq: number): Promise<void> };
  // hooks.ts
  export function useOutbox(): Postcard[] | undefined; // all postcards, seq order
  ```
- `useSync` keeps Plan 2's triggers (open, `online`, `visibilitychange`, every 60 s while visible) and the single-run guard; `runNow` uses the same guard. If a run is already going, it sets a flag that runs once more afterwards, so an action taken mid-run still sends.
- **`SyncNotice`** renders up to two lines (`role="status"`):
  1. Rejected postcards → the rejected copy with the oldest one's reason, plus `Try again` / `Discard` buttons (acting on that oldest one).
  2. Waiting count > 0 → the waiting copy (calm `text-ink-muted`). Otherwise, a `problem` → the no-signal or failure copy.

- [ ] **Step 1: Write the failing tests**
  - **`useSync.test.tsx`** (`renderHook`, FakeBackend, fresh db):
    - `syncs on mount`;
    - `syncs again when the phone comes back online` (dispatch `online`);
    - `runNow sends a waiting postcard`;
    - `reports no-signal and failures differently` (fake `online = false` → `{ kind: 'no-signal' }`; a `recordsSince` that returns `[{ id: 'bad' }]` → `kind: 'failed'` with a message starting `The shelf sent something this app can’t read:`).
  - **`SyncNotice.test.tsx`:**
    - one waiting postcard → `Saved on this phone · 1 waiting to send`;
    - a rejected postcard with reason R → `1 change couldn’t be saved: R`, and clicking `Try again` / `Discard` calls `retry(seq)` / `discard(seq)` (provide the context value directly);
    - no-signal with nothing waiting → `Couldn’t reach the shelf. Showing what’s on this phone.`

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** Rename `SyncProvider`'s `source` prop to `backend` and update `App.tsx`.

- [ ] **Step 4: Run all tests and the type check.** Expected: all pass, including the existing `App.test.tsx`.

- [ ] **Step 5: Commit** (`Run the courier on every sync, and show waiting and rejected changes`)

---

### Task 6: Actions

**Files:**
- Create: `src/data/actions.ts`, `src/data/actions.test.ts`

**Interfaces:**
- Consumes: `NewPostcard`, `savePostcards` (Task 3); `ShelfRecord`, `RecordSchema`; `Grade`; `GenreKey`; `BackendError`.
- Produces:
  ```ts
  export type Ctx = { me: string; now: string };
  export type ActionResult = { postcards: NewPostcard[]; undo: NewPostcard[] | null };
  export type NewBuy = { artist: string; title: string; genre: GenreKey; grade: Grade; pricePaid: number | null };
  export function buyKind(r: ShelfRecord): 'want' | 'upgrade' | null;
  export function boughtIt(r: ShelfRecord, input: { grade: Grade; pricePaid: number | null }, ctx: Ctx): ActionResult;
  export function boughtNew(input: NewBuy, ctx: Ctx & { shelfId: string; newId: string }): ActionResult;
  export function didntBuyIt(r: ShelfRecord, ctx: Ctx): ActionResult;
  export function rate(r: ShelfRecord, value: number, ctx: Ctx): ActionResult;
  export async function perform(db: ShelfDB, postcards: NewPostcard[], after?: () => void): Promise<void>; // savePostcards, then after()
  ```
- The fields per action are exactly spec §5's table:
  - Every postcard's `createdAt` is `ctx.now`, and `userId` is `ctx.me`.
  - Undo postcards carry the record's previous values for the same fields; for `boughtNew` the undo is `{ deletedAt: now }`.
  - `boughtNew` trims artist and title, sets every other field to null or false, `createdAt` and `updatedAt` to `now`, and checks the result with `RecordSchema`. On failure it throws `BackendError` naming the field.
- **Refusals** (`BackendError`):
  - `boughtIt` when `buyKind` is null → `Bought it is only for records on the want list or marked for an upgrade.`
  - `didntBuyIt` when not `new_arrival` → `Only new arrivals can be removed this way.`
  - `rate` when `wanted` → `You can rate records you’ve bought.`
  - `rate` when the value isn't an integer 1–5 → `A rating is 1 to 5.`

- [ ] **Step 1: Write the failing tests**
  - `buyKind`: `wanted` → `'want'`; `owned` + `wantsUpgrade` → `'upgrade'`; `owned` → null; `new_arrival` → null.
  - `boughtIt on a want`: one `record.patch` with exactly `{ status: 'new_arrival', boughtAt: now, discGrade: 'VG+', pricePaid: 15 }`; the undo patch restores `{ status: 'wanted', boughtAt: null, discGrade: <old>, pricePaid: <old> }`.
  - `boughtIt on an upgrade`: patch `{ discGrade, sleeveGrade: null, pricePaid, boughtAt, wantsUpgrade: false, upgradeNote: null }`; no `status` key; the undo restores all six.
  - `buying the same want twice is refused`: apply the patch to the record, then call `boughtIt` again → throws (Review Focus 1, logic side).
  - `boughtNew`: one `record.create` whose `fields.id === newId`, `status: 'new_arrival'`, `addedBy: me`, artist trimmed; the undo is `[{ kind: 'record.patch', fields: { deletedAt: now } }]`. `boughtNew` with title `'  '` throws `/title/`.
  - `didntBuyIt`: patch `{ deletedAt: now }`, undo null; on `owned` it throws.
  - `rate`: `rating.set { value: 4 }` with `recordId`; undo null; on `wanted` it throws; with `0` or `6` it throws.
  - `undo after the purchase reached the server reverses it there` (Review Focus 2): with a FakeBackend and fresh db, `perform` a `boughtNew`, run `pushOutbox`, `perform` the undo, run `pushOutbox` → `fake.recordRow(id).deleted_at` is set. The same for `boughtIt` on a want → the server row is `status: 'wanted'`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement** `actions.ts`.

- [ ] **Step 4: Run the tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add the actions: Bought it, Undo, Didn’t buy it and Rate as pure functions`)

---

### Task 7: Signing out and reopening without losing changes

**Files:**
- Create: `src/ui/ConfirmDialog.tsx`
- Modify: `src/app/useSession.ts`, `src/app/App.tsx`, `src/app/CurrentShelf.tsx`, `src/screens/SettingsScreen.tsx`
- Test: `src/app/App.test.tsx`, `src/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `pushOutbox` (Task 4); `storageKept` (Task 3); `clearPhone`; `BackendError`, `NO_SIGNAL`.
- Produces:
  - `ConfirmDialog({ open, message, confirmLabel, cancelLabel, danger: 'confirm' | 'cancel', onConfirm, onCancel })`, built on `AlertDialog` from `radix-ui`. Both buttons are ≥ 48px. The danger button uses the brick colour; the other is the primary bourbon button.
  - `Session` gains `{ state: 'previous-unsent'; user: SignedIn; count: number }`.
  - `useSession` returns:
    - `signOut(): Promise<{ unsent: number } | null>`: runs `pushOutbox` first; if postcards remain, it returns their count and does **not** sign out; otherwise it signs out as today and returns null.
    - `signOutAndDelete(): Promise<void>`: today's sign-out.
    - `continueAndDelete(): Promise<void>`: clears the phone, then settles the new person.
    - `goBack(): Promise<void>`: `backend.signOut()` (errors ignored), keeps the notebook, then `signed-out`.
  - `CurrentShelf` gets `signOut` and `signOutAndDelete` with these types.
- **Behaviour changes:**
  - `start()` with no user: `clearPhone` only when the outbox is empty; otherwise keep everything.
  - `settle()`: if the remembered `userId` differs and the outbox is non-empty → `previous-unsent` (`App` shows a `ConfirmDialog` with the previous-person copy).
  - `settle()` catch: fall back to the phone's copy **only** when the error is `BackendError` with `NO_SIGNAL`; otherwise use the `error` state.
  - `SettingsScreen`: Sign out calls `signOut()`; a non-null result opens the sign-out `ConfirmDialog`. It shows the storage line when `storageKept(db) === false`.

- [ ] **Step 1: Write the failing tests** (seed the outbox with `savePostcards` and a patch on a collection record):
  - `sign out sends waiting changes first, then signs out` (online fake → the outbox is empty, the sign-in screen shows).
  - `sign out offline with a change waiting asks first, and Stay signed in keeps it` (dialog text `1 change hasn’t reached the shelf yet. Signing out deletes it.`; after `Stay signed in`, the settings screen is still showing and the outbox has 1).
  - `Sign out and delete clears the phone` (outbox and records empty, sign-in shows).
  - `opening with no session keeps waiting changes, and sends them when the same person signs back in`.
  - `a different person signing in is warned; Go back keeps the changes; Continue and delete clears them`.
  - `a server failure while opening shows the error, not the phone’s copy` (the fake's `bootstrap` throws `BackendError('Couldn’t open your shelf: boom')` → `Couldn’t open your shelf` heading).
  - In `SettingsScreen.test.tsx`: `shows the storage warning when the phone may clear changes`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run all tests and the type check.** Expected: all pass (existing sign-out tests still pass).

- [ ] **Step 5: Commit** (`Never lose unsent changes on sign-out or when a sign-in expires`)

---

### Task 8: The poster

**Files:**
- Modify: `src/domain/search.ts`, `src/domain/search.test.ts`, `src/index.css`
- Create: `src/domain/poster.ts`, `src/domain/poster.test.ts`, `src/ui/Poster.tsx`, `src/ui/Poster.test.tsx`

**Interfaces:**
- Consumes: `GenreKey`.
- Produces:
  ```ts
  export type PosterRole = 'genre' | 'accent' | 'sky' | 'window';
  export type PosterShape =
    | { type: 'circle'; role: PosterRole; cx: number; cy: number; r: number; fill: string }
    | { type: 'rect'; role: PosterRole; x: number; y: number; w: number; h: number; fill: string };
  export type PosterPlan = { shapes: PosterShape[]; artist: { text: string; size: number }; title: string };
  export function posterSeed(artist: string, title: string): number;
  export function posterPlan(artist: string, title: string, genre: GenreKey): PosterPlan;
  export function Poster(props: { artist: string; title: string; genre: GenreKey; className?: string }): JSX.Element;
  ```
- **Colours are CSS variables, not hex.** `fill` values are strings like `var(--genre-jazz)` and `var(--brick)`, so the same markup follows the theme by itself. (This refines spec §7's `theme` prop: no prop is needed.) Add one token to `src/index.css`: `--poster-sky: var(--ink)` in `:root` and `--poster-sky: var(--surface-sunk)` in `[data-theme="midnight"]`. Ground `var(--surface)`, band `var(--ink)`, band text `var(--surface)`.
- **`normalise`** (shared with search): NFKD → strip `\p{M}` → lowercase → `[^\p{L}\p{N}]+` → space → trim.
- **Seed:** FNV-1a 32-bit over `normalise(artist) + '|' + normalise(title)` (offset 2166136261, prime 16777619, `Math.imul`, `>>> 0`). The random numbers come from mulberry32 seeded with it.
- **Composition** on a 300 × 300 grid, cell = 50, drawing random numbers `r()` in this order. This order is the contract the determinism test pins; the proportions match the brainstorm mockup.
  1. **Accents:** from `['bourbon', 'brick', 'teal']`, remove `brick` for `rock` and `bourbon` for `popsoul`; shuffle with `r()`; take the first two → `A1`, `A2`.
  2. **Genre circle:** `r = cell × (1.4 + r()×0.9)`, `cx = cell × (1 + ⌊r()×4⌋)`, `cy = cell × (1 + ⌊r()×2⌋)`.
  3. **Accent square** `A1`: side `cell × (1 + ⌊r()×2⌋)`, `x = cell × ⌊r()×5⌋`, `y = cell × ⌊r()×3⌋`.
  4. **Second accent** `A2`: if `r() < 0.5`, a circle (`cx = cell×(1+⌊r()×5⌋)`, `cy = cell×(1+⌊r()×2⌋)`, `r = cell×(0.4+r()×0.5)`); otherwise a bar (`x = cell×⌊r()×5⌋`, `y = cell×(1+⌊r()×2⌋)`, `w = 100`, `h = 25`).
  5. **Skyline:** from `x = 0` while `x < 300`: `w = 16+⌊r()×30⌋`, `h = 30+⌊r()×75⌋`, a rect at `(x, 232−h)` in `var(--poster-sky)`. If `r() < 0.6`, a 4×5 window in `var(--bourbon)` at `(x+5, 232−h+8+⌊r()×20⌋)`. Then `x += w + 2 + ⌊r()×4⌋`.
  6. **Band:** a rect `(0, 232, 300, 68)` in `var(--ink)`.
  7. **Artist:** uppercase, `size = clamp(18, 40, 276 / (len × 0.43))`. If `len × 0.43 × 18 > 276`, truncate to 34 characters + `…`. **Title:** truncated to 39 characters + `…` when longer than 40.
- **`Poster` rendering:**
  - `<svg viewBox="0 0 300 300" role="img" aria-label="Poster for {artist}, {title}">` with the shapes;
  - the artist as `<text x=12 y≈262 font-family="var(--font-display)">`;
  - the title as `<text x=12 y=289 font-size=12>` in `var(--surface)`.

- [ ] **Step 1: Write the failing tests**
  - **`search.test.ts`:**
    - `normalise('Mötley Crüe') === 'motley crue'`;
    - `normalise('Røyksopp') === 'røyksopp'`;
    - `normalise('Sigur Rós – Ágætis byrjun') === 'sigur ros agaetis byrjun'`;
    - `normalise('Straße') === 'straße'`;
    - the existing search tests are unchanged and still pass.
  - **`poster.test.ts`:**
    - `the same words draw the same poster` (deep-equal across two calls, and across case/accents/punctuation differences: `('John Coltrane', 'Ballads')` vs `('john coltrane!', 'ballads')`);
    - `different titles draw different posters`;
    - `rock never gets a brick accent` and `pop/soul never gets a bourbon accent` (over 200 generated `artist N`/`title N` pairs, no `role: 'accent'` shape has that fill);
    - `the genre circle uses the genre colour` (`var(--genre-reggae)`);
    - `a very long artist name stays inside the band` (Review Focus 5): a 60-character artist → `size === 18`, `text.length === 35`, ending in `…`;
    - `a long title is cut at 40`.
  - **`Poster.test.tsx`:** it has the `Poster for John Coltrane, Ballads` image label, and rendering twice gives identical `innerHTML`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement** `normalise`, `poster.ts` and `Poster.tsx`, and add the `--poster-sky` tokens.

- [ ] **Step 4: Run all tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add the generative poster, and let search keep letters from any alphabet`)

---

### Task 9: The Record screen (reading) and the new routes

**Files:**
- Create: `src/screens/RecordScreen.tsx`, `src/screens/RecordScreen.test.tsx`, `src/app/routes.test.ts`
- Modify:
  - `src/app/App.tsx` (route `/record/:id`, theme list)
  - `src/data/hooks.ts`
  - `src/ui/SpineRow.tsx`, `src/ui/SpineRow.test.tsx`
  - `src/screens/ShelfScreen.tsx`
  - `src/screens/PriceCheckScreen.tsx` (new `useRecord` signature)

**Interfaces:**
- Consumes: `Poster` (Task 8); `useMembers`; `RatingDots`; `StatusTag`/`collectionTag`; `GENRE_LABELS`; `formatMoney` (defined here, in `src/domain/price.ts`: `formatMoney(n: number): string`, with a test in `price.test.ts`); `SyncNotice`.
- Produces:
  - `export function isShowPath(pathname: string): boolean` (in `App.tsx` or `src/app/routes.ts`): `/show` or starting with `/price/`.
  - `useRecord(shelfId: string, id: string | undefined): ShelfRecord | null | undefined`: null when it's on another shelf or `deletedAt` is set.
  - `useRatings(recordId: string): Rating[] | undefined`.
  - `RecordScreen` at `/record/:id`, laid out as in spec §6.4 items 1–9.
    - Rating (item 6) is shown read-only for now with `<RatingDots value={mine} />`. Task 10 makes it tappable.
    - Back: `navigate(-1)` when `location.key !== 'default'`, else `navigate('/')`.
    - A missing record shows `That record isn’t on this phone.`
    - `SyncNotice` sits under the back link (spec §6.7).
- `SpineRow` with `onOpen` gets `aria-label="{artist}, {title}"`. `ShelfScreen` rows open `/record/:id`.

- [ ] **Step 1: Write the failing tests**
  - `routes.test.ts`: `isShowPath` → true for `/show` and `/price/abc`; false for `/`, `/arrivals`, `/record/abc`, `/settings`.
  - `price.test.ts`: `formatMoney(15) === '$15'`, `formatMoney(15.5) === '$15.50'`.
  - `RecordScreen.test.tsx` (render inside `CurrentShelfProvider` + `MemoryRouter`, seed Dexie directly, one other member `Megan`):
    - shows the poster label, artist, title, the meta line `1966 · Impulse!`;
    - `Disc` `Sealed` with sleeve `not graded`;
    - `Megan · Unplayed`;
    - `Paid $15` when `pricePaid` is 15 (and no `Paid` line when null);
    - a record on another shelf or soft-deleted → `That record isn’t on this phone.`
  - `SpineRow.test.tsx`: an openable row's accessible name is `John Coltrane, Ascension`.
  - `App.test.tsx`: tapping a shelf row opens its Record screen, and `document.documentElement.dataset.theme === 'midnight'` there.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run all tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add the Record screen with the poster, both ratings and grades`)

---

### Task 10: Rating and Didn't buy it on the Record screen

**Files:**
- Create: `src/ui/RatingRecords.tsx`, `src/ui/RatingRecords.test.tsx`
- Modify: `src/screens/RecordScreen.tsx`, `src/screens/RecordScreen.test.tsx`

**Interfaces:**
- Consumes: `rate`, `didntBuyIt`, `perform` (Task 6); `useSyncStatus().runNow` (Task 5); `ConfirmDialog` (Task 7); `RATING_WORDS`, `GENRE_LABELS`.
- Produces:
  - `RatingRecords({ value, onRate }: { value: number | undefined; onRate: (v: number) => void })`:
    - `role="radiogroup"` with `aria-label="Your rating"`;
    - five `role="radio"` buttons, ≥ 48px, accessible name `{n} of 5, {RATING_WORDS[n]}`, `aria-checked` on the current value;
    - each drawn as a record (an outer disc, and a label dot that is bourbon when filled).
  - On the Record screen:
    - **Rating** is shown only for `new_arrival` and `owned`. On rate: `perform(db, rate(...).postcards, runNow)`, then show `{word} · On the shelf · {GENRE_LABELS[genre]}` if the record was `new_arrival` before, else `{word}`.
    - **`Didn’t buy it`** shows only on `new_arrival`. It opens a `ConfirmDialog`; `Remove it` → `perform(db, didntBuyIt(record, ctx).postcards, runNow)` → `navigate('/arrivals')`.

- [ ] **Step 1: Write the failing tests**
  - `RatingRecords.test.tsx`: five radios with names `1 of 5, Not for me` … `5 of 5, Desert island`; clicking the 4th calls `onRate(4)`.
  - `RecordScreen.test.tsx`:
    - `rating a new arrival puts it on the shelf`: after clicking `4 of 5, Love it`, the text `Love it · On the shelf · Jazz / big band` shows, the Dexie record `status === 'owned'`, and the outbox holds one `rating.set`;
    - `changing a rating on a shelved record just confirms the word` (`Good`);
    - `a want has no rating control`;
    - `Didn’t buy it asks first` (the dialog text `Remove Moanin’ from New arrivals?`); `Keep it` changes nothing; `Remove it` sets `deletedAt` and lands on `/arrivals`;
    - `Didn’t buy it is not offered on shelved records`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run all tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Rate on the Record screen, and take back a purchase with Didn’t buy it`)

---

### Task 11: New arrivals: the pile row and the screen

**Files:**
- Create: `src/ui/PileRow.tsx`, `src/ui/PileRow.test.tsx`, `src/screens/ArrivalsScreen.tsx`, `src/screens/ArrivalsScreen.test.tsx`
- Modify: `src/screens/ShelfScreen.tsx`, `src/app/App.tsx` (route `/arrivals`), `src/domain/shelf.ts`, `src/domain/shelf.test.ts`

**Interfaces:**
- Consumes: `useShelfItems`, `spineColor`, `SpineRow`, `SyncNotice`.
- Produces:
  - `export function newArrivals<T extends { record: ShelfLike & { boughtAt: string | null } }>(items: T[]): T[]`: only `new_arrival`, newest `boughtAt` first, nulls last.
  - `PileRow({ records, onOpen }: { records: ShelfRecord[]; onOpen: () => void })`: renders nothing when empty. Otherwise a button with the accessible name `New arrivals, {n} waiting`, up to 3 genre bars (`spineColor(r, 'all')`), the text `New arrivals · {n}`, and the artists joined with `, ` (CSS-truncated). It's a raised rounded panel (`bg-surface-raised rounded-lg`).
  - `ArrivalsScreen` at `/arrivals`: a back link to `/`, the heading `New arrivals`, `SyncNotice`, spine rows opening `/record/:id`, and the empty copy.
  - `ShelfScreen`: renders `PileRow` between the search row and the spines, opening `/arrivals`.

- [ ] **Step 1: Write the failing tests**
  - `shelf.test.ts`: `newArrivals` keeps only new arrivals, newest first, nulls last.
  - `PileRow.test.tsx`: renders nothing for `[]`; for two records, shows `New arrivals · 2` and the name `New arrivals, 2 waiting`.
  - `ArrivalsScreen.test.tsx`: lists newest first; the empty copy shows when there are none; a row opens its Record screen.
  - `App.test.tsx`: `the pile appears with a new arrival and goes once it is rated` (seed a `new_arrival`, open it via the pile, rate it, go back to `/` → no pile row).

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run all tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add New arrivals: the pile on the shelf and its own screen`)

---

### Task 12: Bought it on the price check, and Undo

**Files:**
- Create: `src/app/UndoContext.tsx`, `src/app/UndoContext.test.tsx`
- Modify: `src/domain/price.ts`, `src/domain/price.test.ts`, `src/ui/PriceCheck.tsx`, `src/ui/PriceCheck.test.tsx`, `src/screens/PriceCheckScreen.tsx`, `src/app/App.tsx`

**Interfaces:**
- Consumes: `buyKind`, `boughtIt`, `perform` (Task 6); `runNow` (Task 5); `formatMoney` (Task 9).
- Produces:
  - `price.ts`:
    - `parsePrice(raw: string): number | null`:
      - `''` → null; `'15'` → 15; `'$15'` → 15; `'15.5'` → 15.5;
      - `'15,50'` → 15.5;
      - `'1,200'` → 1200 (a comma followed by exactly three digits at the end is a thousands separator; any other comma is a decimal point);
      - rounded to cents.
    - `sanitizeAsking` moves from `PriceCheck.tsx` to `price.ts` and keeps digits plus at most one `.` or `,`.
  - `UndoContext`:
    - `UndoProvider`;
    - `useUndo(): { offer(label: string, undo: () => Promise<void>): void }`;
    - `UndoBar` (inside the provider, rendered once in `App` above the routes' bottom safe area).
    - `offer` replaces any current offer and hides it after 8000 ms. `Undo` runs it and hides the bar. Timers are cleared on unmount.
  - `PriceCheck` props: `{ record; buyable: boolean; onBought?: (input: { grade: Grade; pricePaid: number | null }) => Promise<void> }`.
    - When `buyable`, the asking box shows even without an estimate (the verdict still needs one), with `Bought it` and the `Logs …` line underneath.
    - The button is disabled while `onBought` is running.
    - The verdict uses `parsePrice(asking)`.
  - `PriceCheckScreen`: `buyable = buyKind(record) !== null`. `onBought` builds `boughtIt`, `perform`s it with `runNow`, then `offer(kind === 'want' ? 'In New arrivals' : 'Upgrade logged', () => perform(db, result.undo!, runNow))`.

- [ ] **Step 1: Write the failing tests**
  - `price.test.ts`:
    - every `parsePrice` case above (Review Focus 3);
    - `sanitizeAsking('15,5,0') === '15,50'`;
    - `sanitizeAsking('$1.2.3') === '1.23'`.
  - `UndoContext.test.tsx` (fake timers):
    - the bar shows the label and `Undo`;
    - `Undo` calls the function once and hides the bar;
    - the bar is gone after 8000 ms, and the function is not called.
  - `PriceCheck.test.tsx`:
    - not buyable → no `Bought it`;
    - buyable with no estimate → the asking box shows, with no verdict;
    - the line reads `Logs NM` with an empty box and `Logs VG+ · $15 paid` after picking VG+ and typing `15`.
  - `App.test.tsx` (seed a `wanted` record with an estimate):
    - `Bought it logs the grade and price and offers Undo`: the Dexie record becomes `new_arrival`, `discGrade 'VG+'`, `pricePaid 15`; the bar shows `In New arrivals`;
    - `Undo puts it back on the want list`;
    - `a double tap logs one purchase` (Review Focus 1): two quick clicks → one `record.patch` in the outbox;
    - `an owned record without an upgrade has no Bought it`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run all tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Log a purchase with one tap on the price check, with Undo`)

---

### Task 13: Bought it for a record you don't own

**Files:**
- Create: `src/ui/BuyNewSheet.tsx`, `src/ui/BuyNewSheet.test.tsx`, `src/screens/ShowScreen.test.tsx`
- Modify: `src/screens/ShowScreen.tsx`

**Interfaces:**
- Consumes: `boughtNew`, `perform`, `NewBuy` (Task 6); `GradePicker`; `Select` from `src/components/ui/select.tsx`; `GENRE_KEYS`, `GENRE_LABELS`; `sanitizeAsking`, `parsePrice` (Task 12); `useUndo` (Task 12); `runNow`.
- Produces:
  - `export const BuyNewFormSchema`: a Zod object over the form strings:
    - `artist`: trimmed, min 1, `Add the artist`;
    - `title`: trimmed, min 1, `Add the title`;
    - `genre`: `z.enum(GENRE_KEYS)`, `Choose a genre`;
    - `grade`;
    - `price`: the string run through `parsePrice`.
  - `BuyNewSheet({ open, initialArtist, onOpenChange, onSave }: { …; onSave: (buy: NewBuy) => Promise<void> })`:
    - a `Dialog` from `radix-ui`, styled as a bottom sheet (`rounded-t-2xl`, raised surface);
    - fields in the order Artist, Title, Genre (placeholder `Choose a genre`, no preselected value), Disc grade (`GradePicker part="Disc"`, default `NM`), Price paid (`inputMode="decimal"`, sanitized);
    - the submit button `Bought it` is disabled while saving;
    - errors are shown under each field with `aria-describedby`.
  - `ShowScreen`: with a non-empty query and no results, shows the copy plus a `Bought it` button that opens the sheet with `initialArtist = query.trim()`. `onSave` → `boughtNew(buy, { me, now, shelfId, newId: crypto.randomUUID() })` → `perform(…, runNow)` → `offer('In New arrivals', undo)` → close.

- [ ] **Step 1: Write the failing tests**
  - `BuyNewSheet.test.tsx`:
    - `prefills the artist from the search`;
    - `will not save without a title and a genre` (both errors show, `onSave` not called);
    - `saves trimmed values with the chosen grade and price` (`onSave` called with `{ artist: 'Art Blakey', title: 'Moanin’', genre: 'jazz', grade: 'VG+', pricePaid: 15.5 }` after typing `15,50`);
    - `a double tap saves once` (Review Focus 1; `onSave` is a slow promise, two clicks → one call).
  - `ShowScreen.test.tsx`: `buying a record you don’t own puts it in New arrivals`. Search `art blakey`, then `Bought it`, then fill the form and submit. The sheet closes, the search results now show the `New arrival` tag, and the Undo bar reads `In New arrivals`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run all tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Buy a record you don’t own at the show, from a short sheet`)

---

### Task 14: Go live and hand over

This task is run by the main session with Kahrman, not a subagent, because it touches production.

**Files:**
- Delete: `.github/workflows/keep-supabase-awake.yml`
- Modify: `docs/superpowers/notes/plan-2-handoff.md` (append a "Plan 3 → Plan 4 handoff" section)

- [ ] **Step 1: Remove the keep-awake job and record the handoff.**
  - Delete the workflow; `ping()` stays in the database.
  - Append to the handoff note: what Plan 4 must know (the open questions in spec §12, the GradePicker roving tabindex, the native search-clear colour, the bundle size) plus anything the final review finds.

- [ ] **Step 2: Full check**

Run: `npx vitest run && npx tsc -b && npm run build`
Expected: every test passes (well above the baseline of 129), there are no type errors, and the build succeeds.

- [ ] **Step 3: Final whole-branch review** (`superpowers:requesting-code-review`), checked against the spec and this plan's Review Focus. Fix what it finds, then commit.

- [ ] **Step 4: Ask Kahrman, then push the migration to production *before* the app ships.**

Run: `npx supabase db push` (linked project `rlhhrzkaosngafcoxaas`).
Expected: it applies `20261111120000_shelve_on_first_rating.sql`.

Why first: without the trigger, a rating sent from the new app leaves the server record as `new_arrival`, and the next pull would bounce it back into the pile.

- [ ] **Step 5: Add the Poster to the design system artifact** (https://claude.ai/artifact/MeqZFkmspRtmaUUaP2e7pK) with its rules from spec §7, after Kahrman OKs the update.

- [ ] **Step 6: Ask Kahrman, then merge `plan-3-bought-and-played` into `main` and push.** Vercel deploys.

- [ ] **Step 7: By hand on both phones (spec §10):**
  1. Airplane mode → search → Bought it (not in collection) → close the app.
  2. Reopen online → it sends → it appears on Megan's phone.
  3. Megan rates it → it's on Kahrman's shelf.
  4. Offline with a change waiting → Sign out → the dialog appears; `Stay signed in` keeps it.

Record the results in the handoff note and commit.
