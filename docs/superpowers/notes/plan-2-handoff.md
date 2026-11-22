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

# Plan 4a build 2a → next handoff

From build 2a's go-live (2026-11-22). Build 2a shipped "Find a record": a Discogs search on the Add screen, tap to save, and Undo.

## Must know
- **`discogs-search` Edge Function:**
  - holds `DISCOGS_TOKEN` as a Supabase secret;
  - checks the caller is a real signed-in user itself (`auth.ts`, `auth.getUser`). Supabase's `verify_jwt` let the public publishable key through on this project's new API keys, so `verify_jwt` is only a first layer;
  - returns 401 `not-signed-in` otherwise.
- **Setting secrets:** don't paste them into Terminal with `read -s`. zsh's bracketed paste stored escape codes inside the token. Use the Supabase dashboard (Edge Functions → Secrets), or `$(pbpaste)`.
- **Discogs terms** (spec §3):
  - facts are CC0 and kept;
  - images and results are never stored, and results over an hour old are cleared;
  - "Data provided by Discogs" appears next to Discogs data;
  - the notice is in Settings.
- **The Edge Function code is not type-checked locally** (no Deno). `supabase functions deploy` is the type check.

## Carry-overs
- Build 2b (Claude): the fun fact and tidying messy dictation. Needs an Anthropic Console account and a spending cap.
- "Your shelf sections" (`docs/ideas.md`): the genre table in `src/domain/discogsGenre.ts` becomes per-shelf data.
- Minor UX: an auth-server outage reads as "Sign in again to search."; the result-card status line could be an always-mounted live region; `parseInt` accepts years like "1978-05".
- The ten-record accuracy check on the phone (Task 6 Step 6) is still to do.

# Plan 4b build 1 → next handoff

From build 4b-1's go-live (2026-11-22). Build 4b-1 shipped record photos: front and back, taken on the phone, automatically cropped to the sleeve and squared up, stored privately for the shelf, Flip on the Record screen, photos on Add and Edit.

