# Plan 4a, Build 2a: Find a Record on Discogs, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Add screen, you type or say what a record is, tap the matching Discogs pressing, and it's saved to the shelf straight away, ready for the next one.

**Architecture:**
- **Server:** a Supabase Edge Function (`discogs-search`) holds the Discogs token, calls Discogs' search, and returns trimmed results. Its shaping logic lives in a plain-TypeScript `shape.ts` that Vitest can test.
- **Genre mapping:** a small table in the app (`discogsGenre.ts`) maps Discogs genres to a shelf section.
- **Saving:** a new pure action, `addFound`, saves the result through the existing outbox, with an Undo that soft-deletes.
- **Add screen:** search and results go on top; build 1's hand form folds away underneath.

**Tech Stack:** existing app stack, plus a Deno Edge Function (Supabase CLI deploy). No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-plan-4a-build-2a-discogs-lookup-design.md` (binding). Background: `2026-11-12-plan-4a-add-edit-delete-design.md`.

**Baseline:** branch `plan-4a-build-2a-discogs` (off `main` at `0d4c5b3`, plus the spec commit `da4cae0`). `npx vitest run` → 49 files / 415 tests; `npx tsc -b` clean.

## Global Constraints

- **Earlier plans still hold:**
  - screens reach the server only through `Backend`;
  - writes go through `perform` → `savePostcards`;
  - inputs ≥ 16px; tap targets ≥ 48px;
  - no emoji or exclamation marks in copy, and curly apostrophes;
  - every id is a uuid; fail loudly.
- **Discogs (spec §3):**
  - **Never store** search results or images: not in the notebook, not in localStorage, not on records. Thumbnails exist only in screen state.
  - Saved record fields are CC0 facts only.
  - The token lives only in the Supabase function secret `DISCOGS_TOKEN`. It's never in the app, git, tests or chat.
  - Every Discogs request sends `User-Agent: TheShelf/1.0 +https://the-shelf-sigma.vercel.app`.
  - Search URL: `https://api.discogs.com/database/search?q={query}&type=release&format=Vinyl&per_page=6`.
- **Saved record:** status `owned`, `discGrade` / `sleeveGrade` / rating null, and `discogsReleaseId` set.
- **Exact copy:**
  - placeholder `Artist and title, like mccoy tyner forces of nature`
  - button `Search`, and `Searching Discogs…` while busy
  - `Needs signal`
  - `Discogs didn’t find that. Try fewer words, or fill it in by hand.`
  - `Too many searches at once. Wait a minute and try again.`
  - `Discogs isn’t responding. Try again, or fill it in by hand.`
  - tag `Already on the shelf`
  - disclosure `Not here? Fill it in by hand`
  - Undo bar `On the shelf: {title}`
  - credit `Data provided by Discogs` (results: link to `https://www.discogs.com/search/?q={encoded query}&type=release`; Record screen: link to `https://www.discogs.com/release/{id}`; `target="_blank" rel="noopener"`, never `nofollow`)
  - Settings notice: `This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.`
- **Genre mapping** (spec §5):
  - any style containing `holiday` or `christmas` (case-insensitive) → `christmas`;
  - otherwise the first genre in the release's order among: `Jazz`→`jazz`, `Rock`→`rock`, `Funk / Soul`→`popsoul`, `Pop`→`popularpop`, `Folk, World, & Country`→`country`, `Reggae`→`reggae`, `Stage & Screen`→`soundtracks`;
  - otherwise `misc`.
- **Name clean-up:**
  - artist is the part of Discogs `title` before the first ` - `, and title is the part after it;
  - remove a trailing ` (\d+)` and a trailing `*` from the artist;
  - **`Various` → `Various Artists`**, to match how the collection was imported.
- **Timeouts:** the app's call to the function has its own **20 s** limit; everything else keeps 15 s.
- **Commits:** messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge to `main`, deploy functions, or set secrets without Kahrman's OK.

