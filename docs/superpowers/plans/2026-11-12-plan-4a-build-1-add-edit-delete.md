# Plan 4a, Build 1: Add, Edit and Delete Records, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kahrman and Megan can add records by hand (quickly, many in a row), edit any record's details, and delete a record with an 8-second Undo. Every change goes through Plan 3's offline outbox.

**Architecture:**
- **Database:** one migration adds `fun_fact`, `fun_fact_source` and `cover_image_url` to records.
- **Actions:** four new pure actions (`addRecord`, `editRecord`, `deleteRecord`, `restoreWithEdits`) return postcards, as in Plan 3.
- **Form logic:** a plain `recordForm` module holds the form's values, validation, diffing and duplicate check.
- **Screens:** one `RecordForm` component serves two full screens, `/add` and `/record/:id/edit`.
- **Guards:** the auto-reload and the screens' own Back buttons wait for unsaved changes.

**Tech Stack:** existing: React 19, TypeScript, Vite, Dexie 4, Supabase JS, Zod 4, Tailwind 4 + Radix (`radix-ui`), Vitest + Testing Library + fake-indexeddb, PGlite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-plan-4a-add-edit-delete-design.md`. This plan covers **build 1 only** (§3 "Build 1", §4, §5, §7 build-1 items, §8 build 1). Build 2 (Claude and Discogs) gets its own plan.

**Baseline:** branch `plan-4a-add-edit-delete` (off `main` at `af307d4`, plus the spec commit). `npx vitest run` → 40 files / 322 tests; `npx tsc -b` clean.

## Global Constraints

- **Earlier plans still hold:**
  - artist reads first; price paid comes last and is never on spine rows;
  - inputs ≥ 16px; tap targets ≥ 48px;
  - no emoji or exclamation marks in UI copy;
  - curly apostrophes in copy, as the existing code uses;
  - every id is a uuid;
  - fail loudly.
- **Server and notebook:**
  - Screens reach the server only through `Backend`, and no `.upsert()`.
  - Every notebook write goes through `perform(db, postcards, after)` → `savePostcards`. `applyPostcard` is the only code that turns a postcard into notebook changes.
- **Migrations:** never edit an existing migration. New SQL goes in `supabase/migrations/20261112120000_record_details.sql`.
- **Routes and theme:**
  - `/add` and `/record/:id/edit` are **midnight** (not show paths, so `isShowPath` stays unchanged).
  - Add creates status **`owned`**.
- **Undo window:** 8000 ms, through the existing `useUndo().offer(label, undo)`.
- **Exact copy** (spec §5.2 and §5.5):
  - Shelf header button `Add`; screen titles `Add a record` / `Edit`.
  - Buttons `Save`, `Save and add another`; expander `More details`.
  - Errors:
    - `Add the artist`, `Add the title`, `Choose a genre`
    - `Year must be between 1900 and 2100`
    - `Fill both, or neither`, `Low can’t be more than high`
    - `Use a full web address (https://…)`
  - Duplicate line: `Already on the shelf: {title} ({disc grade or 'no grade'})` with link `Open it`.
  - Delete:
    - link text `Delete record`;
    - confirm `Delete {title}? It goes from both your shelves.` with `Delete` (danger) / `Keep it`;
    - Undo bar `Deleted {title}`.
  - Deleted elsewhere: `That record was deleted on another phone.` with `Restore with your changes` / `Leave it deleted`.
  - Unsaved: `Discard your changes?` with `Keep editing` (primary) / `Discard` (danger).
- **Record screen extras:** `Edit` button; fun fact under the notes, followed by `Source: {host}` as a link when there is a source.
- **Field limits:**
  - `fun_fact`: trimmed, at most 500 characters.
  - `fun_fact_source` and `cover_image_url`: must start with `https://`.
  - `fun_fact_source` is only allowed when `fun_fact` is set.
- **Every task ends green:** `npx vitest run` and `npx tsc -b`.
- **Commits:** messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge to `main` without Kahrman's OK.

## Controller ruling (spec §5.4 left this to the plan)

**No move to a data router.**
- **What's guarded:** "Discard your changes?" guards the form screens' own **Back** button. A `beforeunload` handler covers reloading or closing the tab.
- **What isn't:** the Android system back gesture is **not** guarded. iPhone home-screen apps have no system back gesture, which is how both phones are used today.
- **Why:** `useBlocker` needs `createBrowserRouter` and changes to every test that renders the app. That's too much for this gain.
- **If it's wrong:** an Android back gesture leaves the form and loses unsaved typing. Anything already saved is safe.

## Review Focus

1. **A double tap on Save or Save and add another** creates exactly one record. Test: Task 6 Step 1.
2. **Changing a field and then changing it back** leaves the form clean: no discard prompt and no postcard on Save. Tests: Task 4 Step 1, Task 7 Step 1.
3. **A comma in the price fields** (`15,50`, `1,200`) is read as $15.50 / $1,200, and low > high is caught *after* parsing. Test: Task 4 Step 1.
4. **The duplicate check** matches across case, accents and punctuation, ignores deleted records, and never flags the record being edited. Test: Task 4 Step 1.
5. **Undo after a delete has already reached the server** brings the record back on the server too. Test: Task 2 Step 1.

## File Map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261112120000_record_details.sql` | The three new columns, their checks and grants |
| `supabase/tests/recordDetails.test.ts` | Database tests for those columns |
| `src/data/schema.ts`, `src/data/rowMapping.ts` | The new fields in `RecordSchema`, the row mapping and `EDITABLE_FIELDS` |
| `src/domain/recordForm.ts` | Form values, parsing and validation, diffing, empty and sticky form, duplicate finder |
| `src/data/actions.ts` | `addRecord`, `editRecord`, `deleteRecord`, `restoreWithEdits` |
| `src/ui/GradePicker.tsx` | Nullable value, roving tabindex, arrow keys |
| `src/app/updates.ts`, `src/app/useUnsavedMark.ts` | The unsaved mark and the reload waiting for it |
| `src/ui/RecordForm.tsx` | The shared form |
| `src/screens/AddScreen.tsx`, `src/screens/EditScreen.tsx` | The two routes |
| `src/data/hooks.ts` | `useRecordAnyState` (includes deleted) |
| `src/screens/RecordScreen.tsx`, `src/screens/ShelfScreen.tsx`, `src/app/App.tsx` | The Edit button, fun fact, Add button, routes |

---

### Task 1: Database and record schema: fun fact and cover link

**Files:**
- Create: `supabase/migrations/20261112120000_record_details.sql`, `supabase/tests/recordDetails.test.ts`
- Modify: `src/data/schema.ts`, `src/data/rowMapping.ts`, plus every place a full `ShelfRecord` is built (`tsc -b` lists them: `importCollection.ts`, the `boughtNew` action, test fixtures)
- Test: `src/data/rowMapping.test.ts`

**Interfaces:**
- Produces:
  - `ShelfRecord` gains `funFact: string | null`, `funFactSource: string | null`, `coverImageUrl: string | null`.
  - `RecordRow` gains `fun_fact`, `fun_fact_source`, `cover_image_url`.
  - `EDITABLE_FIELDS` includes `funFact`, `funFactSource`, `coverImageUrl`.

- [ ] **Step 1: Write the failing tests**
  - **`supabase/tests/recordDetails.test.ts`** (`// @vitest-environment node`; reuse the Kahrman, Megan and stranger setup from `writes.test.ts`):
    - `a member can set a fun fact, its source and a cover link`: Megan's `update … set fun_fact='x', fun_fact_source='https://en.wikipedia.org/wiki/Ballads', cover_image_url='https://i.discogs.com/a.jpg' … returning id` returns 1 row.
    - `links must be https`: `fun_fact_source='http://x.com'` rejects with `/violates check constraint/`. The same for `cover_image_url`.
    - `a source needs a fun fact`: setting `fun_fact_source` with `fun_fact` null rejects.
    - `a fun fact is at most 500 characters`: 501 characters rejects; 500 passes.
    - `a stranger can’t set them`: 0 rows.
  - **`rowMapping.test.ts`:**
    - `recordFromRow` maps the three columns;
    - `patchToRow({ funFact: 'x' })` equals `{ fun_fact: 'x' }`;
    - `RecordSchema` refuses `funFactSource: 'http://x'` and refuses a `funFactSource` without a `funFact`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run supabase/tests/recordDetails.test.ts src/data/rowMapping.test.ts`
Expected: FAIL (no such columns; unknown fields).

- [ ] **Step 3: Implement**
  - **Migration:** `alter table public.records add column …` for the three columns, as nullable text, with checks:
    - `fun_fact is null or char_length(fun_fact) <= 500`
    - `fun_fact_source is null or (fun_fact_source like 'https://%' and fun_fact is not null)`
    - `cover_image_url is null or cover_image_url like 'https://%'`
    - Then `grant update (fun_fact, fun_fact_source, cover_image_url) on public.records to authenticated;`
  - **`RecordSchema`:** `funFact` is trimmed text, max 500, nullable; the two links are `z.string().startsWith('https://').nullable()`. Add a refine: a source needs a fact, with message `needs a fun fact`, path `funFactSource`.
  - **Mapping and fixtures:** add the fields to the row mapping and `EDITABLE_FIELDS`. Set them to `null` wherever records are built.

- [ ] **Step 4: Run the full suite and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add fun fact, its source and a cover link to records`)

