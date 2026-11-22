# Plan 5: Your shelf sections (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each shelf has its own sections, with name, colour, order, the Discogs genres they take, and a holiday flag. Records point at a section instead of one of nine fixed genres. Kahrman's shelf keeps his nine exactly; other shelves get a starter set; Settings → Sections edits them.

**Architecture:**
- **Database:**
  - A new `sections` table per shelf, with a `section_redirects` table for merges.
  - `records.section_id` points at a section. Triggers reroute stale ids, translate old-app `genre` writes, and keep the old `genre` column filled for the changeover.
  - `merge_section()` moves records atomically.
  - The sets the migration and `bootstrap()` create have ids derived as `md5(shelf_id || ':' || legacy_genre)::uuid`, so the phone can compute them offline.
- **App:**
  - Sections live in a Dexie table, pulled in full on every sync, and are written through new outbox postcards.
  - `ShelfRecord.genre` is replaced by `sectionId`.
  - A Dexie upgrade converts stored records and queued postcards offline.

**Tech Stack:** Supabase Postgres (PGlite tests), React 19, TypeScript, Dexie 4, Zod 4, Radix, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-plan-5-shelf-sections-design.md`. Read it before any task.

## Global Constraints

- **The two sets** (spec §5), in this order:

  | Kahrman's nine | Starter set | Colour | Discogs genres | Holiday | Catch-all |
  |---|---|---|---|---|---|
  | Jazz / big band | Jazz | jazz | Jazz | | |
  | Rock | Rock | rock | Rock | | |
  | Pop / soul / contemporary | Soul & Funk | popsoul | Funk / Soul | | |
  | Popular pop | Pop | popularpop | Pop | | |
  | Miscellaneous | Country & Folk | misc / country | (catch-all) / Folk, World, & Country | | Kahrman's 5th / starter's 9th |
  | Country | Reggae | country / reggae | Folk, World, & Country / Reggae | | |
  | Reggae | Soundtracks | reggae / soundtracks | Reggae / Stage & Screen | | |
  | Soundtracks | Christmas | soundtracks / christmas | Stage & Screen / — | / ✓ | |
  | Christmas | Everything else | christmas / misc | — / (catch-all) | ✓ / | / ✓ |

- **Legacy genres:** each section in either set carries the old genre key it replaces (`jazz`, `rock`, `popsoul`, `popularpop`, `misc`, `country`, `reggae`, `soundtracks`, `christmas`). The catch-all is `misc`. Sections made later carry `misc`.
- **Derived ids:** the sets the migration and `bootstrap()` create use `md5(shelf_id::text || ':' || legacy_genre)::uuid`. The app's `sectionIdFor(shelfId, legacyGenre)` must give the identical string (lower-case, hyphenated 8-4-4-4-12). These are not RFC v4 uuids: validate section ids with Zod `z.guid()`, not `z.uuid()`.
- **Swatch keys** (12): `jazz rock popsoul popularpop misc country reggae soundtracks christmas teal slate sand`, as CSS variables `--section-{key}` in both themes. The nine reuse today's `--genre-*` values. Pick teal, slate and sand to pass contrast in both themes.
- **Discogs' 15 genres:** `Blues`, `Brass & Military`, `Children's`, `Classical`, `Electronic`, `Folk, World, & Country`, `Funk / Soul`, `Hip Hop`, `Jazz`, `Latin`, `Non-Music`, `Pop`, `Reggae`, `Rock`, `Stage & Screen`.
- **Section rules:**
  - name 1–40 characters, trimmed;
  - exactly one catch-all per shelf; it can't be deleted or merged away;
  - at most one holiday section per shelf;
  - a Discogs genre is claimed by at most one section (the server trigger takes it off any other section that has it).
- **Sorting a Discogs release into a section:**
  1. any style matching `/holiday|christmas/i` goes to the holiday section, if there is one;
  2. otherwise, the first of the release's genres, in its own order, that a section claims;
  3. otherwise, the catch-all.
