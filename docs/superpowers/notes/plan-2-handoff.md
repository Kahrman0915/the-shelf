# Plan 1 → Plan 2 handoff

From the final review of Plan 1 (2026-09-19). Plan 2 (Supabase, sign-in, sync) must address these before any write feature ships.

## Must do in Plan 2
- **Local ids are placeholders.** `shelfId: 'local-shelf'` and `userId`/`addedBy: 'local-kahrman'` (src/data/session.ts) are not UUIDs; the spec's tables use uuid foreign keys. Tighten `RecordSchema.shelfId`/`addedBy` and `RatingSchema.userId` to `z.uuid()`.
- **Record ids differ per phone.** Each phone's seed generates its own random UUIDs for the same 11 records. Import once, server-side, deduplicated by `import_key`; a Dexie version 2 upgrade clears the local-shelf rows; remove boot seeding and the bundled `collection.json` from the app.
- **`import_key` should be unique per shelf**, not globally (spec §6 says `text unique`; make it unique on (shelf_id, import_key)), or two friends' imports could collide.
- **Every check-then-write belongs inside one Dexie `rw` transaction** (the seeding race fixed in 6247414 is the pattern to avoid in the outbox).
- **Ask the browser to keep storage** (`navigator.storage.persist()`) before the outbox can hold unsent changes.

## Carry-overs worth fixing when the file is next touched
- GradePicker: roving tabindex before Plan 3 puts two pickers (disc + sleeve) on one form.
- SpineRow: a shorter accessible name when rows open the Record screen.
- PriceCheck: unused `id="asking"`.
- Search `normalise` drops non-Latin letters (ø, æ, ß).
- Native search clear (×) button is browser blue.
- 590 kB main bundle.

# Plan 2 → Plan 3 handoff

From Plan 2's final review (2026-09-19). Plan 3 adds the outbox and the first writes.

## Must do in Plan 3
- **Clearing the phone must not destroy unsent changes.** Sign-out and "no session at startup" both call `clearPhone`. Before clearing, check the outbox: warn, or refuse until it has sent.
- **Push before pull.** `pullShelf` bulk-puts server rows and replaces all ratings; it would overwrite local edits not yet sent. Send the outbox first and skip the pull if sending fails, or re-apply pending changes on top of what was pulled.
- **No `.upsert()` for ratings or records.** Column-level UPDATE grants freeze `records.id/shelf_id/added_by/created_at/import_key` and allow only `ratings.value`; Postgres checks UPDATE privilege on every upsert column, so upserts fail. Insert new rows; PATCH only the changed editable fields.
- **New functions are callable by every signed-in person by default** (anon is locked out). Any new SECURITY DEFINER function must revoke/grant explicitly and check `auth.uid()`.
- `updated_at` is stamped by the server on insert and update; the phone's clock never decides what syncs.
- Ask the browser to keep storage (`navigator.storage.persist()`) before the outbox can hold unsent changes.

## Worth doing in Plan 3
- `SyncNotice` shows "Couldn't reach the shelf" for every sync error; show real failures (bad rows, permission) differently.
- `useRecord` isn't scoped to the current shelf.
- `settle()` falls back to the phone's copy on any server error, not only no-signal.
- Missing tests: `bootstrap()` shared-shelf-not-deleted, others' empty shelf untouched, JWT without email, accepted invite not re-processed; a `useSync` unit test.
- Tidy: `shelves.created_by`/`records.added_by` FK delete behaviour; members leaving a shelf; `(select auth.uid())` in policies.

# Plan 3 → Plan 4 handoff

From Plan 3's final whole-branch review (2026-11-11). Plan 3 shipped the outbox, the courier, Bought it (price check and sheet), Undo, Didn't buy it, rating on the Record screen, New arrivals and the poster.

## Must know in Plan 4
- **Every write goes through `perform` → `savePostcards`.** New write features (add/edit, delete, want list, cover photos) add postcard kinds to `src/data/outbox.ts` and handle them in `applyPostcard` and `src/data/courier.ts`. Nothing else may write the notebook from a postcard.
- **Push runs are serialized per notebook** (`courier.ts`), and every pull checks the remembered session inside its own transaction. Keep both properties.
- **The courier can't tell "not signed in" from "refused".** A dead login is now caught at startup, but a login that dies mid-session still shows waiting changes as rejected. Consider checking the session before pushing.
- **Sign-out is local-only** (`scope: 'local'`): signing out on one device no longer signs out the others.
- **Hung reads:** supabase-js retries a timed-out GET three times, so a hung read takes about 67 s before it counts as no signal (unless the go-live fix below landed).
- Open questions carried from the spec (§12): buying a second copy of something you own; whether a rating can be cleared; "Back to the want list" as a second choice in Didn't buy it.

## Carry-overs
- GradePicker roving tabindex (two pickers arrive with the edit sheet); RatingRecords has no arrow-key radiogroup behaviour either.
- Native search clear (×) is browser blue; the main bundle is still large.
- Live regions: the Record screen's rating confirmation and the Undo bar mount with their text, so some screen readers may not announce them.
- Test gaps the task reviews listed: the Record screen alert path, the sheet's save-failure path, the pile's 3-bar cap, midnight theme on `/arrivals`.
- Record screen design notes from Kahrman's first look: the artist shows twice (poster band and heading); the poster runs edge to edge with square corners.

## Go-live notes
- `npx supabase db push` applies **two** migrations: `20261111120000_shelve_on_first_rating.sql` and `20261111120100_bootstrap_requires_email.sql`. Run `npx supabase migration list --linked` first to confirm production lists both Plan 2 migrations.
- The migrations go live **before** the app: without the trigger, a rating sent from the new app would leave the record in New arrivals on the server.

# Plan 4a build 1 → build 2 handoff

From build 1's final review (2026-11-12). Build 1 shipped add, edit and delete by hand, the fun fact, and the shared form.

## Must know for build 2 (Claude + Discogs)
- **Dexie is at version 4.** Any new record field needs a version bump with an upgrade that fills it on existing rows *and* on queued `record.create` postcards (see `db.ts` v4). Records already on phones never get re-pulled for a column change.
- **Paired fields travel together** in `changedFields`: `[nmEstimateLow, nmEstimateHigh]` and `[funFact, funFactSource]`. The spec's "an untouched field is never sent" now reads "an untouched pair is never sent".
- **`cover_image_url` exists but nothing writes or shows it yet.** Build 2 adds both.
- **`reloadWhenSafe` waits on `[data-unsaved]`.** Any new form should use `useUnsavedMark` and `useLeaveGuard`.
- **Migrations must go live before the app.** `recordFromRow` fails loudly if a column is missing.

## Carry-overs
- A flaky test: `SettingsScreen.test.tsx` "lists who is on the shelf" failed once under full-suite load. Look into it properly.
- The Android back gesture isn't guarded (plan ruling).
- A grade can't be cleared back to "none" once set.
- `1,200,000` typed into a price is read as 1.2 (Plan 3's price helpers).
- The Record screen design notes still stand: the artist appears twice, and the poster runs edge to edge.