---

### Task 2: Actions: add, edit, delete, restore

**Files:**
- Modify: `src/data/actions.ts`
- Test: `src/data/actions.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `ActionResult`, `perform` (actions.ts); `pushOutbox` (courier.ts); `FakeBackend`.
  - Defines `RecordFields` here, in `actions.ts`, for Task 4 to use:
    ```ts
    export const FORM_FIELDS = ['artist','title','genre','discGrade','sleeveGrade','label','catalog','year','format','notes','funFact','funFactSource','nmEstimateLow','nmEstimateHigh','valueNote','pricePaid'] as const;
    export type RecordFields = Pick<ShelfRecord, (typeof FORM_FIELDS)[number]>;
    ```
- Produces (in `actions.ts`):
  ```ts
  export function addRecord(fields: RecordFields, rating: number | null, ctx: Ctx & { shelfId: string; newId: string }): ActionResult;
  export function changedFields(opened: RecordFields, edited: RecordFields): Partial<RecordFields>;
  export function editRecord(record: ShelfRecord, opened: RecordFields, edited: RecordFields, ctx: Ctx): ActionResult; // postcards: [] when nothing changed
  export function deleteRecord(record: ShelfRecord, ctx: Ctx): ActionResult;       // undo: patch { deletedAt: null }
  export function restoreWithEdits(record: ShelfRecord, opened: RecordFields, edited: RecordFields, ctx: Ctx): ActionResult;
  ```
- **Rules:**
  - `addRecord` builds a full record:
    - status `owned`, `wantsUpgrade: false`, `addedBy: me`;
    - `createdAt` and `updatedAt` = `now`;
    - every field not in `fields` is null.
    - It checks the result with `RecordSchema`, throwing `BackendError` naming the field.
    - It returns `[record.create]`, plus `rating.set` when `rating !== null`.
  - `changedFields` compares with `===`, so number and null comparisons are exact.
  - `editRecord` and `restoreWithEdits` check the merged record with `RecordSchema` before returning.

- [ ] **Step 1: Write the failing tests**
  - `addRecord makes an owned record and, with a rating, a rating postcard`: 2 postcards, `fields.status === 'owned'`, then `rating.set { value: 4 }`. Without a rating: 1 postcard.
  - `addRecord refuses an empty title` (throws `/title/`).
  - `editRecord sends only what changed`: `opened.year = 1966`, `edited.year = 1967`, everything else equal → one `record.patch` with exactly `{ year: 1967 }`.
  - `editRecord sends nothing when nothing changed` (`postcards` is `[]`).
  - `two people editing different fields both keep their change`:
    - FakeBackend and a fresh db with one record;
    - Megan's edit (`notes`) reaches the server through `touchRecord`;
    - Kahrman's `editRecord` was opened before her change, so it's computed from his stale `opened` and only changes `year`;
    - perform → `pushOutbox` → `syncOnce`;
    - the server row and the notebook both have Megan's notes **and** the new year.
  - `deleteRecord marks it deleted; Undo after it reached the server brings it back` (Review Focus 5): perform → push → perform the undo → push → `fake.recordRow(id).deleted_at === null`.
  - `restoreWithEdits clears deletedAt and applies the edits` in one patch.

- [ ] **Step 2: Run them to see them fail.** Run: `npx vitest run src/data/actions.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the four actions and `changedFields`.