- **Kahrman's shelf** is the one with any record whose `import_key` is not null (the migration and the Dexie upgrade both use this test).
- **Wording, verbatim:** `All sections`, `Section`, `Choose a section`, `Sections`, `Merge into…`, `Move {n} records from {A} into {B}? {A} will be removed.` (buttons **Merge** / **Keep it**), `Holiday records go here`, `Discogs genres that go here`. Use curly apostrophes, and make every tap target ≥ 48 px.
- **Writes:** every write goes through `perform` and the outbox, and the new app never writes `records.genre`.
- **Approval:** migrations go live before the app. Never apply to production, deploy, push or merge without Kahrman's explicit OK.
- **Commits:** messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Kahrman's shelf after the migration and the app update:**
   - the same nine names, colours and order;
   - every record in the section matching its old genre;
   - Discogs adds land where they did before.

   Tasks 2 and 4 test this.
2. **Megan's phone still on the old app:**
   - its genre edits move the record;
   - its inserts without `section_id` get one;
   - pulls still parse, because `genre` stays filled.

   Task 2.
3. **A late write from an offline phone to a merged or deleted section** is rerouted, never refused or held up. Task 2, plus Task 3's courier test.
4. **First open after the update with no signal:**
   - the shelf shows, sorted correctly, from the derived ids and the seeded sections;
   - old unsent changes still send.

   Task 4.
5. **Merging a section with soft-deleted records:** they move too, and a later restore lands in the survivor. Tasks 2 and 5.

---

### Task 1: The sections domain (pure)

**Files:**
- Create: `src/domain/sections.ts`, `src/domain/md5.ts`
- Test: `src/domain/sections.test.ts`, `src/domain/md5.test.ts`

**Interfaces:**
- Produces, in `sections.ts`:
  - `SWATCH_KEYS` (12, as above) and `type SwatchKey`;
  - `DISCOGS_GENRES` (15, as above) and `type DiscogsGenre`;
  - `LEGACY_GENRES`, today's nine keys (the same list as `GENRE_KEYS`), and `type LegacyGenre`;
  - `type SectionSeed = { legacyGenre: LegacyGenre; name: string; color: SwatchKey; discogsGenres: DiscogsGenre[]; takesHoliday: boolean; isCatchAll: boolean }`;
  - `KAHRMANS_NINE: SectionSeed[]` and `STARTER_SET: SectionSeed[]`, exactly the table above, in order;
  - `sectionIdFor(shelfId: string, legacyGenre: LegacyGenre): string`;
  - `type SortableSection = { id: string; position: number; discogsGenres: string[]; takesHoliday: boolean; isCatchAll: boolean }`;
  - `sectionFor(genres: string[], styles: string[], sections: SortableSection[]): string`, which returns a section id (the rule in Global Constraints). Among sections claiming the same genre, the lowest position wins. With no catch-all, it throws.
- Produces, in `md5.ts`: `md5Hex(text: string): string`, a synchronous MD5 of the UTF-8 bytes, as lower-case hex. It must be synchronous, because the Dexie upgrade (Task 4) can't await non-Dexie promises.

- [ ] **Step 1: Write the failing tests.**
  - **`md5Hex`:**
    - the RFC 1321 vectors: `''` → `d41d8cd98f00b204e9800998ecf8427e`, `'abc'` → `900150983cd24fb0d6963f7d28e17f72`, and `'message digest'`;
    - a 1,000-character string;
    - a non-ASCII string (`'café'`).
  - **`sectionIdFor`:** the format is 8-4-4-4-12 lower-case hex; it's stable for the same input and differs per genre. The value for shelf `11111111-1111-4111-8111-111111111111` and `jazz` must equal Postgres' answer. Compute that once in Task 2's DB test and assert equality there; here, assert the hyphenation of `md5Hex('11111111-1111-4111-8111-111111111111:jazz')`.
  - **The sets:** both have nine entries, exactly one catch-all and exactly one holiday section; names and order match the table; no Discogs genre is claimed twice within a set.
  - **`sectionFor`:**
    - a holiday style beats a Jazz genre;
    - `['Funk / Soul', 'Jazz']` → Soul & Funk in the starter set, because the release's own order decides;
    - `['Electronic']` → the catch-all;
    - two sections claiming `Rock` → the lower position wins;
    - with no holiday section, a holiday style falls through to the genres;
    - with no catch-all, it throws.