## Must know
- **Storage layout:**
  - private bucket `covers` (2 MB, JPEG only);
  - path = `{shelfId}/{recordId}/{side}-{photoId}.jpg`, which is also the value of `records.cover_path` / `back_path`;
  - check constraints tie a path to its own shelf, record and side;
  - `storage.objects` policies use `public.can_use_cover(name)` (first folder = a shelf you're a member of);
  - every photo gets a fresh `photoId`, so paths are never reused.
- **Phone side:**
  - Dexie v5 holds `photos` (bytes as ArrayBuffer, never Blob: Blobs don't survive fake-indexeddb) and `photoDrafts`;
  - the v5 upgrade forgets `lastPulledAt:*` so the first pull refetches `back_path`;
  - any future column needs the same treatment if old apps could have pulled rows that have it.
- **Outbox:**
  - `photo.upload` / `photo.delete` postcards, in the order create → uploads → patch → deletes;
  - a refused delete counts as sent (spec: not the person's problem);
  - uploads get a 120 s timeout (`timeoutFor` in `src/data/supabase.ts`), and everything else gets 15 s.
- **OpenCV.js** (`@techstark/opencv-js` 4.12.0-release.1, about 10.8 MB):
  - **Loading:** loaded lazily through the `src/photo/opencv.ts` wrapper. The package's Module is a thenable that froze the production build and Vitest, so keep the wrapper and `test.deps.interopDefault: false`.
  - **Caching:** kept out of the precache, and runtime-cached CacheFirst by a plugin that only keeps real JavaScript responses (a Vercel rewrite could otherwise cache index.html as OpenCV).
  - **Fallback:** if it fails or doesn't load within 20 s, photos fall back to the centre square.
- **iPhone camera:** `input.click()` must run synchronously inside the tap. That's why the back needs its own "Take the back" tap and why the tips-seen flag is read before any tap.
- **Unsaved mark:** `useUnsavedMark` is reference-counted, because Edit has two marks (form and photos).
- **Test links:** branch previews have Vercel SSO protection, so you sign in to Vercel first. The stable link is `the-shelf-git-<branch>-kahrman0915s-projects.vercel.app`. Previews use the production Supabase.

## Carry-overs
- **Build 4b-2 (recognition):** Claude Haiku reads both photos → Discogs by barcode, then catalog number, then name.
  - It needs an Anthropic Console account with a spending cap. `ANTHROPIC_API_KEY` is set in the Supabase dashboard, never in Terminal.
  - The Add screen's "Now find it below…" line is the placeholder that recognition replaces.
- **Deferred, rare or cost-only:**
  - Undo still uploads, then deletes, photos not yet sent.
  - Undo can overwrite drafts taken during the undo window.
  - Sign-out silently clears unsaved drafts.
  - A late download can land in a cleared notebook.
  - Photo downloads still time out at 15 s.
  - Orphaned files can stay in the bucket (no cleanup job).
- **Watch on the phone:** memory when decoding full-resolution photos (24 MP), and how often squaring misses. If it misses often, add the corner check (approach A from the design).
- The flaky `App.test.tsx` sign-in / sign-out tests under full parallel load.

# Plan 4c → next handoff

From Plan 4c's go-live (2026-11-22). Plan 4c shipped two things:
- **Claude reads the sleeve:** photos are read by `identify-record` (Claude Haiku 5.5, then Discogs by barcode → catalog number → name), and an exact match saves with the photos.
- **Sourced fun facts:** `fun-fact` (Haiku 5.5 with web search) adds a fact after each save on the phone that saved it. Older records get a **Find a fun fact** button.

The opening animation now shows three shelves of record-thin spines.

## Must know
- **Secrets:** `ANTHROPIC_API_KEY` is a Supabase function secret, set by Kahrman in the dashboard. The Anthropic Console's monthly limit is the only spending stop; there are no per-person limits.
- **Shared server code:** it lives in `supabase/functions/_shared/` (auth, the Discogs request, shapes, and the `Read` / `Identified` types the app imports type-only). Deploy all three functions together after a shared change.
- **`identify-record`:**
  - it answers within a 26 s budget (`deadline.ts`) so the app's 30 s never runs out first;
  - reading uses `thinking: disabled` and 4096 max tokens;
  - a match is exact only for a single barcode or catalog-plus-artist result, with Discogs' own total equal to 1;
  - the barcode search is vinyl only.
- **`fun-fact`:**
  - it uses effort low and 8192 max tokens;
  - the source must be one of the URLs the web search returned (exact match);
  - the reply text is joined across blocks.
- **Logs:** a stop reason other than `end_turn` is logged by name.
- **The fun-fact queue:**
  - it lives in notebook meta (`funFactQueue`, plus the `funFactNone:` / `funFactFailed:` flags);
  - it runs only after the session's first sync, waits out the Undo window for Find saves, makes at most two tries with one 60 s delayed retry, and stops at sign-out.
- **Reading the sleeve (`useReadSleeve`):**
  - each set of photos is read once, after a 250 ms settle;
  - Undo hands back the same photos byte for byte, and they're skipped rather than read again;
  - a card tap, typing in Find or the hand form takes over from the reading.
- **Tests:** `src/test/setup.ts` wraps `structuredClone`, because fake-indexeddb returns ArrayBuffers from another realm.
- **No local Deno:** only the pure modules are tested. The smoke test is one signed-in call per function, then reading the function logs.

## Carry-overs
- **The ten-sleeve accuracy check was skipped at merge.** Do it on real records: exact and right, any wrong pressing, facts against their sources, and the cost from the Console.
- **One fun fact opened with "Not a 1971 album…"** about a reissue. Watch the tone; the prompt could say the pressing year may be a reissue's.
- **Deferred:**
  - a TypeError after a request was sent counts no try;
  - "Couldn't read the sleeve" is shown even when only Discogs is down;
  - photos still waiting are read again on returning to Add;
  - FindRecord is about 430 lines;
  - the fun-fact live region and focus need an accessibility pass;
  - `publicKey`/CORS code is copied into three functions;
  - `discard` sets `lastSyncedAt` before any pull.
