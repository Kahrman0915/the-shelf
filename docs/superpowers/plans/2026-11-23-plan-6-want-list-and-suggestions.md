# Plan 6: Want list, upgrades and Claude's suggestions (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Want list screen: wants you add by searching, upgrades you mark on Edit, and about 8 record suggestions from Claude, based on both members' ratings, that you add or dismiss one tap at a time.

**Architecture:**
- **Wants** are `records` rows with `status = 'wanted'`, as the app already models them, so sync, offline, At the show and Bought it keep working.
- **Suggestions** live in a new `public.suggestions` table. A new Edge Function, `suggest-records`, asks Claude Sonnet 5.5, checks each answer on Discogs and inserts the kept ones. The phone pulls them in full on every sync and decides them through a new `suggestion.patch` postcard.
- **Adding** a suggestion is one `perform`: create the wanted record, and patch the suggestion to `added`.

**Tech Stack:** Supabase Postgres (PGlite tests), Deno Edge Functions (`npm:@anthropic-ai/sdk@1.6.0`), React 19, TypeScript, Dexie 4, Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-plan-6-want-list-and-suggestions-design.md`. Read it before any task.

## Global Constraints

- **Wording, verbatim** (curly apostrophes):
  - `Want list`, `Wanted`, `Upgrades`, `Suggested for you`, `Suggest more`, `+ Add`, `Add to your want list`
  - `Add to want list`, `Not for me`, `This pressing only`, `Want a better copy`, `Upgrade note`, `Check price · Bought it`
  - `Finding records you’d like…`, `Needs signal`
  - `Rate a few more records first. Suggestions need at least 5 ratings.`
  - `Nothing on your want list yet.`, `Tap Suggest more for records you might like.`
  - `✓ On your want list: {title}` with `Undo`
  - `Already on the shelf`, `Already on your want list`
  - `Already on the shelf. To hunt for a better copy, open it and turn on Want a better copy.` (with a link to the record)
- **Lengths:** suggestion artist and title 1–200 characters; reason 1–140; upgrade note up to 200.
- **Numbers:**
  - Claude is asked for **12** suggestions, and at most **8** are kept.
  - **5** rated records are needed: distinct live, non-wanted records on the shelf with at least one rating from anyone.
  - Function budget **50 000 ms** for the whole request; Claude at most **35 000 ms**, no retries. The app waits **60 000 ms**.
- **Model:** `claude-sonnet-5-5`, effort `medium`, `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta. Before writing the call, check the exact request shape against the claude-api skill or SDK docs: never guess it.
- **Same record test:** two records are the same when `normalise(artist)` and `normalise(title)` both match (`normalise` from `src/domain/search.ts`; the function uses a byte-identical copy).
- **Tap targets** ≥ 48 px (`h-12`).
- **Discogs:** suggestions store Discogs facts (release id, genres, styles) only, never images or search results. Keep the existing "Data provided by Discogs" credit wherever Discogs results show.
- **Logs** in the function name only status codes and error names: never artists, titles, ratings or names.
- **Approval:** migration first, then the function, then the app. Never apply to production, deploy, push or merge without Kahrman's explicit OK.
- **Commits:** messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Suggest more is slow or the signal drops,** and the function saves suggestions after the app gave up. The app pulls once and shows them with no error, so nobody pays for a second round. Task 6.
2. **Claude suggests something already owned, wanted or suggested,** written differently (other case, accents or punctuation), or the same album twice in one answer. It's dropped. Task 2.
3. **Discogs is rate-limited or down partway through a round.** The suggestions kept so far are saved, the rest are skipped, and the answer is still 200. Task 2.
4. **A suggestion whose album is already on the want list or shelf by the time someone taps Add** (added by hand, or by the other member on another phone). It's marked `added` with no second record. Task 4.
5. **Offline:** adding a want, adding a suggestion and Not for me all work offline and send later. Suggest more says `Needs signal`. Tasks 3, 4 and 6.