- [ ] **Step 2:** Run `npx vitest run src/domain/md5.test.ts src/domain/sections.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement. MD5 is the standard algorithm on a `Uint8Array` from `TextEncoder`; no dependency.
- [ ] **Step 4:** Run the same, plus `npx tsc -b`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(sections): section sets, derived ids and Discogs sorting`.

---

### Task 2: Database: sections, the changeover triggers and merging

**Files:**
- Create: `supabase/migrations/20261123120000_shelf_sections.sql`
- Test: `supabase/tests/sections.test.ts`

**Interfaces:**
- Consumes: `sectionIdFor`, `KAHRMANS_NINE` and `STARTER_SET` (Task 1), imported in the test to compare with what the database made.
- Produces:
  - **Table `public.sections`:**
    - `id uuid pk default gen_random_uuid()`
    - `shelf_id uuid not null references shelves on delete cascade`
    - `name text not null`, with a check of trimmed length 1–40
    - `color text not null`, with a check that it's in the 12 keys
    - `position int not null`
    - `discogs_genres text[] not null default '{}'`, with a check that every element is one of the 15
    - `takes_holiday bool not null default false`
    - `is_catch_all bool not null default false`
    - `legacy_genre public.genre not null default 'misc'`
    - `created_at timestamptz not null default now()`
    - `updated_at timestamptz not null default now()`

    Unique partial indexes: `(shelf_id) where is_catch_all`, and `(shelf_id) where takes_holiday`. Use the `touch_updated_at` trigger.
  - **Table `public.section_redirects`:** `(from_id uuid pk, into_id uuid not null, shelf_id uuid not null)`.
  - **`records.section_id uuid references sections(id) on delete restrict`:** filled for every existing row by the migration, then `set not null`, with an index on `(section_id)`.
  - **`public.section_id_for(p_shelf uuid, p_genre public.genre) returns uuid`:** `md5(p_shelf::text || ':' || p_genre::text)::uuid`, immutable.
  - **`public.seed_sections(p_shelf uuid, p_kahrmans boolean)`:** inserts the set (derived ids, positions 0–8).
  - **The records trigger** (`before insert or update`, security definer, `search_path = ''`), in this order:
    1. If old-app style, translate. That means `section_id` is null on insert, or on update `genre` changed while `section_id` didn't. Then `section_id` becomes the first section (by position) on the record's shelf with `legacy_genre = genre`, else the shelf's catch-all.
    2. If `section_id` isn't in `sections`, follow `section_redirects` (at most 10 hops). If still unknown, use the shelf's catch-all.
    3. If the section's shelf isn't the record's shelf, raise `section belongs to another shelf`.
    4. Set `genre` to the section's `legacy_genre`.
  - **The claim trigger on sections** (`before insert or update`): when a row sets `takes_holiday`, clear it on the shelf's other sections. Remove this row's `discogs_genres` from the shelf's other sections. Both are done as updates that don't re-trigger the claim (use `pg_trigger_depth()`).
  - **`public.merge_section(p_from uuid, p_into uuid)`:** security invoker, `search_path = ''`.
    - Both sections must be on one shelf, the caller a member, and `p_from` not the catch-all; anything else raises.
    - Moves all records (deleted ones too) from `p_from` to `p_into`.
    - Appends `p_from`'s Discogs genres to `p_into` (unique), and sets `p_into.takes_holiday` if `p_from` had it.
    - Inserts the redirect, re-points any redirect into `p_from` to `p_into`, then deletes `p_from`.
    - Executable by `authenticated` only.
  - **`bootstrap()`:** when it creates a shelf, it calls `seed_sections(shelf, false)`.
  - **The migration body:**
    1. For each existing shelf, `seed_sections(id, exists(records with import_key))`.
    2. `update records set section_id = section_id_for(shelf_id, genre)`.
    3. Set not null.
  - **Rules and grants:**
    - `revoke all` on both tables from `anon, authenticated`;
    - sections: `grant select, insert, delete` and `grant update (name, color, position, discogs_genres, takes_holiday)` to `authenticated`;
    - RLS: select / insert / update when `is_member(shelf_id)`; insert also requires `not is_catch_all` and `legacy_genre = 'misc'`; delete when `is_member(shelf_id) and not is_catch_all`;
    - redirects: `grant select`, RLS select when `is_member(shelf_id)`;
    - records: `grant update (section_id)`.

