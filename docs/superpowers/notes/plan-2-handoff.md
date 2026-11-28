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

# Plan 5 → next handoff

From Plan 5's go-live (2026-11-23). Plan 5 shipped "Your shelf sections": each shelf has its own sections, with name, colour, order, Discogs genres, a holiday flag and one catch-all. They're edited in Settings → Sections.

## Must know
- **Tables and records:**
  - `public.sections` (per shelf) and `public.section_redirects` (`from → into`, written by `merge_section`);
  - `records.section_id` is NOT NULL and references `sections`.
- **Who has which set:** Kahrman's shelf (identified by records with `import_key`) has his nine: Jazz / big band … Christmas, with Miscellaneous as the catch-all at position 4. Every other shelf, and every new one through `bootstrap()`, has the starter set (Jazz, Rock, Soul & Funk, Pop, Country & Folk, Reggae, Soundtracks, Christmas, Everything else).
- **Derived ids:** the seeded sections have ids `md5(shelf_id || ':' || legacy_genre)::uuid`, and the phone computes the same with `sectionIdFor` (`src/domain/sections.ts`, sync MD5 in `md5.ts`). Validate them with `z.guid()`, not `z.uuid()`.
- **The changeover:**
  - `records.genre` is still kept filled by the `records_fill_section` trigger, from each section's `legacy_genre`;
  - an old-app genre write goes to that genre's own seeded section first, follows redirects (scoped to the record's shelf), and falls back to the catch-all;
  - writes naming an unknown or merged section are rerouted, never refused.
- **The claim trigger:**
  - setting holiday, or claiming Discogs genres, takes them off the shelf's other sections;
  - it needs **one section row per statement**;
  - the phone mirrors it inside `applyPostcard`.
- **Delete is a merge into the catch-all.** It also moves soft-deleted records, which can be restored. A member can't insert a section with an id that was merged away (`section_was_merged`).
- **Dexie:** v6 adds the sections store; the v7 upgrade converts records and queued postcards offline, seeds the set and forgets the last pull.
- **Deadlocks:** Postgres `40P01` and `40001` count as no signal, so they're retried later.
- **Colours:** the nine section colours equal the old genre colours. There are 12 swatches (plus teal, slate and sand), as `--section-{key}`.

## Carry-overs
- **Later clean-up,** once every phone has updated: drop `records.genre`, the `public.genre` enum, `legacy_genre`, and the changeover parts of `records_fill_section`.
- **Live check not done:** Kahrman merged without trying the test link. Check that the shelf looks unchanged, and try Settings → Sections on a phone.
- **Deferred:**
  - a resent `section.create` after a merge on another phone shows a "permission" reason;
  - the holiday hint row is fixed at `h-12` and can wrap past it;
  - a section removed by a raw SQL delete leaves no redirect, so its id can be taken by another shelf;
  - tie-swaps with three sections sharing a position;
  - P0001 refusals shown as "(P0001)";
  - some loading-state screens have no tests.

# Plan 6 → next handoff

From Plan 6's go-live (2026-11-28). Plan 6 shipped the **Want list**, **upgrades** and **Claude's record suggestions**: a Want list screen (`/want`) with Wanted, Upgrades and Suggested for you; adding wants by Discogs search (`/want/add`); a Want a better copy switch on Edit; and Check price · Bought it from a record.

## Must know
- **Wants are records** with `status = 'wanted'`. The shelf still lists only owned records. An album is never both owned and wanted: in shelf mode, a card (or Claude's photo match) for a want-only album saves nothing and points to the want instead (rulings R9, R11).
- **`public.suggestions`** (migration `20261123130000`): members select and insert (pending only) and update only `status, decided_by, decided_at`; no delete; anon has nothing. The phone pulls it in full on every sync (Dexie v8 store `suggestions`) and decides through the `suggestion.patch` postcard. A patch for a vanished row counts as sent (R6).
- **Edge Function `suggest-records`**: Claude Sonnet 5.5 (`claude-sonnet-5-5`, effort medium, `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta, via `client.beta.messages.create`), asks for 12, keeps up to 8 that match a real Discogs vinyl release by normalised artist and title; 50 s budget, Claude ≤ 35 s, no retries. Reads with the caller's sign-in and pages past PostgREST's 1000-row cap. Logs name only statuses and error names. Needs 5 rated records.
- **Suggest more** pulls once after a timeout or lost reply, so a round that finished server-side shows without a second charge.
- **Suggestion cards** show the cover and album details by a live Discogs lookup (by stored release id, then normalised match), kept in memory only, never saved (Discogs terms). Lookups run one at a time, time out at 20 s, and stop on rate-limit or no signal (R12, R13). Offline cards show artist, title and reason.
- **Bought it on a want** queues a fun fact after the undo window; an undone purchase (record back to `wanted`) is skipped by the fun-fact runner.
- **Order matters:** the app's pull fails outright if a table it reads is missing, so ship migrations before the app.

## Live checks (2026-11-26 → 28)
- Migration applied; RLS on, anon refused (HTTP 401), column grants as above.
- Function deployed; both secrets present; unsigned calls 401; boot 95 ms, no errors.
- Kahrman ran Suggest more on the test link and approved the richer cards. The other want flows (add by search, upgrade, Bought it from the list) weren't reported on, and the Claude cost per round hasn't been read from the Console yet.

## Carry-overs
- **Flaky tests under load:** AddScreen "Undo after a recognised save brings the photos back without reading them again" and SectionsScreen "lists the sections in order with their live record counts" (and once useReadSleeve offline) sometimes miss the 1 s `findBy` wait; DB tests can hit 30 s hook timeouts when run alongside heavy work.
- **Design calls for Kahrman:** at 390 px the settings gear wraps onto its own row; the upgrade switch sits below Save on Edit; a new arrival is told to turn on Want a better copy but Edit only shows it for owned records; a wanted record's screen still offers Find a fun fact.
- **Deferred:**
  - Want list calls `pullShelf` outside the sync queue (heals on next sync);
  - one unparseable suggestion row fails the whole pull;
  - two members tapping Suggest more together can save the same album twice (adding the second is handled);
  - section counts on the Sections screen include wants;
  - `upgradeDirty` false positive (switch on, type, switch off);
  - missing direct tests: upgrade-only save, leave guard on upgrade change, `restoreWithEdits` path, swallowed fun-fact failure, offline branch of the card lookup, the no-pull short-circuits;
  - `void add()/dismiss()` would leave an unhandled rejection if `perform` threw;
  - Want list headings read (0) while loading;
  - the card-lookup hook imports a constant from `supabaseBackend`;
  - no `deno check` was run locally (Deno not installed); the live function booted and answered correctly.