- [ ] **Step 4: Run the tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add the add, edit, delete and restore actions`)

---

### Task 3: GradePicker: no grade yet, and the keyboard fix

**Files:**
- Modify: `src/ui/GradePicker.tsx`
- Test: `src/ui/GradePicker.test.tsx`

**Interfaces:**
- Produces: `GradePicker({ value, onChange, part }: { value: Grade | null; onChange: (g: Grade) => void; part: string })`. Existing callers (PriceCheck, BuyNewSheet) keep passing a `Grade`.
- **Behaviour:**
  - **No grade:** with `value === null`, no radio is checked and the help line reads `Tap a grade.`
  - **Roving tabindex:** only one radio is in the Tab order. That's the checked one, or the first when none is checked.
  - **Arrow keys:** ArrowRight / ArrowDown move to the next grade, and ArrowLeft / ArrowUp to the previous, wrapping at the ends. Each move selects the grade (calls `onChange`) and moves focus. Home and End go to the first and last.

- [ ] **Step 1: Write the failing tests**
  - `with no grade, nothing is checked and it says Tap a grade.`
  - `only one grade is in the Tab order` (exactly one radio has `tabIndex 0`).
  - `arrow keys move and select`: focus NM, then ArrowRight → `onChange('VG+')` and VG+ has focus. ArrowLeft from Sealed wraps to P.
  - `Tab leaves the picker after one stop`: with two pickers and an input after them, Tab moves picker → picker → input.

- [ ] **Step 2: Run them to see them fail.** Run: `npx vitest run src/ui/GradePicker.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the full suite and the type check** (PriceCheck and BuyNewSheet tests must stay green). Expected: all pass.