- [ ] **Step 1: Write the failing tests** (`sections.test.ts`), with the `recordDetails.test.ts` style setup:
  - Kahrman's shelf has a record with `import_key`; Megan is a member; the stranger has a shelf with one record without `import_key`.
  - **Migration result:**
    - Kahrman's shelf has the nine names in order, with the catch-all `Miscellaneous` at position 4;
    - the stranger's shelf has the starter set;
    - every record's `section_id = section_id_for(shelf, old genre)`;
    - the ids equal `sectionIdFor` from Task 1 for those shelves.
  - **`bootstrap()`** for a new person seeds the starter set.
  - **Old app:**
    - an insert with `genre: 'rock'` and no `section_id` lands in Rock;
    - an update setting only `genre = 'jazz'` moves the record to Jazz;
    - a genre with no matching section lands in the catch-all;
    - `genre` always equals the section's `legacy_genre` after any write.
  - **New app:** an insert with a `section_id` and no `genre` succeeds, with `genre` filled.
  - **Rerouting:**
    - after `merge_section(A, B)`, writing a record with `section_id = A` lands in B;
    - an unknown id lands in the catch-all;
    - a section from another shelf raises.
  - **`merge_section`:**
    - moves live and soft-deleted records;
    - B gets A's genres and its holiday flag;
    - A is gone;
    - merging the catch-all raises;
    - a stranger can't merge.
  - **Claims:** setting `takes_holiday` on B clears A; adding `Rock` to B removes it from A.
  - **RLS:**
    - the stranger can't see or change Kahrman's sections;
    - Megan can add (but not a catch-all), rename and recolour;
    - delete is refused for the catch-all, and refused by the foreign key for a section with records.
  - **Checks:** a 41-character name, a bad colour and a bad Discogs genre are each refused.
  - **Triggers still work:** `shelve_on_first_rating` still moves a new arrival to owned.
- [ ] **Step 2:** Run `npx vitest run supabase/tests/sections.test.ts`. Expect FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Run `npx vitest run supabase/tests`. Expect every DB test to pass.
- [ ] **Step 5:** Commit: `feat(db): per-shelf sections, changeover triggers and merging`.

---

### Task 3: Sections in the app's data layer (records unchanged)

**Files:**
- Modify:
  - `src/data/schema.ts` (`SectionSchema`);
  - `src/data/rowMapping.ts` (section rows);
  - `src/data/db.ts` (version 6 adds a `sections` store `'id, shelfId'`, and it joins `everything()`);
  - `src/data/backend.ts`, `src/data/supabaseBackend.ts`, `src/test/fakeBackend.ts`;
  - `src/data/sync.ts` (pull sections);
  - `src/data/outbox.ts`, `src/data/courier.ts`;
  - `src/data/hooks.ts` (`useSections`).
- Create: `src/data/sectionActions.ts`
- Test: `src/data/sectionActions.test.ts`, plus additions to `sync.test.ts`, `outbox.test.ts`, `courier.test.ts`, `supabaseBackend.test.ts` and `fakeBackend.test.ts`.

