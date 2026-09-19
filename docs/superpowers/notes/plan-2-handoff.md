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
