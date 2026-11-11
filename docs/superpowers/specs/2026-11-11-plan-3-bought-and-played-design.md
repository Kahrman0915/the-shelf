# Plan 3: Bought it, then played it (design spec)

Date: 2026-11-11
Status: approved in conversation, awaiting written review
Builds on: `2026-09-18-the-shelf-design.md` (the original spec), `../notes/plan-2-handoff.md`
Live app: https://the-shelf-sigma.vercel.app (Supabase project `rlhhrzkaosngafcoxaas`, Pro plan)

This spec covers **Plan 3** in full and outlines **Plan 4** so the two fit together. Plan 4 gets its own brainstorm and spec before it is built.

---

## 1. What Plan 3 is for

After Plan 3, a record show works end to end on the phone, with or without signal:

> Search → price check → **Bought it** (one tap) → the record waits in **New arrivals** → at home, open it, **rate it** → it moves onto the shelf, on both phones.

Plan 2 made the app read-only. Plan 3 adds the first writes and the outbox that carries them.

## 2. Decisions made in this brainstorm

| # | Decision | Choice |
|---|---|---|
| 1 | Size | Split: **Plan 3** = outbox + buying loop + Record screen + poster. **Plan 4** = add/edit, want list and upgrades, cover photos, delete |
| 2 | Genre for a record bought that isn't in the collection | **Picked at the show** in the Bought it sheet. `genre` stays `not null` |
| 3 | Price paid | **Taken from the asking-price box** when you tap Bought it. Optional. Never required |
| 4 | Mistakes | **Undo** for ~8 s after Bought it, plus **Didn't buy it** on New arrivals |
| 5 | Where New arrivals lives | **A pile row on top of the shelf**, only shown when the pile has something. It opens the New arrivals screen. The want list gets a matching row in Plan 4 |
| 6 | Where you rate | **On the Record screen**, five large records. You stay on the screen; a line confirms where it went |
| 7 | Poster | **In Plan 3** (moved from Plan 4) |
| 8 | Signing out with unsent changes | **Try to send first, then ask**: "Stay signed in" (main) or "Sign out and delete" (small, red) |
| 9 | Outbox design | **Postcards of changed fields** on the phone + **one database trigger** for "first rating → on the shelf" |
| 10 | Bought it on a want or upgrade | **One tap**, no sheet (the original spec's "one tap logs it"). A sheet only for records not in the collection |
| 11 | Playwright | **Dropped.** Screen tests with a fault-injecting fake backend cover the flows (see §10) |

## 3. Scope

### In Plan 3
- **Outbox and courier:** writes save on the phone at once and send when there is signal; push before pull; storage kept.
- **Bought it:**
  - from the price check, for wants and upgrades (one tap);
  - from "Not in your collection", via a sheet.
  - Wants can't be created until Plan 4, so in real use only the "not in your collection" path is reachable in Plan 3. The want and upgrade paths are still built and tested here.
- **Undo** bar after Bought it; **Didn't buy it** on New arrivals.
- **New arrivals:** the pile row on the shelf, and the New arrivals screen.
- **Record screen:** opened from shelf rows and from New arrivals.
- **Rating:** set or change your own. A first rating from anyone moves a new arrival to the shelf.
- **Poster placeholder** component, added to the design system.
- **Handoff tidy-ups:**
  - shelf rows open the Record screen, with a shorter accessible name;
  - `useRecord` is scoped to the current shelf;
  - sync and session errors tell "no signal" apart from real failures;
  - `settle()` falls back to the phone's copy only on no-signal;
  - the missing tests from the Plan 2 handoff.
- **Corrections** to the original spec (§11).

### Not in Plan 3 (on purpose)
- No Bought it on an owned record that doesn't want an upgrade (a second copy is a Plan 4 question).
- No Bought it on a record already in New arrivals.
- No clearing a rating back to "unplayed" (you can change it).
- No editing a record's facts, no deleting a record, no photos (Plan 4).

## 4. The outbox

Picture (from the original spec): the phone holds a **notebook**, a **courier** carries changes. Plan 3 gives the courier a bag of **postcards**.

### 4.1 The postcard

A new Dexie table `outbox` (Dexie version 3, store `'++seq, recordId, state'`):

| field | type | meaning |
|---|---|---|
| `seq` | auto-increment | place in line |
| `kind` | `'record.create' \| 'record.patch' \| 'rating.set'` | what to do |
| `shelfId` | uuid | the shelf it belongs to |
| `recordId` | uuid | the record it is about |
| `userId` | uuid | who made the change |
| `fields` | object | `record.create`: the whole new record. `record.patch`: **only** the changed fields. `rating.set`: `{ value }` |
| `createdAt` | ISO string | phone time, for display only |
| `state` | `'waiting' \| 'rejected'` | |
| `reason` | string \| null | the plain-words reason when rejected |

### 4.2 Saving

Every action (§5) returns the notebook changes and the postcards it needs. One function, `applyPostcard(notebook, postcard)`, turns a postcard into notebook changes. It is used both when saving and when re-applying after a pull (§4.4), so the two can never disagree.

Saving runs in **one Dexie `rw` transaction** that covers the records, ratings and outbox tables: it applies the changes and adds the postcards. Either all of it is written or none of it is.

The first time a postcard is ever written, the app calls `navigator.storage.persist()` and stores the answer in `meta`.

### 4.3 Sending (the courier's push)

The courier runs on app open, on reconnect, when the app comes back to the foreground, every 60 s while visible (as in Plan 2), **and right after any action**. Only one run happens at a time. Each run sends `waiting` postcards in `seq` order, one at a time.

**Every send is safe to repeat.** At a show, the server can save a change while the reply is lost, so the phone sends it again.

| kind | how it is sent | already done / repeated |
|---|---|---|
| `record.create` | `insert` the row. `created_at` and `updated_at` are stamped by the server | Duplicate key on `id` (Postgres `23505`) → counts as sent |
| `record.patch` | `update` only the fields in the postcard, `where id = recordId`, returning the id | 0 rows → **rejected**: "That record is no longer on your shelf." |
| `rating.set` | `update ratings set value` where `(record_id, user_id)`, returning. If 0 rows → `insert`. If the insert hits a duplicate key → `update` again | Repeats are harmless |

No `.upsert()` anywhere: the column-level UPDATE grants make upserts fail (Plan 2 handoff).

**Outcomes of a send:**
- **Sent:** the postcard is deleted.
- **No signal** (the existing `offlineLooking` test): stop the run and keep everything. The next trigger tries again.
- **Rejected** (permission, constraint, missing row): set `state = 'rejected'` and `reason` = a plain-words message, never the raw Postgres error. Later postcards **for the same `recordId`** are skipped in this run, because they may depend on it. Postcards for other records carry on.

### 4.4 Pulling (after pushing)

The run order is **push, then pull**. The pull runs after every push attempt, unless the push stopped for no signal.

After `pullShelf` has written the server's rows, and **in the same transaction**, every postcard still in the outbox (`waiting` and `rejected`) is re-applied in `seq` order with `applyPostcard`. A create is re-applied only if the record is missing.

> **Rule:** the notebook always equals the server plus my unsent changes. A pull can never overwrite local work.

### 4.5 Rejected postcards

They are shown in the header notice (§9) with two buttons:
- **Try again** sets `state = 'waiting'` and starts a run.
- **Discard** deletes the postcard and every later postcard for the same record, then does a **full pull** (`since = null`) so the notebook matches the server again.

### 4.6 The database trigger

New migration: after a rating is **inserted**, a record that is `new_arrival` becomes `owned`.

- Function `public.shelve_on_first_rating()`, `returns trigger`, `security invoker`, `set search_path = ''`. It runs `update public.records set status = 'owned' where id = new.record_id and status = 'new_arrival'`.
- Trigger: `after insert on public.ratings for each row`.
- **Invoker, not definer:** the rater already has `update (status)` and passes the "members edit records" policy. This avoids the risky SECURITY DEFINER path the handoff warns about.
- `revoke execute` on the function from `public`, `anon` and `authenticated`. Trigger functions don't need it, and the handoff says new functions must be explicit about who can run them.
- The phone applies the same rule locally (`rating.set` in `applyPostcard`), so the screen changes instantly. **The phone does not send a status patch for this**; the trigger does it on the server.

### 4.7 Signing out, and expired sessions

- **Sign out** with postcards in the outbox:
  1. Run the courier once.
  2. If postcards remain, show a dialog: "*N* changes haven't reached the shelf yet. Signing out deletes them." The main button is **Stay signed in**. A smaller danger button, **Sign out and delete**, clears the outbox with the rest of the phone.
  3. If the outbox is empty, sign out as today.
- **No session at startup** (expired or signed out elsewhere):
  - If the outbox is empty, clear the phone as today.
  - If not, **keep the notebook and outbox** and show sign-in.
  - After the code is verified: if it's the same `userId` as the postcards, keep them and send them.
  - If it's a different person: show a dialog, "*N* changes from the previous person on this phone haven't been sent. Continuing deletes them." The main button is **Go back** (to sign-in); the secondary danger button is **Continue and delete**.
- `clearPhone` also clears `outbox`. Every path into it goes through the checks above.

### 4.8 Times

- `bought_at` uses the phone's clock: it's a fact about the purchase.
- `updated_at` is always stamped by the server; the phone's clock never decides what syncs (Plan 2 rule, unchanged).

## 5. Actions

Each action is a **pure function**: `(record or input, me, now) → { postcards, undo? }`.
- It throws a `BackendError` with a plain message if the result would break `RecordSchema`.
- The notebook changes come from applying the postcards (§4.2).
- A separate, thin `perform(action)` writes the result in one transaction and starts the courier.

| Action | Allowed when | Postcards | Undo |
|---|---|---|---|
| **Bought it: want** | `status = wanted` | `record.patch { status: 'new_arrival', boughtAt: now, discGrade, pricePaid }` | `record.patch` back to the previous values of those four fields |
| **Bought it: upgrade** | `status = owned` and `wantsUpgrade` | `record.patch { discGrade, sleeveGrade: null, pricePaid, boughtAt: now, wantsUpgrade: false, upgradeNote: null }`. Status stays `owned`; ratings untouched | `record.patch` back to the previous values of those six fields |
| **Bought it: not in collection** | from the sheet | `record.create` with: a new uuid made on the phone, `status: 'new_arrival'`, artist, title, genre, `discGrade`, `pricePaid`, `boughtAt: now`, `addedBy: me`, `wantsUpgrade: false`; everything else null | `record.patch { deletedAt: now }` |
| **Didn't buy it** | `status = new_arrival` | `record.patch { deletedAt: now }` | none; a confirm dialog asks first |
| **Rate** | `status` is `new_arrival` or `owned` (not `wanted`: you can't rate what you haven't played) | `rating.set { value }` (1–5). Locally, if `status = new_arrival` → `owned` | none; tap another value to change it |

- **Undo** is held in memory by an app-level `UndoProvider`. It shows the bar for **8 s**, across route changes, and is gone after that or on reload. Tapping **Undo** performs the undo postcards like any other action.
- **Didn't buy it in Plan 3 always removes** (soft delete), because every pile record in Plan 3 was created at the show. Plan 4 adds "Back to the want list" for pile records that started as wants.

## 6. Screens

Mockups were reviewed in the brainstorm. Tokens, type and components come from the design system (https://claude.ai/artifact/MeqZFkmspRtmaUUaP2e7pK) and `src/index.css`.

### 6.1 Routes and themes

| Route | Screen | Theme |
|---|---|---|
| `/` | Shelf | midnight |
| `/arrivals` | New arrivals | midnight |
| `/record/:id` | Record | midnight |
| `/show` | At the show | paper |
| `/price/:id` | Price check | paper |
| `/settings` | Settings | paper (unchanged) |

`useModeTheme` changes from "anything but `/` is show" to an explicit list. Show mode is `/show` and `/price/*`; the remembered mode (`shelf:mode`) follows the same list.

### 6.2 Shelf: the pile row

- **When:** shown above the spines only when at least one `new_arrival` exists.
- **Look:** up to three thin bars in the waiting records' genre colours, then "New arrivals · *N*" and, underneath, the first artists, truncated.
- **Behaviour:** tapping it opens `/arrivals`.
- **Shape:** a raised rounded panel, so it never reads as one more spine.
- Shelf spine rows now open `/record/:id`. Their accessible name is "*artist*, *title*".

### 6.3 New arrivals

- **Content:** spine rows of `new_arrival` records, newest `bought_at` first. A row opens `/record/:id`.
- **Back:** to the shelf.
- **Empty state:** "Nothing waiting. Records you buy at a show land here."

### 6.4 Record

**From top to bottom:**
1. Back: to wherever you came from, falling back to `/`.
2. The poster (§7), square, full width.
3. A status tag when relevant: New arrival, Want list or Upgrade.
4. Artist (bold), title, then the meta line: year · label · catalog · format.
5. **Grades:** disc and sleeve, with "not graded" when null.
6. **Your rating:** five large records (accessible name "*n* of 5, *word*"). Tapping one rates and shows "*word* · On the shelf · *Genre*" when it moved the record, otherwise just the word.
7. **Other members' ratings:** read-only, one line each, "*Name* · *word*" or "*Name* · Unplayed".
8. Notes, upgrade note and value note, when present.
9. Price paid as a small muted line ("Paid $15") when known. Never prominent.
10. **Didn't buy it:** quiet danger text at the bottom, only on `new_arrival`. It confirms with "Remove *title* from New arrivals?", then returns to New arrivals.

- No edit button in Plan 3.
- `useRecord(shelfId, id)` returns null for records on other shelves and for deleted records.

### 6.5 Price check: Bought it

- The **"They're asking" box always shows** when Bought it is available, even with no estimate. The verdict still needs an estimate.
- **Bought it** (the primary bourbon button) sits under the verdict, only for wants and upgrades.
- A line under the button says what will be logged: "Logs VG+ · $15 paid", or "Logs VG+" when the box is empty.
- One tap performs the action, shows the Undo bar ("In New arrivals" or "Upgrade logged"), and stays on the screen.

### 6.6 At the show: not in your collection

- The "Not in your collection or want list." message gets a **Bought it** button. It opens a bottom sheet (Radix Dialog) with:
  - **Artist:** prefilled with the trimmed search text, required.
  - **Title:** required.
  - **Genre:** the nine genres, no preselected value, required.
  - **Disc grade:** the same GradePicker, default NM.
  - **Price paid:** optional, ≥ 0, last.
  - The primary button **Bought it**.
- **Validation:** a Zod schema for the sheet. Errors appear next to the field, and nothing saves until it passes.
- **After saving:** the sheet closes, the Undo bar shows, and the search results now include the record tagged New arrival.

### 6.7 Header notice

`SyncNotice` grows to show the outbox (§9). It appears on every screen that has it today, plus New arrivals and Record.

## 7. The poster placeholder

A React component `<Poster artist title genre theme />` that renders an SVG. It is pure and deterministic, so the same inputs always draw the same poster.

1. **Seed:** normalise artist and title (lowercase, strip accents with NFKD, punctuation → space, collapse spaces, trim). Hash `artist|title` with FNV-1a 32-bit, then feed the hash to a mulberry32 generator. The normaliser keeps non-Latin letters, which fixes the handoff note about `normalise`.
2. **Colours:**
   - The genre colour for the current theme.
   - Two accents in random order from bourbon, brick and teal, **skipping the one that clashes with the genre**: rock skips brick, pop/soul skips bourbon.
   - The ground is the theme surface.
3. **Composition** on a 6 × 6 grid in a 300 × 300 viewBox:
   - a large genre-colour circle (radius 1.4–2.3 cells, centre on the grid);
   - a square block in accent 1;
   - a small circle or bar in accent 2;
   - a skyline of rectangles along the lower third, with a few lit windows in bourbon (navy on paper, near-black on midnight);
   - a bottom band (ink colour) with the artist in Bebas Neue, sized to fit (18–40), and the title in Libre Franklin 12, truncated at 40 characters.
4. **Accessibility:** `role="img"`, `aria-label="Poster for artist, title"`.
5. **Theme:** the layout is identical on paper and midnight; only the colours follow the theme.
6. **Design system:** added as a component with its rules. The brainstorm mockup is a sketch; proportions can be refined in the design system before it's built.

## 8. Backend interface

`Backend` gains these. Screens and actions never call Supabase directly.

```ts
insertRecord(row: RecordRow): Promise<'inserted' | 'already-there'>;
patchRecord(id: string, fields: Partial<RecordRow>): Promise<'patched' | 'missing'>;
setRating(recordId: string, userId: string, value: number): Promise<void>;
```

- They throw `BackendError(NO_SIGNAL)` for no signal and a `BackendError` with a plain message for everything else.
- The courier tells them apart by that message constant, as `useSession` does today.
- The fake backend (`src/test/fakeBackend.ts`) implements them, plus three switches for tests: **no signal**, **reply lost** (the change is saved but the call throws no-signal), and **reject next** (with a reason).

## 9. Errors

| Situation | Header notice |
|---|---|
| Changes waiting, offline | "Saved on this phone · *N* waiting to send" (calm, not an error colour) |
| A postcard rejected | "*N* change(s) couldn't be saved: *reason*", with **Try again** and **Discard** |
| Pull: no signal | "Couldn't reach the shelf" (unchanged) |
| Pull: any other failure (bad row, permission) | "The shelf sent something this app can't read: *detail*" or "You don't have access to this shelf any more". Not the no-signal message |

- **Sheet inputs** are validated before saving (§6.6).
- **Every action's result** is checked against `RecordSchema` before it reaches the notebook. A failure writes nothing and shows its message.
- **Storage not kept:** if `navigator.storage.persist()` returns false, Settings shows one line: "This phone may clear unsent changes if it runs low on space."
- **Raw Postgres messages are never shown;** they are mapped to plain sentences. Unknown errors show "The shelf refused this change." followed by the error code.

## 10. Testing

**Rules (Vitest):**
- Every row of §5's action table, including the want and upgrade paths, and undo for each.
- `applyPostcard` for each kind, including "first rating → owned" and "create only when missing".
- **The courier:**
  - order;
  - no-signal stop;
  - reply lost then resend (no duplicate record or rating);
  - rejection holds later postcards for the same record and not for others;
  - Try again;
  - Discard plus full pull;
  - re-apply after a pull (a pulled row doesn't overwrite a waiting patch).
- **Sign-out guard:** empty outbox; can send; can't send → dialog.
- **Startup without a session:** with postcards; then same person; then different person.
- **Poster:** same inputs → identical SVG; the clash rule; normalisation (case, accents, non-Latin letters kept).
- `useSync` (missing per the handoff).

**Database (PGlite harness from Plan 2):**
- **The trigger:**
  - moves `new_arrival` → `owned` on the first rating insert;
  - leaves it alone on a rating update;
  - does nothing for `wanted` or `owned`.
- Patching records and setting ratings works within the column grants; `deleted_at` can be patched.
- A member of another shelf can't patch your records or rate them.
- Missing `bootstrap()` tests from the handoff:
  - a shared shelf isn't deleted;
  - someone else's empty shelf is untouched;
  - a JWT without an email;
  - an accepted invite isn't processed again.

**Screens (React Testing Library + fake backend):**
- The pile row appears with a new arrival and disappears when it is rated.
- Bought it shows only for wants and upgrades, and logs the selected grade and the asking price.
- Undo reverses within 8 s.
- The sheet blocks saving without artist, title or genre.
- Rating on the Record screen confirms "On the shelf · *Genre*".
- Didn't buy it confirms, then removes.
- The header notice covers each state in §9.

**By hand, on both phones:**
1. Airplane mode → search → Bought it (not in collection) → close the app.
2. Reopen online → it sends → it appears on Megan's phone.
3. Megan rates it → it moves to the shelf on Kahrman's phone.
4. Offline with a change waiting → Sign out → the dialog appears; **Stay signed in** keeps it.

## 11. Corrections to the original spec

- **Supabase is on the Pro plan.** Projects don't pause, so the keep-awake GitHub Action (`.github/workflows/keep-supabase-awake.yml`) is removed in Plan 3. `ping()` stays; it's harmless.
- **Sign-in codes are sent through Gmail SMTP,** not Supabase's built-in sender. A domain plus Resend is still the plan for when friends join.
- **§4 / §5:** Record screen, rating and the poster ship in Plan 3. Add/edit, the want list and upgrades, and cover photos ship in Plan 4.
- **§12 Testing:** Playwright is dropped in favour of screen tests with a fault-injecting fake backend (§10 above).
- **§9 Errors:** the outbox notice wording is in §9 of this spec.

## 12. Plan 4 outline (to be brainstormed separately)

- **Add / edit sheet:** all fields, artist first, price paid last. Two GradePickers (disc + sleeve) with roving tabindex (handoff carry-over). NM estimates (both or neither).
- **Delete a record** (soft delete), with confirmation.
- **Want list:**
  - a matching pile-style row on the shelf, and a Want list screen with Upgrades as its own section;
  - adding a want;
  - marking an owned record "wants upgrade" with a note;
  - "Back to the want list" as a second choice in Didn't buy it.
- **Cover photos:**
  - a camera input, resized on the phone to ~1200px JPEG;
  - a `cover.upload` postcard kind, with the image held in Dexie until sent;
  - a private bucket `covers/<shelf_id>/<record_id>.jpg` readable only by the shelf's members;
  - viewed covers cached on the phone;
  - the poster stays as the fallback.
- **Open questions for that brainstorm:**
  - buying a second copy of something you own;
  - whether a rating can be cleared;
  - the remaining carry-overs (the native search clear button colour; the 590 kB bundle).