**Interfaces:**
- Consumes: Task 1's keys and `DISCOGS_GENRES`; Task 2's tables and RPC.
- Produces:
  - **`Section`:**
    - `id` (`z.guid()`), `shelfId` (`z.uuid()`), `name` (trimmed, 1–40), `color` (enum of `SWATCH_KEYS`);
    - `position` (int), `discogsGenres` (array of `DISCOGS_GENRES`), `takesHoliday`, `isCatchAll`;
    - `legacyGenre` (enum of the nine), `updatedAt` (string);
    - with `sectionFromRow` and `sectionToRow`.
  - **Backend:**
    - `ShelfSource.sections(shelfId): Promise<Record<string, unknown>[]>` (every section on the shelf);
    - `ShelfWriter.insertSection(row)`, which treats an already-existing row as success;
    - `ShelfWriter.patchSection(id, fields)`, returning `'patched' | 'missing'`;
    - `ShelfWriter.mergeSection(fromId, intoId)`, which calls RPC `merge_section`, and treats an already-gone `from` as success (a resend).
  - **Postcard kinds:** `section.create { fields: Section }`, `section.patch { fields: Partial<Section> }` and `section.merge { fields: { into: string } }`. Their `recordId` is the section's id (the outbox holds by this id).
    - `applyPostcard`:
      - create puts the section if missing;
      - patch merges into it;
      - merge moves every phone record with `sectionId === from` to `into` (no-op while records still use `genre`; Task 4 makes it real), copies genres and holiday, and deletes `from`.

      All of these are idempotent.
  - **`pullShelf`:** fetches sections with records, and replaces the phone's sections for the shelf inside the same transaction, before re-applying the outbox.
  - **`useSections(shelfId): Section[] | undefined`**, ordered by position.
  - **`sectionActions.ts`** (pure, `Ctx` as in `actions.ts`), each returning `{ postcards }`:
    - `createSection(shelfId, sections, ctx & { newId })`: name `New section` (or `New section 2`, …), the first swatch not in use (else `slate`), position = max + 1;
    - `editSection(section, changes, sections, ctx)`. A change that takes holiday or claims genres also emits patches that clear them on the others. That mirrors the server trigger, so the phone is right offline.
    - `moveSection(section, 'up' | 'down', sections, ctx)`, which swaps positions with its neighbour (two patches; none at the ends);
    - `mergeSections(from, into, ctx)`, which refuses when `from` is the catch-all or `from === into`;
    - `deleteSection(section, sections, ctx)`, which equals `mergeSections(section, catchAll)`. The screen only offers it when the section has no live records.

- [ ] **Step 1: Write the failing tests.**
  - **`sectionActions`:** every rule above, including the clearing patches and the error cases.
  - **outbox:** apply each kind; a merge copies genres and holiday and deletes the section; reapplying is harmless.
  - **courier:**
    - each kind is sent through the fake;
    - a resent merge whose `from` is gone counts as sent;
    - a section postcard is held while an earlier one for the same id is rejected.
  - **sync:** sections arrive with a pull; a section deleted on the server disappears from the phone; a queued `section.create` stays on top after a pull.
  - **supabaseBackend:** table names, column mapping, the RPC name and arguments, and error mapping as for records.
  - **FakeBackend:** stores sections and does merges like the database.
- [ ] **Step 2:** Run them and expect FAIL. Implement, then run `npx vitest run && npx tsc -b` and expect PASS.
- [ ] **Step 3:** Commit: `feat(data): sections sync, outbox postcards and pure section actions`.

---

### Task 4: Records point at sections (the switch)

**Files:**
- Modify:
  - data: `src/data/schema.ts`, `src/data/rowMapping.ts`, `src/data/db.ts` (version 7 upgrade), `src/data/actions.ts`, `src/data/importCollection.ts` (and `scripts/import-collection.ts` if it names genres);
  - domain: `src/domain/recordForm.ts`, `src/domain/shelf.ts`, `src/domain/labels.ts`, `src/domain/poster.ts`, `src/domain/discogsGenre.ts` (delete; `sectionFor` lives in Task 1);
  - screens and components:
    - `src/ui/GenreSelect.tsx` → `src/ui/SectionSelect.tsx`
    - `src/ui/RecordForm.tsx`, `src/ui/BuyNewSheet.tsx`
    - `src/ui/Poster.tsx`, `src/ui/RecordCover.tsx`
    - `src/ui/FindRecord.tsx`, `src/ui/ShelfIntro.tsx`
    - `src/screens/ShelfScreen.tsx`, `src/screens/RecordScreen.tsx`, `src/screens/AddScreen.tsx`, `src/screens/EditScreen.tsx`, `src/screens/ShowScreen.tsx`
  - `src/index.css` (`--section-*`).