## Review Focus

1. **A Discogs title that itself contains ` - `** (e.g. `Miles Davis - Live - Evil`) splits on the first ` - ` only. Test: Task 1.
2. **A double tap on a result card** saves exactly one record. Test: Task 4.
3. **A second search started before the first returns:** results from the older search must never replace the newer ones. Test: Task 4.
4. **A query of spaces or one character** never calls the server; the Search button stays disabled. Tests: Task 2 and Task 4.
5. **A compilation (`Various - Trojan …`)** is saved as artist `Various Artists`, so the duplicate check matches the imported record. Test: Task 1.

## File Map

| File | Responsibility |
|---|---|
| `src/domain/discogsGenre.ts` | The genre mapping table and function |
| `supabase/functions/discogs-search/shape.ts` | Pure: Discogs JSON → `FoundRecord[]`, name clean-up, query check |
| `supabase/functions/discogs-search/index.ts` | Deno entry: CORS, token, Discogs call, error mapping |
| `src/data/backend.ts`, `src/data/supabaseBackend.ts`, `src/test/fakeBackend.ts` | `searchDiscogs` |
| `src/data/actions.ts` | `addFound` |
| `src/ui/FindRecord.tsx` | Search box, results, states |
| `src/screens/AddScreen.tsx` | Find on top, hand form folded |
| `src/screens/RecordScreen.tsx`, `src/screens/SettingsScreen.tsx` | Credit link and notice |

---

### Task 1: Pure pieces: genre table and result shaping