- [ ] **Step 5: Commit** (`Let the grade picker start empty, and move through it with the arrow keys`)

---

### Task 4: Form logic, duplicate check and the unsaved mark

**Files:**
- Create: `src/domain/recordForm.ts`, `src/domain/recordForm.test.ts`, `src/app/useUnsavedMark.ts`
- Modify: `src/app/updates.ts`, `src/app/updates.test.ts`

**Interfaces:**
- Consumes: `FORM_FIELDS`, `RecordFields`, `changedFields` (Task 2); `normalise` (search.ts); `sanitizeAsking`, `parsePrice` (price.ts); `GENRE_KEYS`; `Grade`.
- Produces (`recordForm.ts`):
  ```ts
  export type RecordFormValues = {
    artist: string; title: string; genre: GenreKey | ''; discGrade: Grade | null; sleeveGrade: Grade | null;
    label: string; catalog: string; year: string; format: string; notes: string;
    funFact: string; funFactSource: string; nmLow: string; nmHigh: string; valueNote: string; pricePaid: string;
  };
  export type FormErrors = Partial<Record<keyof RecordFormValues, string>>;
  export function emptyForm(keep?: { genre: GenreKey | ''; label: string }): RecordFormValues;
  export function formFromRecord(r: ShelfRecord): RecordFormValues;
  export function parseRecordForm(v: RecordFormValues): { ok: true; fields: RecordFields } | { ok: false; errors: FormErrors };
  export function isDirty(opened: RecordFormValues, current: RecordFormValues): boolean;
  export function findDuplicate(records: ShelfRecord[], artist: string, title: string, excludeId?: string): ShelfRecord | null;
  ```