- Test: the existing tests are updated, and new tests are added as listed.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - **`RecordSchema`:**
    - `genre` is replaced by `sectionId: z.guid()`;
    - `recordToRow` / `newRecordToRow` write `section_id` and never `genre`;
    - `recordFromRow` reads `section_id` and ignores `genre`;
    - `EDITABLE_FIELDS` replaces `'genre'` with `'sectionId'`;
    - `FORM_FIELDS` and `RecordFormValues` replace `genre` with `sectionId`. Its error is `Choose a section`.
  - **Dexie version 7 upgrade** (synchronous body; uses `md5Hex` through `sectionIdFor`):
    - every stored record and every queued `record.create` gets `sectionId = sectionIdFor(shelfId, genre)` and loses `genre`;
    - every queued `record.patch` carrying `genre` gets `sectionId` in its place;
    - if there's a remembered session, the phone's sections for that shelf are seeded from `KAHRMANS_NINE` if any stored record has an `importKey`, else `STARTER_SET`, with derived ids and positions 0–8, unless sections already exist;
    - `lastPulledAt:*` meta keys are deleted, so the next sync is a full pull.
  - **Actions:**
    - `NewBuy.genre` → `sectionId`;
    - `addFound(found, ctx & { sections })` uses `sectionFor(found.genres, found.styles, sections)`;
    - `addRecord` / `boughtNew` take `sectionId`.
  - **Shelf:**
    - `type SectionFilter = 'all' | string` (a section id);
    - `shelfRows` filters by `record.sectionId`;
    - `spineColor(record, sectionsById, filter)`: when the filter is a section whose `discogsGenres` includes `Jazz`, it uses label colours, else `var(--section-${section.color})`. A record whose section isn't on the phone yet uses the catch-all's colour.
  - **`SectionSelect({ sections, value, onChange })`:** `All sections`, then the sections in order, each with its swatch.
  - **Pickers:** the section picker in `RecordForm` and `BuyNewSheet` (label `Section`, placeholder `Choose a section`) lists the shelf's sections in order.
  - **Colours:** `posterPlan(artist, title, colorKey: SwatchKey)` keeps today's accent rule by colour key (`rock` avoids brick, `popsoul` avoids bourbon). The RecordScreen confirmation uses the section's name. `ShelfIntro` uses `--section-*` colours.
  - **CSS:** `--section-{key}` variables for all 12 keys in both themes. The nine take today's `--genre-*` values, so Kahrman sees no colour change. Remove `--genre-*` once nothing uses it.

- [ ] **Step 1: Write the failing tests.**
  - **`dbUpgrade.test.ts`, version 7:**
    - a version-6 notebook (Kahrman-style, with an `importKey`, and signed in) and its queued creates and genre patches;
    - with no network, it opens with every record's `sectionId` correct, nine sections seeded in Kahrman's order, `lastPulledAt` gone, and queued postcards converted;
    - a version-6 notebook without `importKey` seeds the starter set.
  - **rowMapping:** `section_id` round-trips; `genre` is never written; a row with an extra `genre` still parses.
  - **actions:** `addFound` lands in the mapped section for each set; `boughtNew` takes `sectionId`.
  - **shelf and labels:** the filter by section; label colours for a Jazz-claiming section only; the fallback colour for an unknown section.
  - **poster:** the accent rule by colour key.
  - **The screens:** existing ShelfScreen, RecordForm, BuyNewSheet, FindRecord, AddScreen, EditScreen, ShowScreen and RecordScreen tests are updated to sections. Their behaviour assertions stay the same.
  - **New:** a FindRecord tap on a Discogs result with genre `Funk / Soul` lands in `Pop / soul / contemporary` on a Kahrman-set shelf, and in `Soul & Funk` on a starter shelf.
