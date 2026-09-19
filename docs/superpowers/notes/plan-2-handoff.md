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