- **Parsing rules:**
  - text is trimmed, and `''` becomes `null`;
  - `year` is an integer from 1900 to 2100, else the year message;
  - money goes through `parsePrice`;
  - nmLow and nmHigh: both or neither, and low ≤ high, checked **after** parsing;
  - `funFactSource` is `https://…` and needs a fun fact;
  - the error copy is exactly the Global Constraints copy, keyed to the field.
- **`isDirty`** compares the **parsed meaning**: a field typed and then cleared back counts as unchanged, and so does `15,50` versus `15.5`. Implement it as `changedFields` on both parses when both parse; otherwise any raw difference counts.
- **`findDuplicate`:** the first non-deleted record whose `normalise(artist)` and `normalise(title)` both match, skipping `excludeId`. It returns `null` when artist or title is empty.
- **`useUnsavedMark(dirty: boolean): void`:** while `dirty`, it sets `document.body.dataset.unsaved = 'true'`, and removes it when clean or on unmount.
- **`reloadWhenSafe`** treats `[data-unsaved]` as "something open" too.

- [ ] **Step 1: Write the failing tests**
  - **`recordForm.test.ts`:**
    - each error message for its case;
    - `'15,50'` → `pricePaid: 15.5`;
    - `nmLow: '1,200', nmHigh: '900'` → `Low can’t be more than high`;
    - `year: '66'` → the year message;
    - `emptyForm({ genre: 'jazz', label: 'Impulse!' })` keeps only those two;
    - `formFromRecord` → `parseRecordForm` round-trips a full record's fields unchanged;
    - `isDirty` is false after typing a character and deleting it, and false for `'15.5'` vs `'15,50'` (Review Focus 2 and 3);
    - **`findDuplicate`** (Review Focus 4):
      - `('mötley crüe', 'GIRLS, GIRLS, GIRLS')` matches `Mötley Crüe` / `Girls, Girls, Girls`;
      - a deleted record isn't matched;
      - `excludeId` is honoured;
      - an empty title returns null.
  - **`updates.test.ts`:** `waits while a form has unsaved changes` (`document.body.dataset.unsaved = 'true'` → no reload until the app goes to the background).

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add the record form's rules, the duplicate check and the unsaved mark`)

---

### Task 5: The shared RecordForm

**Files:**
- Create: `src/ui/RecordForm.tsx`, `src/ui/RecordForm.test.tsx`

**Interfaces:**
- Consumes: Task 4 (values, parse, dirty, duplicates, `useUnsavedMark`); `GradePicker` (Task 3); `RatingRecords` (`value`, `onRate`); the shadcn `Select` with `GENRE_ITEM_CLASS`; `sanitizeAsking`.
- Produces:
  ```ts
  type Props = {
    mode: 'add' | 'edit';
    initial: RecordFormValues;
    records: ShelfRecord[];            // for the duplicate check
    excludeId?: string;                // edit: the record itself
    onSave: (fields: RecordFields, opts: { rating: number | null; another: boolean }) => Promise<void>;
    onOpenDuplicate: (id: string) => void;
    onDirtyChange?: (dirty: boolean) => void;
    footer?: ReactNode;                // edit: the Delete record link
  };
  export function RecordForm(props: Props): JSX.Element;
  ```
- **Layout** (spec §5.1):
  - **Short form:** Artist, Title, the duplicate line, Genre (placeholder `Choose a genre`), Disc grade (`part="Disc"`), and the rating as `Your rating · optional` (**add only**).
  - **`More details`:** a disclosure button with `aria-expanded`, collapsed for `add` and expanded for `edit`. Inside, in this order: Label, Catalog, Year (`inputMode="numeric"`), Pressing, Sleeve grade (`part="Sleeve"`), Notes (textarea), Fun fact (textarea, max 500) + Fun fact source, NM estimate low/high (`inputMode="decimal"`, sanitized), Value note, **Price paid last**.
  - **Buttons:** **Save** (bourbon, primary). **Save and add another** (outline) is shown only in `add`. Both are disabled while saving.
  - **Errors** sit under the field, with `aria-describedby`, and focus moves to the first field with an error.