- [ ] **Step 2:** Run them and expect FAIL. Implement, then run `npx vitest run && npx tsc -b && npm run build` and expect PASS.
- [ ] **Step 3:** Commit: `feat(records): records belong to the shelf's own sections`.

---

### Task 5: Settings → Sections

**Files:**
- Create: `src/screens/SectionsScreen.tsx`, `src/ui/SectionSheet.tsx`
- Modify: `src/app/App.tsx` (route `/settings/sections`; keep the paper theme as `/settings` has), `src/screens/SettingsScreen.tsx` (a **Sections** link row, `h-12`)
- Test: `src/screens/SectionsScreen.test.tsx`, `src/ui/SectionSheet.test.tsx`

**Interfaces:**
- Consumes: `useSections`, `sectionActions` (Task 3), `perform`, the records hooks (counts of live records per section), and `ConfirmDialog`.
- Produces: the screen in spec §4.1.
  - **List:** a swatch, the name and the live record count per row, in position order.
  - **Tapping a row** opens `SectionSheet`:
    - Name, with an inline error for an empty or over-40 name, and a non-blocking note when it matches another section's name (ignoring case);
    - Colour, as a 12-swatch radio group;
    - `Discogs genres that go here`, 15 checkboxes. One claimed elsewhere shows `(in {other name})` and moves on check.
    - `Holiday records go here`, a switch;
    - **Move up** / **Move down**, disabled at the ends;
    - **Save** applies the changes as one `perform` of `editSection` (plus moves);
    - **Cancel** discards.
  - **⋮ per row:**
    - **Merge into…** chooses a target (every other section), then confirms with the verbatim message. `{n}` counts live records.
    - **Delete** is shown only when the live record count is 0 and the row isn't the catch-all, with a confirm.
    - The catch-all shows neither.
  - **+ Add** performs `createSection`, then opens its sheet.

- [ ] **Step 1: Write the failing tests.**
  - The list order and counts.
  - Rename and save gives one `section.patch`.
  - Taking a genre claimed by another section patches both.
  - Turning on holiday clears it on the other section.
  - Move up and Move down swap positions, and are disabled at the ends.
  - Merge with a confirm sends `section.merge`, and the records show in the target.
  - Delete appears only when empty.
  - The catch-all has no Delete or Merge.
  - + Add makes `New section` and opens it.
  - Cancel discards.
  - Tap targets are `h-12`.
  - The Settings link navigates to the screen.
- [ ] **Step 2:** Run them and expect FAIL. Implement, then run `npx vitest run && npx tsc -b && npm run build` and expect PASS.
- [ ] **Step 3:** Commit: `feat(settings): edit your shelf's sections`.

---

### Task 6: Go live with Kahrman

This task is run by the controller with Kahrman. Each **(OK)** step needs his explicit yes.

- [ ] **Step 1: Ready check:** `npx vitest run && npx tsc -b && npm run build`.
- [ ] **Step 2: Production read (no change):**
  - records per genre per shelf;
  - which shelves have records with `import_key` (expect only Kahrman's);
  - the members of every shelf.
- [ ] **Step 3 (OK): Apply the migration** with `npx supabase db push --remote --yes`. Then check that every record has a `section_id`, every shelf has exactly one catch-all, Kahrman's shelf has his nine in order, and the friends' shelves have the starter set.
- [ ] **Step 4 (OK): Push the branch for a test link.**
  - Kahrman checks that his shelf looks unchanged and tries Settings → Sections.
  - A friend renames and merges a section, then adds a record from Discogs.
- [ ] **Step 5 (OK): Merge to `main`.** Confirm the live bundle changed.
- [ ] **Step 6: Handoff notes.** Include the later clean-up: drop `records.genre`, its enum and the changeover triggers once every phone has updated.