---

### Task 1: Database: the suggestions table

**Files:**
- Create: `supabase/migrations/20261123130000_suggestions.sql`
- Test: `supabase/tests/suggestions.test.ts` (setup in the style of `supabase/tests/sections.test.ts`)

**Interfaces:**
- Produces, as **table `public.suggestions`:**
  - `id uuid pk default gen_random_uuid()`
  - `shelf_id uuid not null references shelves on delete cascade`
  - `artist text not null`, `title text not null`: each with a check of trimmed length 1–200
  - `reason text not null`: check of trimmed length 1–140
  - `discogs_release_id int null`, `discogs_genres text[] not null default '{}'`, `discogs_styles text[] not null default '{}'`
  - `status text not null default 'pending'`: check in (`pending`, `added`, `dismissed`)
  - `decided_by uuid null references profiles(id) on delete set null`, `decided_at timestamptz null`
  - `round_at timestamptz not null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, with the `touch_updated_at` trigger
  - an index on `(shelf_id)`
- **Grants and RLS:**
  - `revoke all` from `anon, authenticated`;
  - grant `select`, `insert` and `update (status, decided_by, decided_at)` to `authenticated`;
  - RLS on, with these policies:
    - select when `is_member(shelf_id)`;
    - insert when `is_member(shelf_id) and status = 'pending'`;
    - update using and with check `is_member(shelf_id) and (decided_by is null or decided_by = auth.uid())`.

- [ ] **Step 1: Write the failing tests.**
  - A member inserts a suggestion on their own shelf; it reads back with status `pending`.
  - A stranger can't see, insert into or update Kahrman's suggestions.
  - Megan, a member, sets `status = 'dismissed'` with `decided_by` = herself. Setting `decided_by` to Kahrman is refused.
  - Updating `artist`, `reason` or `shelf_id` is refused (column grant).
  - An insert with `status = 'added'` is refused.
  - A 141-character reason, an empty title, a 201-character artist and status `maybe` are each refused.
  - Deleting the shelf removes its suggestions.
  - `updated_at` moves on update.
- [ ] **Step 2:** Run `npx vitest run supabase/tests/suggestions.test.ts`. Expect FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Run `npx vitest run supabase/tests`. Expect every DB test to pass.
- [ ] **Step 5:** Commit: `feat(db): suggestions table`.

---

### Task 2: Edge Function `suggest-records`

**Files:**
- Create:
  - `supabase/functions/_shared/normalise.ts`
  - `supabase/functions/suggest-records/deadline.ts`
  - `supabase/functions/suggest-records/taste.ts`
  - `supabase/functions/suggest-records/check.ts`
  - `supabase/functions/suggest-records/index.ts`
- Modify: `supabase/config.toml` (add `[functions.suggest-records]` with `verify_jwt = true`)
- Test: `supabase/functions/_shared/normalise.test.ts`, `supabase/functions/suggest-records/{deadline,taste,check}.test.ts`

**Interfaces:**
- Consumes: Task 1's table. From the existing code: `signedInUser` (`_shared/auth.ts`), `searchDiscogsWith` and `Answer` (`_shared/discogs.ts`), `FoundRecord` (`_shared/shape.ts`), and the shape of `fun-fact/index.ts` (CORS, `json()`, `publicKey()`, not-configured checks).
- Produces:
  - **`_shared/normalise.ts`:** `normalise(s: string): string`, a copy of `src/domain/search.ts`'s. Its test feeds both a list of tricky strings (accents, `æ`, punctuation, case) and asserts they agree.
  - **`deadline.ts`:**
    - `SUGGEST_BUDGET_MS = 50_000`, `CLAUDE_TIMEOUT_MS = 35_000`;
    - `startBudget(now?)`, `claudeTimeoutMs(left)` and `discogsTimeoutMs(left)`, with the same meaning as in `identify-record/deadline.ts`.
  - **`taste.ts`** (plain TypeScript: no Deno, no SDK import):
    - `type Taste = { members: { userId: string; name: string }[]; records: { artist: string; title: string; year: number | null; section: string; status: 'wanted' | 'new_arrival' | 'owned'; ratings: { userId: string; value: number }[] }[]; suggested: { artist: string; title: string; status: 'pending' | 'added' | 'dismissed' }[] }`
    - `ratedCount(t: Taste): number`, the number of non-wanted records with at least one rating;
    - `MIN_RATED = 5`, `ASK_FOR = 12`;
    - `suggestRequest(t: Taste): object`, the full Messages API request:
      - model `claude-sonnet-5-5`, `output_config: { effort: 'medium', format: SUGGEST_SCHEMA }`, a `max_tokens` with room for thinking (`16000`);
      - the prompt lists who rated what (by member name, 1–5), says 1–2 means disliked, lists everything owned, wanted or already suggested as off-limits, asks only for albums released on vinyl, asks for `ASK_FOR`, and asks for a reason of at most 140 characters naming the person or people and the records they rated highly;
      - wording is the builder's (spec §11);
    - `SUGGEST_SCHEMA`: `{ suggestions: [{ artist, title, reason }] }`, all strings, required, no extra properties;
    - `type Proposed = { artist: string; title: string; reason: string }`;
    - `proposalsFromMessage(message: { stop_reason: string | null; content: { type: string; text?: string }[] }): Proposed[]`:
      - a `refusal` stop, unparseable JSON, or a missing array → `[]`;
      - each item's strings are trimmed;
      - an empty or over-200 artist or title drops the item;
      - a reason over 140 is cut at the last space at or before 139 characters, plus `…`;
      - an empty reason drops the item.
  - **`check.ts`:**
    - `keyOf(artist: string, title: string): string`, which is `normalise(artist) + '|' + normalise(title)`;
    - `type Kept = Proposed & { discogsReleaseId: number; discogsGenres: string[]; discogsStyles: string[] }`;
    - `checkProposals(proposed: Proposed[], taken: Set<string>, search: (params: Record<string, string>, timeoutMs: number) => Promise<Answer>, msLeft: () => number, keep = 8): Promise<Kept[]>`, which works in order:
      1. skip any whose key is in `taken`, or repeats an earlier one in this list;
      2. stop when `discogsTimeoutMs(msLeft()) <= 0`, or when `keep` are kept;
      3. search `{ q: \`${artist} ${title}\`, format: 'Vinyl' }`;
      4. on a non-200 answer (429 or down), stop and return what's kept;
      5. keep it with the first result whose artist and title have the same key. Before comparing, strip from the Discogs artist a trailing ` (n)` and any `*`.
  - **`index.ts`:**
    - `POST {}` only (`OPTIONS` → 204; others → 405);
    - not configured → 500; not signed in → 401;
    - a client made with the public key and the caller's `Authorization` header, so RLS applies. Through it:
      - find the caller's shelf (their `shelf_members` row);
      - read members with `profiles(display_name)`, live records (`deleted_at is null`) with their section's name, the shelf's ratings, and every suggestion;
      - build the `Taste`;
    - `ratedCount < MIN_RATED` → 400 `{ error: 'not-enough-ratings' }`;
    - Claude, with `claudeTimeoutMs(left)` and `maxRetries: 0`; a failure → 502 `{ error: 'down' }`, logging only the error's name and status;
    - `taken` = the keys of every live record and every suggestion;
    - insert the kept rows, all with one `round_at`; an insert error → 502;
    - answer `200 { added: n }`.

- [ ] **Step 1: Write the failing tests.**
  - **normalise:** it agrees with the app's.
  - **deadline:** the budget counts down; Claude's timeout is capped at 35 000 and by what's left; Discogs at or below 0 when under 1 s is left.
  - **taste:**
    - `ratedCount` counts records, not ratings, and ignores wanted ones;
    - the request names both members' ratings, marks a 1 as disliked, lists an owned album, a wanted one and a dismissed suggestion as off-limits, and asks for 12;
    - the model id and effort are exact;
    - `proposalsFromMessage`: a normal answer; a refusal → `[]`; broken JSON → `[]`; a 150-character reason is cut to ≤ 140 ending in `…`; an empty title is dropped.
  - **check:**
    - an owned title in other case and accents is dropped before any search;
    - a duplicate within the answer is dropped;
    - a match whose Discogs artist reads `Bill Evans (2)` is kept, with its release id, genres and styles;
    - no matching result → dropped;
    - it stops at `keep`;
    - a 429 on the third search returns the first two kept;
    - with no time left, it makes no search.
- [ ] **Step 2:** Run `npx vitest run supabase/functions`. Expect FAIL.
- [ ] **Step 3:** Implement. `index.ts` stays thin wiring, as `fun-fact/index.ts` is; the logic lives in the tested modules.
- [ ] **Step 4:** Run `npx vitest run supabase/functions && npx tsc -b`. Expect PASS. If `deno` is installed, also run `deno check supabase/functions/suggest-records/index.ts`.
- [ ] **Step 5:** Commit: `feat(functions): suggest-records asks Claude and checks Discogs`.

---

### Task 3: Suggestions in the app's data layer

**Files:**
- Modify:
  - `src/data/schema.ts` (`SuggestionSchema`), `src/data/rowMapping.ts` (suggestion rows);
  - `src/data/db.ts` (version 8 adds `suggestions: 'id, shelfId'`; everything else unchanged, no upgrade body);
  - `src/data/backend.ts`, `src/data/supabaseBackend.ts`, `src/test/fakeBackend.ts`;
  - `src/data/sync.ts`, `src/data/outbox.ts`, `src/data/courier.ts`, `src/data/hooks.ts`;
  - `clearPhone` in `db.ts`, so it also clears suggestions.
- Test: additions to `schema.test.ts`, `rowMapping.test.ts`, `dbUpgrade.test.ts`, `sync.test.ts`, `outbox.test.ts`, `courier.test.ts`, `supabaseBackend.test.ts` and `fakeBackend.test.ts`.

**Interfaces:**
- Consumes: Task 1's table; Task 2's function name and answers.
- Produces:
  - **`Suggestion`** (Zod):
    - `id`, `shelfId` (`z.uuid()`), `artist`, `title` (trimmed 1–200), `reason` (trimmed 1–140);
    - `discogsReleaseId` (positive int or null), `discogsGenres`, `discogsStyles` (`string[]`);
    - `status` (`'pending' | 'added' | 'dismissed'`), `decidedBy` (uuid or null), `decidedAt` (string or null);
    - `roundAt`, `createdAt`, `updatedAt` (strings);
    - `suggestionFromRow(row)`, `type SuggestionPatchRow = Partial<{ status: string; decided_by: string | null; decided_at: string | null }>` and `suggestionPatchToRow(fields): SuggestionPatchRow`. Only `status`, `decidedBy` and `decidedAt` map, to `status`, `decided_by` and `decided_at`.
  - **Messages** in `backend.ts`:
    - `NOT_ENOUGH_RATINGS = 'Rate a few more records first. Suggestions need at least 5 ratings.'`
    - `SUGGEST_DOWN = 'Couldn’t find suggestions just now. Try again in a minute.'` (plan ruling: the spec says only "plain words")
  - **Backend:**
    - `ShelfSource.suggestions(shelfId): Promise<Record<string, unknown>[]>`, every row on the shelf;
    - `ShelfWriter.patchSuggestion(id, fields: SuggestionPatchRow): Promise<'patched' | 'missing'>`;
    - `Backend.suggestRecords(): Promise<{ added: number }>`:
      - it POSTs `{}` to `suggest-records` with a `SUGGEST_TIMEOUT_MS = 60_000` timeout, reusing `callClaudeFunction`'s session, offline and 401 handling;
      - a 400 whose body is `{ error: 'not-enough-ratings' }` → `BackendError(NOT_ENOUGH_RATINGS)`;
      - any other failure that isn't offline → `BackendError(SUGGEST_DOWN)`.

      Generalise `callClaudeFunction` with an optional down-message and status hook rather than copying it.
    - **FakeBackend:**
      - `suggestionRows`, plus `suggested: { artist: string; title: string; reason: string; discogsGenres?: string[] }[]` (what the next `suggestRecords()` inserts) and `suggestFails: 'down' | 'not-enough-ratings' | 'lost-reply' | null`;
      - `'lost-reply'` inserts, then throws `SUGGEST_DOWN`, the way a timed-out call whose function finished looks;
      - `suggestCalls`.
  - **Postcard** `suggestion.patch { fields: { status, decidedBy, decidedAt } }`, whose `recordId` is the suggestion's id.
    - `applyPostcard` merges it into `db.suggestions` if present.
    - `savePostcards`, `pullShelf` and `reapplyOutbox` include `db.suggestions` in their transactions.
    - The courier sends it with `patchSuggestion`. `'missing'` counts as sent, as for records.
  - **`pullShelf`** fetches suggestions alongside sections and replaces the shelf's suggestions in the same transaction, before reapplying the outbox.
  - **`useSuggestions(shelfId): Suggestion[] | undefined`**, every suggestion on the shelf.

- [ ] **Step 1: Write the failing tests.**
  - **Schema and rows:** a row round-trips; a 141-character reason is refused; only the three decision fields go into a patch row.
  - **dbUpgrade:** a version-7 notebook opens at version 8 with its records, sections and outbox untouched, and an empty `suggestions` store.
  - **sync:**
    - suggestions arrive with a pull, and one removed on the server disappears;
    - a queued `suggestion.patch` to `dismissed` stays on top after a pull that still says `pending`.
  - **outbox:** applying the patch twice is harmless, and a patch for an unknown id does nothing.
  - **courier:** it sends through the fake; `'missing'` counts as sent; it's held behind a rejected earlier postcard for the same id.
  - **supabaseBackend:**
    - the table and column names in `suggestions()` and `patchSuggestion()`;
    - `suggestRecords()` POSTs `{}` to `/functions/v1/suggest-records`;
    - the 400 not-enough-ratings mapping, a 502 → `SUGGEST_DOWN`, offline → `NO_SIGNAL`, 401 → sign in again;
    - the 60 000 ms timeout.
  - **FakeBackend:** each `suggestFails` mode.
- [ ] **Step 2:** Run them and expect FAIL. Implement, then run `npx vitest run && npx tsc -b` and expect PASS.
- [ ] **Step 3:** Commit: `feat(data): suggestions sync and the suggestion.patch postcard`.

---

### Task 4: Want actions (pure)

**Files:**
- Create: `src/data/wantActions.ts`
- Test: `src/data/wantActions.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `ActionResult` and `NewPostcard` (`actions.ts`, `outbox.ts`); `sectionFor` and `SortableSection` (`src/domain/sections.ts`); `findDuplicate` (`src/domain/recordForm.ts`); `Suggestion` (Task 3).
- Produces:
  - `addWant(found: FoundRecord, ctx: Ctx & { shelfId: string; newId: string; sections: SortableSection[] }, opts: { exactPressing: boolean }): ActionResult`
    - It makes a `wanted` record: `wantsUpgrade: false`; artist and title from `found`; section `sectionFor(found.genres, found.styles, sections)`; `boughtAt` null; `addedBy` me.
    - With `exactPressing`, it also keeps `label`, `catalog`, `year`, `format` and `discogsReleaseId: found.releaseId`. Without it, those are null.
    - Undo soft-deletes it.
    - Check the record with `RecordSchema`, as `actions.ts` does: export its `checkRecord` rather than copying it.
  - `addSuggestion(s: Suggestion, records: ShelfRecord[], ctx: Ctx & { shelfId: string; newId: string; sections: SortableSection[] }): ActionResult`
    - **Normally:** a `record.create` for an album-level wanted record (section from `s.discogsGenres` and `s.discogsStyles`, `discogsReleaseId` null), plus a `suggestion.patch` to `{ status: 'added', decidedBy: me, decidedAt: now }`. Undo soft-deletes the record and patches back to `{ status: 'pending', decidedBy: null, decidedAt: null }`.
    - **If `findDuplicate(records, s.artist, s.title)`** finds a live record: only the suggestion patch, and its undo is only the patch back.
  - `dismissSuggestion(s: Suggestion, ctx: Ctx): ActionResult`: one patch to `dismissed`, `undo: null`.
  - `upgradeChange(record: ShelfRecord, wantsUpgrade: boolean, note: string): Partial<ShelfRecord>`. This is the `extra` the Edit screen passes to `editRecord` and `restoreWithEdits`:
    - only the fields that differ from the record;
    - the note is trimmed, and empty or switch-off means `upgradeNote: null`;
    - a note over 200 characters throws `BackendError('An upgrade note is at most 200 characters.')`;
    - a record that isn't `owned` throws.

- [ ] **Step 1: Write the failing tests.**
  - `addWant`, album-level and with this pressing, including the section from a `Funk / Soul` result on a starter-set shelf.
  - `addSuggestion`, normal and duplicate, each with its undo applied through `savePostcards` on a test notebook: after undo, the record is soft-deleted and the suggestion is `pending` again.
  - `dismissSuggestion` makes one patch.
  - `upgradeChange`: switch on with a note, off, note only, unchanged → `{}`, 201 characters, and a wanted record.
  - Each of these works with the phone offline (`perform` with no courier), and its postcards are waiting in the outbox.
- [ ] **Step 2:** Run `npx vitest run src/data/wantActions.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(want): pure actions for wants, suggestions and upgrades`.

---

### Task 5: Adding wants by search

**Files:**
- Modify: `src/ui/FindRecord.tsx`, `src/app/App.tsx` (route `/want/add`)
- Create: `src/screens/AddWantScreen.tsx`
- Test: `src/ui/FindRecord.test.tsx` (additions), `src/screens/AddWantScreen.test.tsx`

**Interfaces:**
- Consumes: `addWant` (Task 4), `perform`, `useSections`, the undo context, `findDuplicate`.
- Produces:
  - **`FindRecord`** gets a prop `mode?: 'shelf' | 'want'`, default `'shelf'`, which keeps today's behaviour exactly.
  - **In `'want'` mode:**
    - no photos and no fun fact;
    - a `This pressing only` switch (Radix Switch, `h-12` row) above the cards, off by default;
    - a card for a live wanted record (by `findDuplicate` among wanted records) shows `Already on your want list`, and a tap does nothing;
    - a card for a live owned or new-arrival record shows `Already on the shelf`. A tap shows the verbatim owned line with a link to `/record/{id}` and adds nothing;
    - any other tap performs `addWant`, then shows `✓ On your want list: {title}` with `Undo`, as the shelf mode's saved line does.
  - **In `'shelf'` mode** (plan ruling: the spec is silent, and this is label only), a card matching a wanted record shows `On your want list` instead of `Already on the shelf`. Tapping still adds as today.
  - **`AddWantScreen`** at `/want/add`: a `‹ Want list` back button to `/want`, the heading `Add to your want list`, `<SyncNotice />`, and `FindRecord` in want mode with the shelf's live records.

- [ ] **Step 1: Write the failing tests.**
  - **Want mode:**
    - a tap makes a `wanted` record with no label;
    - with the switch on, the label, catalog and release id are kept;
    - `✓ On your want list: {title}`, and Undo soft-deletes it;
    - an already-wanted card shows its label, and a tap adds nothing;
    - an owned card shows `Already on the shelf`, and a tap shows the owned line and link, and adds nothing;
    - no photo controls;
    - the Discogs credit still shows.
  - **Shelf mode:** the existing tests pass unchanged, and a card for a wanted record says `On your want list`.
  - **AddWantScreen:** the heading and the back link.
- [ ] **Step 2:** Run them and expect FAIL. Implement, then run `npx vitest run && npx tsc -b` and expect PASS.
- [ ] **Step 3:** Commit: `feat(want): add wants from a Discogs search`.

---

### Task 6: The Want list screen

**Files:**
- Create: `src/screens/WantListScreen.tsx`, `src/ui/SuggestionCard.tsx`
- Modify: `src/app/App.tsx` (route `/want`), `src/screens/ShelfScreen.tsx` (a `Want list` link beside At the show and Add, in the same style), `src/data/hooks.ts` (`useRatedCount`)
- Test: `src/screens/WantListScreen.test.tsx`, `src/ui/SuggestionCard.test.tsx`, an addition to `src/screens/ShelfScreen.test.tsx`

**Interfaces:**
- Consumes: `useShelfItems`, `useSuggestions` (Task 3), `addSuggestion` and `dismissSuggestion` (Task 4), `perform`, `useBackend`, `pullShelf`, `useSyncStatus().runNow`, the undo context, and `NEEDS_SIGNAL`.
- Produces:
  - **`useRatedCount(shelfId): number | undefined`**: the distinct live, non-wanted records on the shelf with at least one rating.
  - **The screen, spec §4.1:**
    - a `‹ Shelf` back button and `+ Add` (to `/want/add`);
    - **Wanted** (*n*): live wanted records by artist then title. A row is a `h-12`+ link to `/record/{id}`.
    - **Upgrades** (*n*): live owned records with `wantsUpgrade`, each showing its note. A row links to `/record/{id}`.
    - **Suggested for you** (*n*), with the `Suggest more` button: pending suggestions, newest `roundAt` first, then by `createdAt`. Each `SuggestionCard` shows the artist, title and reason, with `Add to want list` (performs `addSuggestion`; Undo offered as `On your want list`) and `Not for me` (performs `dismissSuggestion`; no Undo). Both buttons are `h-12`.
    - The empty states, verbatim, for Wanted and for Suggested.
  - **Suggest more:**
    - offline (`navigator.onLine === false`) → disabled, labelled `Needs signal`;
    - rated count below 5 → disabled, with the `NOT_ENOUGH_RATINGS` line under it;
    - while running → disabled, labelled `Finding records you’d like…`;
    - success → `runNow()` so the new rows arrive; with `added: 0`, it says `No new suggestions this time.` (plan ruling: the spec doesn't say);
    - `NOT_ENOUGH_RATINGS` and the sign-in-again message are shown as they are;
    - any other failure: `await pullShelf(db, backend, shelfId)` (catching its own failure). If there are more pending suggestions than before the tap, show no error. Otherwise, show the error's message.

- [ ] **Step 1: Write the failing tests** (with FakeBackend):
  - The three groups, in order, with counts.
  - Wanted rows sorted, and a tap opens the record.
  - Upgrades show their note.
  - A dismissed or added suggestion isn't listed.
  - `Add to want list` makes a wanted record and hides the card, and Undo brings it back.
  - `Not for me` hides it, and offers no Undo.
  - **Suggest more:**
    - with 4 rated records → disabled, with the 5-ratings line;
    - offline → `Needs signal`;
    - running → the running label;
    - success → the new cards appear;
    - `suggestFails = 'lost-reply'` → the new cards appear and no error shows;
    - `'down'` → `SUGGEST_DOWN`;
    - `added: 0` → `No new suggestions this time.`
  - Both empty states.
  - The Shelf screen's `Want list` link goes to `/want`, and wanted records still don't show on the shelf.
- [ ] **Step 2:** Run them and expect FAIL. Implement, then run `npx vitest run && npx tsc -b && npm run build` and expect PASS.
- [ ] **Step 3:** Commit: `feat(want): the Want list screen with Claude's suggestions`.

---

### Task 7: Buying from the list, and marking upgrades

**Files:**
- Modify: `src/screens/RecordScreen.tsx`, `src/screens/PriceCheckScreen.tsx`, `src/screens/EditScreen.tsx`
- Test: additions to `RecordScreen.test.tsx`, `EditScreen.test.tsx`; create `src/screens/PriceCheckScreen.test.tsx`

**Interfaces:**
- Consumes: `buyKind`, `boughtIt` (`actions.ts`), `wantFunFact` (`funFacts.ts`), `UNDO_WINDOW_MS`, and `upgradeChange` (Task 4).
- Produces:
  - **RecordScreen:** when `buyKind(record) !== null`, an `h-12` link button `Check price · Bought it` to `/price/{id}?from=record`.
  - **PriceCheckScreen:**
    - with `from=record`, the back link goes to `/record/{id}` and reads `Back`. Otherwise it's unchanged (`Back to search`, keeping `q`).
    - After a successful Bought it on a want (`kind === 'want'`), call `wantFunFact(db, record.id, { notBefore: Date.now() + UNDO_WINDOW_MS + 1000 })`, catching and logging its failure. An upgrade queues nothing.
  - **EditScreen**, for an `owned` record only:
    - a `Want a better copy` switch (`h-12` row);
    - when it's on, an `Upgrade note` text field (`maxLength` 200);
    - both start from the record;
    - on save, `upgradeChange(...)` is merged into the `extra` already passed to `editRecord` or `restoreWithEdits`, alongside the photo fields;
    - its error shows inline like other form errors;
    - not shown for wanted or new-arrival records.

- [ ] **Step 1: Write the failing tests.**
  - **RecordScreen:** the button shows for a wanted record and for an upgrade, and not for a plain owned record. It links with `from=record`.
  - **PriceCheckScreen:**
    - `from=record` gives `Back` to the record; without it, `Back to search`;
    - Bought it on a want moves it to New arrivals and queues a fun fact with a `notBefore`;
    - on an upgrade, it logs the upgrade and queues no fun fact.
  - **EditScreen:**
    - switching on with a note saves one patch with `wantsUpgrade: true` and the note;
    - switching off clears the note;
    - an unchanged switch sends nothing extra;
    - not shown for a wanted record.
- [ ] **Step 2:** Run them and expect FAIL. Implement, then run `npx vitest run && npx tsc -b && npm run build` and expect PASS.
- [ ] **Step 3:** Commit: `feat(want): buy from the want list, and mark upgrades on Edit`.

---

### Task 8: Go live with Kahrman

This task is run by the controller with Kahrman. Each **(OK)** step needs his explicit yes.

- [ ] **Step 1: Ready check:** `npx vitest run && npx tsc -b && npm run build`.
- [ ] **Step 2 (OK): Apply the migration** with `npx supabase db push --remote --yes`. Check that the table exists with RLS on, and that the anon role sees nothing.
- [ ] **Step 3 (OK): Deploy `suggest-records`** with `npx supabase functions deploy suggest-records --project-ref rlhhrzkaosngafcoxaas`.
  - Confirm from secret names only that `ANTHROPIC_API_KEY` and `DISCOGS_TOKEN` exist.
  - An unsigned call gets 401.
  - Read the logs.
- [ ] **Step 4 (OK): Push the branch for a test link.** Kahrman runs one Suggest more on his shelf:
  - the 8 are real vinyl releases;
  - the reasons name the right people and records;
  - nothing owned is suggested.

  Read the cost from the Console. Then he adds a want by search, marks an upgrade, and adds and dismisses a suggestion.
- [ ] **Step 5 (OK): Merge to `main`.** Confirm the live bundle changed.
- [ ] **Step 6: Handoff notes:** append a Plan 6 section to `docs/superpowers/notes/plan-2-handoff.md` (what shipped, the live checks, deferred items).