- **Behaviour:**
  - **Saving:** a ref guard means a double tap saves once.
  - **Save and add another:** on success, the form resets to `emptyForm({ genre, label })` from the values just saved, clears the rating, and focuses Artist.
  - **Dirty tracking:** `useUnsavedMark(isDirty(initial, current))` and `onDirtyChange`.
  - **Failures:** an `onSave` rejection shows its message in a `role="alert"` line and keeps everything you typed.

- [ ] **Step 1: Write the failing tests**
  - `add starts short, More details opens the rest`.
  - `edit starts with More details open and no rating`.
  - `will not save without artist, title and genre` (all three messages; `onSave` not called).
  - `saves the parsed fields` (`onSave` gets `{ artist: 'John Coltrane', …, year: 1966, pricePaid: 15.5 }`, `rating: 4`, `another: false`).
  - `Save and add another keeps genre and label and clears the rest`.
  - `shows the duplicate line and Open it calls onOpenDuplicate(id)`.
  - `keeps what you typed when saving fails` (an alert with the message; fields unchanged).

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add the shared record form`)

---

### Task 6: The Add screen

**Files:**
- Create: `src/screens/AddScreen.tsx`, `src/screens/AddScreen.test.tsx`
- Modify: `src/app/App.tsx` (route `/add`), `src/screens/ShelfScreen.tsx` (an `Add` button in the header, beside `At the show`, as an outline button)

**Interfaces:**
- Consumes: `RecordForm`; `addRecord`, `perform`; `useSyncStatus().runNow`; `useCurrentShelf()`; `useShelfItems` (for `records`); `ConfirmDialog`.
- **Behaviour:**
  - **Title** `Add a record`, with a Back button (`‹ Shelf`).
  - **Saving:** `onSave` runs `addRecord(fields, rating, { me, now, shelfId, newId: crypto.randomUUID() })`, then `perform(…, runNow)`.
    - `another: false` → navigate to `/`.
    - `another: true` → stay on the screen; the form resets itself.
  - **Back** while dirty → `ConfirmDialog` with `Discard your changes?`, `Keep editing` / `Discard`.
  - **`beforeunload`** prevents unloading while dirty.
  - **`Open it`** on the duplicate line navigates to `/record/:id`, with the same discard check.

- [ ] **Step 1: Write the failing tests**
  - `the shelf header has Add, and it opens Add a record`.
  - `saving adds an owned record and returns to the shelf` (Dexie has the record with `status 'owned'`; the outbox has a `record.create`).
  - `rating while adding saves the rating too`.
  - `Save and add another stays, keeping genre and label`.
  - `a double tap on Save adds one record` (Review Focus 1).
  - `Back with unsaved changes asks first` (`Keep editing` stays; `Discard` goes to `/`); `Back with nothing typed just goes back`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run all tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Add records by hand from the shelf`)

---

### Task 7: The Edit screen, delete, and the Record screen's new bits

**Files:**
- Create: `src/screens/EditScreen.tsx`, `src/screens/EditScreen.test.tsx`
- Modify:
  - `src/app/App.tsx` (route `/record/:id/edit`)
  - `src/data/hooks.ts` (`useRecordAnyState`)
  - `src/screens/RecordScreen.tsx` (`Edit` button; fun fact and source), `src/screens/RecordScreen.test.tsx`