**Files:**
- Create: `src/domain/discogsGenre.ts`, `src/domain/discogsGenre.test.ts`, `supabase/functions/discogs-search/shape.ts`, `supabase/functions/discogs-search/shape.test.ts`
- Modify: `vite.config.ts` (`test.include` must also pick up `supabase/functions/**/*.test.ts`, if the default doesn't already)

**Interfaces:**
- Produces:
  ```ts
  // src/domain/discogsGenre.ts
  export const DISCOGS_GENRE_TO_SECTION: ReadonlyArray<readonly [string, GenreKey]>; // the table, in order
  export function sectionFor(genres: string[], styles: string[]): GenreKey;

  // supabase/functions/discogs-search/shape.ts (no Deno APIs, no imports from src/)
  export type FoundRecord = { releaseId: number; artist: string; title: string; label: string | null; catalog: string | null;
    year: number | null; format: string | null; country: string | null; genres: string[]; styles: string[]; thumb: string | null };
  export function cleanQuery(raw: unknown): string | null;      // trimmed, 2–200 chars, else null
  export function splitTitle(discogsTitle: string): { artist: string; title: string };
  export function shapeResults(json: unknown): FoundRecord[];     // at most 6; skips entries without id or ' - ' title
  ```
- There is one definition of `FoundRecord`, in `shape.ts`. Task 2's `backend.ts` re-exports it as a type only.
- **`shapeResults` rules:**
  - `label` = `label[0]`;
  - `catalog` = `catno`, unless it's `none` (case-insensitive) or empty;
  - `year` = integer 1900–2100, else null;
  - `format` = `format.join(', ')`, or null when empty;
  - `thumb` = `thumb` or `cover_image`, only if it starts with `https://`.

- [ ] **Step 1: Write the failing tests**
  - **`discogsGenre`:**
    - one case per table row;
    - `(['Pop'], ['Holiday'])` → `christmas`;
    - `(['Jazz', 'Funk / Soul'], [])` → `jazz`, and `(['Funk / Soul', 'Jazz'], [])` → `popsoul`;
    - `(['Electronic'], [])` → `misc`;
    - `([], [])` → `misc`.
  - **`shape`:**
    - `splitTitle('McCoy Tyner - Forces Of Nature (Live At Slugs\')')`;
    - `splitTitle('Miles Davis - Live - Evil')` → title `Live - Evil` (Review Focus 1);
    - `'Ahmad Jamal (2) - At The Pershing'` → artist `Ahmad Jamal`;
    - `'Sonny Rollins* - Way Out West'` → `Sonny Rollins`;
    - `'Various - Trojan Records'` → `Various Artists` (Review Focus 5);
    - `cleanQuery('  a ')` → null; `cleanQuery('ab')` → `'ab'`; `cleanQuery(42)` → null;
    - `shapeResults` on a saved fixture of 8 Discogs search results (put it in `supabase/functions/discogs-search/fixtures/search.json`, with realistic Discogs field names: `id`, `title`, `year`, `label`, `catno`, `format`, `country`, `genre`, `style`, `thumb`, `cover_image`) → 6 records, `catno: 'none'` → null, `year: '0'` → null, an `http://` thumb → null.

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/domain/discogsGenre.test.ts supabase/functions/discogs-search/shape.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the full suite and the type check.** Expected: green.

- [ ] **Step 5: Commit** (`Map Discogs genres to shelf sections, and shape Discogs search results`)

---

### Task 2: The `discogs-search` function and `Backend.searchDiscogs`

**Files:**
- Create: `supabase/functions/discogs-search/index.ts`
- Modify: `supabase/config.toml` (`[functions.discogs-search]` with `verify_jwt = true`), `src/data/backend.ts`, `src/data/supabaseBackend.ts`, `src/test/fakeBackend.ts`
- Test: `src/data/supabaseBackend.test.ts`, `src/test/fakeBackend.test.ts`

**Interfaces:**
- Consumes: `cleanQuery`, `shapeResults` (Task 1); `fetchWithTimeout`, `readConfig` (`src/data/supabase.ts`); `BackendError`, `NO_SIGNAL`.
- Produces:
  ```ts
  // backend.ts
  export type { FoundRecord } from '../../supabase/functions/discogs-search/shape'; // type-only, erased at build
  export const DISCOGS_MESSAGES: { rateLimited: string; down: string };   // copy from Global Constraints
  interface Backend { searchDiscogs(query: string): Promise<FoundRecord[]>; /* + existing */ }
  ```
- **`index.ts` (Deno):**
  - `Deno.serve`.
  - Answers `OPTIONS` with CORS headers (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`, `Access-Control-Allow-Methods: POST, OPTIONS`) on every response.
  - `POST` only. `cleanQuery(body.query)` null → 400 `{ error: 'bad-query' }`.
  - Fetches the search URL (Global Constraints) with `Authorization: Discogs token=${Deno.env.get('DISCOGS_TOKEN')}` and the User-Agent.
  - Outcomes:
    - Discogs 429 → 429 `{ error: 'rate-limited' }`;
    - any other non-OK, a missing token, or a throw → 502 `{ error: 'discogs-down' }`;
    - OK → 200 `{ results: shapeResults(json) }`.
  - Supabase's gateway enforces sign-in (`verify_jwt`).
- **`supabaseBackend.searchDiscogs`:**
  - Gets the access token via `client.auth.getSession()`. No session → `BackendError('Sign in again to search.')`.
  - `POST` `${url}/functions/v1/discogs-search` with `fetchWithTimeout(20_000)`, headers `Authorization: Bearer <token>`, `apikey: <publishable key>`, `Content-Type: application/json`.
  - Outcomes:
    - offline-looking or AbortError → `NO_SIGNAL`;
    - 429 → `DISCOGS_MESSAGES.rateLimited`;
    - any other non-OK → `DISCOGS_MESSAGES.down`;
    - 200 → `results`.
  - It **does not call the server** for a query under 2 characters after trimming; it resolves `[]`.
- **`FakeBackend`:** `discogsResults: FoundRecord[]` (default `[]`), `discogsFails: 'rate-limited' | 'down' | null`, and `discogsCalls: string[]`. It honours `online`.

- [ ] **Step 1: Write the failing tests** (`supabaseBackend.test.ts`, with stubbed `fetch` and `getSession`):
  - `posts the query with the bearer token and apikey, and returns results`;
  - `429 → rate-limited message`; `500 → down message`; `a network error → NO_SIGNAL`; `no session → sign in again`;
  - `a one-character query never calls the server` (Review Focus 4);
  - If `tsc -b` rejects the type-only import from outside `src/`, copy the type into `backend.ts` instead and say so in the report.
  - **`fakeBackend.test.ts`:** canned results, the failure switches, and offline.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement** the function, the config entry, the backend and the fake.

- [ ] **Step 4: Run the full suite and the type check.** Expected: green. The Deno file isn't type-checked by `tsc -b`, which is fine; Task 6 deploys it.

- [ ] **Step 5: Commit** (`Add the discogs-search function and Backend.searchDiscogs`)

---

### Task 3: `addFound`

**Files:**
- Modify: `src/data/actions.ts`, `src/data/actions.test.ts`

**Interfaces:**
- Consumes: `addRecord`, `Ctx`, `ActionResult` (actions.ts); `sectionFor` (Task 1); `FoundRecord` (Task 2).
- Produces: `addFound(found: FoundRecord, ctx: Ctx & { shelfId: string; newId: string }): ActionResult`.
  - The fields are built from `found`:
    - artist, title, label, catalog, year, format;
    - `genre: sectionFor(found.genres, found.styles)`;
    - `discogsReleaseId: found.releaseId`.
  - Everything else is null. It calls `addRecord(fields, null, ctx)`.
  - Its `undo` is `[record.patch { deletedAt: ctx.now }]` for `newId`.

- [ ] **Step 1: Write the failing tests:**
  - `addFound saves an owned record with the Discogs facts and the mapped section` (one `record.create`; `discGrade`, `sleeveGrade` null; no `rating.set`);
  - `addFound’s undo soft-deletes it`;
  - `addFound keeps a 200-character title valid` (schema limits hold).

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and the type check.** Expected: green.

- [ ] **Step 5: Commit** (`Add the addFound action`)

---

### Task 4: Find a record on the Add screen

**Files:**
- Create: `src/ui/FindRecord.tsx`, `src/ui/FindRecord.test.tsx`
- Modify: `src/screens/AddScreen.tsx`, `src/screens/AddScreen.test.tsx`

**Interfaces:**
- Consumes: `useBackend()` → `searchDiscogs`; `addFound`, `perform`; `useSyncStatus().runNow`; `useUndo().offer`; `useCurrentShelf()`; `findDuplicate` (`recordForm.ts`); `BackendError`, `NO_SIGNAL`.
- Produces: `FindRecord({ records, onAdded }: { records: ShelfRecord[]; onAdded?: () => void })`.
- **Behaviour** (spec §4):
  - **The box:** `type="search"`, `enterKeyHint="search"`, 16px, the exact placeholder. **Search** is disabled while the trimmed query is under 2 characters, or while searching.
  - **Offline:** `navigator.onLine === false` shows `Needs signal` and disables the box. Re-check on the `online` / `offline` events.
  - **Searching:** a request counter; only the **latest** request's response may set results or messages (Review Focus 3). The button reads `Searching Discogs…`.
  - **Results:** up to 6 cards, each a `<button>` ≥ 48px:
    - the thumbnail `<img>` with `alt=""` (decorative), when there is one;
    - **artist — title** in bold;
    - a line with `{year} · {label} · {catalog}`, then `{format} · {country}`, leaving out missing parts;
    - `Already on the shelf` when `findDuplicate` matches.
  - Under the results: `Data provided by Discogs` linking to the search URL.
  - **Tapping a card:**
    - a ref guard means a double tap saves once (Review Focus 2);
    - `perform(db, addFound(found, ctx).postcards, runNow)`;
    - `offer('On the shelf: {title}', () => perform(db, undo, runNow))`;
    - clear the query and results, then refocus the box.
  - **Messages:** no results → the no-results copy; `BackendError` → its message; `NO_SIGNAL` → `Needs signal`.
- **AddScreen:**
  - `FindRecord` goes under the title.
  - Below it, a disclosure button `Not here? Fill it in by hand` (`aria-expanded`, collapsed) reveals build 1's `RecordForm` (mode `add`). Opening it doesn't change any form behaviour.
  - The leave guard still applies only to the hand form's dirty state. A search box with text isn't treated as unsaved.

- [ ] **Step 1: Write the failing tests:**
  - **`FindRecord.test.tsx`** (FakeBackend):
    - `Search is disabled for one character` (Review Focus 4);
    - `shows the cards with year · label · catalog`;
    - `tapping a card saves an owned record and offers Undo` (Dexie has it with `discogsReleaseId`; the outbox has a `record.create`; the bar reads `On the shelf: Forces Of Nature (Live At Slugs')`);
    - `the box clears and has focus after saving`;
    - `a double tap saves one record`;
    - `Undo removes it`;
    - `marks a record already on the shelf`;
    - `an older search can’t overwrite a newer one` (Review Focus 3): make the first `searchDiscogs` call resolve last;
    - `no results`, `rate-limited`, `down` and offline messages;
    - `nothing from the search is written to localStorage` (spy on `Storage.prototype.setItem`).
  - **`AddScreen.test.tsx`:** update the existing hand-form tests to open `Not here? Fill it in by hand` first. Add `the find box is first and the hand form starts folded`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the full suite and the type check.** Expected: green.

- [ ] **Step 5: Commit** (`Find a record on Discogs and save it with one tap`)

---

### Task 5: Discogs credits

**Files:**
- Modify: `src/screens/RecordScreen.tsx`, `src/screens/RecordScreen.test.tsx`, `src/screens/SettingsScreen.tsx`, `src/screens/SettingsScreen.test.tsx`

**Behaviour:**
- **Record screen:** when `record.discogsReleaseId !== null`, show `Data provided by Discogs` under the facts, linking to `https://www.discogs.com/release/{id}` (`target="_blank" rel="noopener"`).
- **Settings:** the full notice at the bottom, in small muted text.

- [ ] **Step 1: Write the failing tests:**
  - `shows the Discogs credit for a Discogs record` (with its exact `href`, and no `nofollow` in `rel`);
  - `no Discogs credit otherwise`;
  - `Settings shows the Discogs notice`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and the type check.** Expected: green.

- [ ] **Step 5: Commit** (`Credit Discogs on the Record screen and in Settings`)

---

### Task 6: Final review and go-live

The controller runs this with Kahrman.

- [ ] **Step 1:** Run `npx vitest run && npx tsc -b && npm run build`. Expected: green.
- [ ] **Step 2:** A whole-branch review, then one fix wave and a scoped re-review.
- [ ] **Step 3: Kahrman, in his own terminal.**
  1. Create a Discogs account, then generate a personal access token in Settings → Developers.
  2. Run `npx supabase secrets set DISCOGS_TOKEN=<his token> --project-ref rlhhrzkaosngafcoxaas`.
  3. Then I check with `npx supabase secrets list --project-ref rlhhrzkaosngafcoxaas`. Expected: `DISCOGS_TOKEN` is listed (its value is never shown).
- [ ] **Step 4: Ask first.** Run `npx supabase functions deploy discogs-search --project-ref rlhhrzkaosngafcoxaas`.
  - Smoke test: an unauthenticated `curl -X POST …/functions/v1/discogs-search` → 401.
  - The authenticated check is Step 6, from the app.
- [ ] **Step 5: Ask first.** Merge into `main`, push, and wait for Vercel READY. Confirm the live bundle contains `Not here? Fill it in by hand`.
- [ ] **Step 6: Kahrman, on his phone.** Run ten records from his shelf through Find. Note any wrong pressing or genre in `docs/superpowers/notes/plan-2-handoff.md` under "Plan 4a build 2a", then commit.