**Interfaces:**
- Consumes: `RecordForm`; `editRecord`, `deleteRecord`, `restoreWithEdits`, `perform`; `useUndo().offer`; `ConfirmDialog`; `formFromRecord`, `parseRecordForm`.
- Produces: `useRecordAnyState(shelfId: string, id: string | undefined): ShelfRecord | null | undefined`. It returns a record on this shelf **including** deleted ones, and null when the record is missing or on another shelf.
- **Behaviour:**
  - **Opening:** the form opens with `formFromRecord(record)`. Those values are frozen as `opened` for the life of the screen, so later syncs don't change what an edit is compared against.
  - **Save:** `editRecord(record, parse(opened), fields, ctx)`, then `perform(…, runNow)`, then navigate back to `/record/:id`. If there are no postcards, it just navigates.
  - **`Delete record`** (footer, quiet brick text) → `ConfirmDialog` `Delete {title}? It goes from both your shelves.` with `Delete` (danger) / `Keep it`.
    - On Delete: `perform(deleteRecord)` → navigate to `/` → `offer('Deleted {title}', () => perform(db, result.undo!, runNow))`.
  - **Deleted elsewhere:** if the live record has `deletedAt` set and it wasn't this screen that deleted it, show `That record was deleted on another phone.`
    - `Restore with your changes` → `perform(restoreWithEdits)` → `/record/:id`.
    - `Leave it deleted` → `/`.
  - **A record that's missing or on another shelf** → `That record isn’t on this phone.`
  - **Back** while dirty → the same discard dialog as Add, plus `beforeunload`.
  - **Record screen:**
    - an `Edit` button (outline, 48px) next to Back, linking to `/record/:id/edit`;
    - the fun fact as a paragraph after the notes, with `Source: {host}` as an external link (`target="_blank" rel="noopener noreferrer"`) when there's a source.

- [ ] **Step 1: Write the failing tests**
  - `Edit opens the record with More details open`.
  - `saving sends only the changed field and returns to the record`: change the year → the outbox has one `record.patch` with `{ year: … }`.
  - `changing a field and back saves nothing and asks nothing` (Review Focus 2).
  - `Delete asks, then goes to the shelf with Undo; Undo brings it back`.
  - `a record deleted on another phone offers Restore with your changes`: seed the record, open Edit, type a change, then set `deletedAt` in Dexie as a sync would. The message shows; Restore → the record is back with the change.
  - `a record from another shelf shows That record isn’t on this phone.`
  - **`RecordScreen.test.tsx`:**
    - `Edit opens the edit screen`;
    - `shows the fun fact and its source host` (`Source: en.wikipedia.org`, `href` the full URL);
    - `no Source line without a source`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run all tests and the type check.** Expected: all pass.

- [ ] **Step 5: Commit** (`Edit and delete records, and show the fun fact`)

---

### Task 8: Final review and go-live

The controller runs this with Kahrman; it's not a subagent task.

- [ ] **Step 1:** Run `npx vitest run && npx tsc -b && npm run build`. Expected: green, with more than 322 tests.
- [ ] **Step 2:** A whole-branch review (`superpowers:requesting-code-review`) against the spec and this plan's Review Focus. One fix wave, then a scoped re-review.
- [ ] **Step 3: Ask Kahrman first.**
  - Run `npx supabase db push --remote --dry-run`. Expected: only `20261112120000_record_details.sql`.
  - Then `npx supabase db push --remote --yes`.
  - Check production: `select column_name from information_schema.columns where table_name='records' and column_name in ('fun_fact','fun_fact_source','cover_image_url')` returns 3 rows.
- [ ] **Step 4: Ask Kahrman first.** Merge `plan-4a-add-edit-delete` into `main`, push, and wait for the Vercel production deploy to be READY. Confirm the live bundle contains `Add a record`.
- [ ] **Step 5: On the phones, by hand.**
  1. Add a record by hand, and see it on the other phone.
  2. Edit the year on one phone while the other edits the notes; both changes are kept.
  3. Delete, then Undo.
  4. Back with unsaved changes asks first.

  Record the results in `docs/superpowers/notes/plan-2-handoff.md` under a new "Plan 4a build 1" heading, then commit.
