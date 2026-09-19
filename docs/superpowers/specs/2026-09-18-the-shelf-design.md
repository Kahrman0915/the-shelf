# The Shelf: design spec

Date: 2026-09-18
Status: approved in conversation, awaiting written review
Scope of this spec: **Project 1, the shelf.** Projects 2–4 are recorded at the end so this one leaves room for them.

Design system (tokens, components, shadcn mapping): https://claude.ai/artifact/MeqZFkmspRtmaUUaP2e7pK

---

## 1. What it is

A vinyl collection app for Kahrman and Megan, installed on their phones from the home screen (a PWA, no App Store). Friends get their own shelves later.

It serves two moments that are different jobs and never share a screen:

- **At a record show.** One hand, fast, bad signal. Do I own this? Is it on the want list? What's a fair price for *this* copy's condition? If I buy it, one tap logs it.
- **At home.** No urgency. Pick a genre by mood, look at covers, choose something to play. Records either of us didn't love stay marked so we never have to replay them to remember.

After a show: bought records sit in **New arrivals** (the pile by the turntable) until someone listens and rates them, which moves them onto the shelf.

## 2. Fixed decisions (from the brief, not to be re-litigated)

- **Genres are exactly nine, in this order:** Jazz / big band, Rock, Pop / soul / contemporary, Popular pop, Miscellaneous, Country, Reggae, Soundtracks, Christmas. Genre is a **dropdown defaulting to "All"**, never chips. Genre is also the "mood" at home.
- **Goldmine grading:** Sealed, M, NM, VG+, VG, G+, G, P. Disc and sleeve graded separately. VG means *worn*, and the UI says so.
- **Colour encodes the current filter.** All genres: the spine bar is the genre colour. Filtered to Jazz: the bar is the record label (Impulse! orange, Blue Note blue, Argo purple, others grey).
- **Artist reads first**, then title, then year / label / catalog.
- **Price paid is deliberately minor.** Never required, never a headline, never on a spine row.
- **Reference lives at the point of decision.** Grading help inside the grade picker; pricing help inside the price check.
- **Rows read like spines in a crate:** colour bar, then text. Not cards.
- **Don't:** tracklists; fetching album art (covers are our own photos); live price claims without a real, dated source; features nobody asked for.
- **Fail loudly.** A script or sync that can't do its job stops and says what's wrong. It never writes partial or guessed data.

## 3. Decisions made in design conversation

| Decision | Choice |
|---|---|
| Stack | React + TypeScript + Vite PWA, Supabase (Postgres, Auth, Storage), Vercel, GitHub |
| Design system | Tailwind + shadcn/ui (Radix), restyled with The Shelf tokens |
| Look | Vintage jazz poster: geometric, bold, midnight skyline, bourbon speakeasy |
| Themes | **Paper** = show mode (cream, high contrast). **Midnight** = home mode (navy, bourbon) |
| Ratings | **Per person.** 1–5, drawn as five records. No rating = "unplayed". 1–2 = "Didn't love it" |
| Sign-in | **Email + 6-digit code** (no magic links: they open Safari, not the home-screen app) |
| Sharing | Different emails, **same shelf** via membership. Friends get separate shelves |
| At the show | **One tap "Bought it"** → New arrivals; details and cover photo finished at home |
| Mood | Genre is the mood. AI mood picks come later (Project 3) |
| Existing value ranges | Imported as **Near Mint estimates**, labelled "estimate" |
| Missing cover | **Generative poster placeholder** seeded from artist + title, in the genre colour |
| Folder | Project lives in `~/Developer/the-shelf` (outside iCloud); GitHub is the backup |

## 4. Scope of Project 1

**In:**
- Email-code sign-in; shelf created on first sign-in; invite Megan by email.
- Import of `collection.json` (11 records).
- Shelf screen: spines, search, genre dropdown, the colour rule.
- Show mode: search → Own it / Want list / Upgrade / not yours → price check → Bought it.
- Price check using Near Mint estimates × grade shares (Discogs comes in Project 2).
- New arrivals; rating moves a record to the shelf.
- Want list; "wants upgrade" on owned records.
- Record detail with both people's ratings; add and edit by hand.
- Cover photos from the camera; generative poster placeholder.
- Offline: reads from the phone's copy; writes queue until signal.
- Installable on the home screen.

**Out (later projects):** Discogs prices, voice to inventory, AI want-list suggestions, AI mood picks, friends' shelves, trading.

## 5. Screens

| Screen | Theme | Job |
|---|---|---|
| **Shelf** | midnight | Genre dropdown (default All), spine rows, search. Tap a row → Record |
| **At the show** | paper | One large search field. Each result tagged Own it / Want list / Upgrade, or shown as not in the collection. Tap → Price check |
| **Price check** | paper | Grade picker for the copy in hand → price ladder with that grade highlighted → asking price → verdict → **Bought it** |
| **New arrivals** | midnight | Records bought but not yet rated. Rating one moves it to the shelf |
| **Want list** | either | Wanted records; Upgrades as a separate section |
| **Record** | either | Cover or poster placeholder, facts, disc + sleeve grades, both ratings, notes, value note, edit |
| **Add / edit** | sheet | Artist first. Only artist and title required. Price paid optional and at the bottom |
| **Sign in** | paper | Email → 6-digit code |
| **Shelf settings** | either | Shelf name, members, invite by email, sign out |

- A header button **At the show** switches to paper theme and puts search first; **Home** switches back. Manual, remembered on the device.
- Rows rated 1–2 by the viewing person show muted with "Didn't love it" and sort to the bottom of the shelf.
- The Discogs notice is not needed until Project 2.

## 6. Data model (Supabase Postgres)

Picture: the **shelf** is a house, **members** hold keys, **records** are what's on the shelves, **ratings** are one sticky note per person on a record.

### Types

- `genre`: enum `jazz, rock, popsoul, popularpop, misc, country, reggae, soundtracks, christmas` (display order = this order).
- `grade`: enum `Sealed, M, NM, VG+, VG, G+, G, P`.
- `record_status`: enum `wanted, new_arrival, owned`.
- `member_role`: enum `owner, member`.

### Tables

**`profiles`**: `id` (= auth user id, pk), `display_name` text not null, `created_at`.

**`shelves`**: `id` uuid pk, `name` text not null, `created_by` → profiles, `created_at`.

**`shelf_members`**: `shelf_id` → shelves, `user_id` → profiles, `role` member_role, `created_at`. PK (`shelf_id`, `user_id`).

**`shelf_invites`**: `id` uuid pk, `shelf_id`, `email` text (stored lowercase), `invited_by`, `created_at`, `accepted_at` null. On sign-in, any open invite matching the user's email adds them to that shelf and sets `accepted_at`.

**`records`**:

| column | type | rule |
|---|---|---|
| `id` | uuid pk | generated on the phone so offline creates work |
| `shelf_id` | uuid → shelves | not null |
| `status` | record_status | not null |
| `wants_upgrade` | boolean | default false; only meaningful when owned |
| `upgrade_note` | text | null |
| `artist` | text | not null, trimmed, non-empty |
| `title` | text | not null, trimmed, non-empty |
| `label` | text | null |
| `catalog` | text | null |
| `year` | smallint | null; 1900–2100 |
| `format` | text | null (the pressing) |
| `genre` | genre | not null |
| `disc_grade` | grade | null |
| `sleeve_grade` | grade | null |
| `price_paid` | numeric(8,2) | null = unknown; ≥ 0 |
| `nm_estimate_low` / `nm_estimate_high` | numeric(8,2) | null, or both set with low ≤ high |
| `value_note` | text | null |
| `notes` | text | null |
| `discogs_release_id` | integer | null (used from Project 2) |
| `cover_path` | text | null → poster placeholder |
| `bought_at` | timestamptz | set by Bought it |
| `added_by` | → profiles | not null |
| `created_at` / `updated_at` | timestamptz | `updated_at` set by trigger on every change |
| `deleted_at` | timestamptz | null; soft delete so deletes sync |
| `import_key` | text unique | null; the old slug id, makes the import safe to re-run |

**`ratings`**: `record_id` → records, `user_id` → profiles, `value` smallint 1–5, `updated_at`. PK (`record_id`, `user_id`). No row = unplayed for that person.

### Status rules

- **Bought it** on a `wanted` record → `new_arrival`, sets `bought_at`, `disc_grade` from the price check, optional `price_paid` and photo.
- **Bought it** on something not in the collection → creates a `new_arrival` with the typed artist/title and the chosen grade. Everything else is filled in at home.
- **Bought it** on an owned record with `wants_upgrade` → updates grades, clears `wants_upgrade`, keeps ratings (same album, better copy).
- First rating saved on a `new_arrival` by anyone → `owned`.
- Imported records → `owned`.

### Access rules (row-level security, enforced by the database)

- A member can read and write the records, invites and members of their own shelves; nothing else.
- Ratings on your shelf's records are readable by all members; each person can write only their own.
- Only an owner can invite or remove members.
- Grades, genres, statuses and rating range are enforced by the types above, so the database rejects anything invalid even if the app has a bug.

## 7. Price logic

### Grade shares (share of the Near Mint price)

| Sealed | M | NM | VG+ | VG | G+ | G | P |
|---|---|---|---|---|---|---|---|
| 1.30 | 1.15 | 1.00 | 0.50 | 0.25 | 0.15 | 0.10 | 0.05 |

VG+, VG, G+, G follow Goldmine's rule of thumb; Sealed, M and P are our assumptions. **Floor: $3.** No range drops below it.

### Estimate ranges (Project 1)

Fair range at grade *g* = (`nm_estimate_low` × share(*g*), `nm_estimate_high` × share(*g*)), each rounded to whole dollars and floored at $3. Shown with "~" and "estimate". A record with no estimate shows **"No price yet: add a Near Mint estimate"**, never $0.

### Discogs ranges (Project 2, recorded now so the check is built for it)

Discogs returns one suggested price per grade (M, NM, VG+, VG, G+, G, F, P; no Sealed, so Sealed uses M; F is ignored). The fair range for a grade runs **halfway to the grade below and halfway to the grade above**; top and bottom grades extend by the same half-step; floor $3. Shown with its fetch time. **Discogs prices are never stored in the database and never shown more than 6 hours after fetching** (Discogs API terms). A "Get ready for the show" action fetches prices for the want list; after 6 hours the check falls back to the estimate.

### Verdict

Asking price below the range → **Good buy** (teal). Within → **Fair** (bourbon). Above → **Overpriced** (brick). The word always carries the meaning; colour backs it up. The ladder shows every grade with the chosen one highlighted, so disagreeing with a seller's grade shows its cost.

## 8. Label colours (Jazz filter)

The label field is free text. A small mapping in code normalises it: anything matching `impulse` → Impulse!, `blue note` → Blue Note, `argo` → Argo, everything else → other. Case-insensitive, ignores punctuation (`impulse!/ABC` → Impulse!).

## 9. Architecture

Picture: **the phone holds a notebook, a courier carries changes.**

- **Notebook:** Dexie (IndexedDB) holds the full shelf: records, ratings, members, plus viewed cover images. **Every screen reads from the notebook**, so search is instant and works offline.
- **Outbox:** every change is written to the notebook and queued in an outbox table in Dexie.
- **Courier (sync):** when online (on app open, on reconnect, every ~60s while open): push the outbox in order, then pull everything with `updated_at` newer than the last pull, including soft-deleted rows.
- **Conflicts:** the outbox sends only the fields that changed, so two people editing different fields both win. Same field: the last one to arrive wins. Ratings can't conflict (per person).
- **Master copy:** Supabase. A new phone signs in and refills its notebook.

| Part | Tool |
|---|---|
| App | React 18+, TypeScript, Vite |
| Routing | React Router |
| Local store + live queries | Dexie + `dexie-react-hooks` |
| Backend | Supabase (Postgres + RLS, Auth email OTP, Storage) |
| Validation | Zod: one schema per table, shared by import, forms and sync |
| Styling | Tailwind + shadcn/ui, tokens from the design system |
| PWA | vite-plugin-pwa (manifest, icons, offline app shell) |
| Hosting | Vercel, deploys on push to `main` |
| Tests | Vitest (logic), Playwright (a few flows) |

### Photos

Captured with the camera input, **resized on the phone to ~1200px JPEG** before upload (~200 KB), queued in the outbox like any change, stored at `covers/<shelf_id>/<record_id>.jpg` in a private bucket readable only by that shelf's members.

### Poster placeholder

A deterministic SVG generated from a hash of artist + title: genre colour plus two token colours, circles and square blocks on the paper or midnight ground, artist in the display face. Same record, same poster, every time. Added to the design system as a component.

## 10. Import of collection.json

- Validate **all** records with Zod first. Any failure stops the import and prints the record id and field. Nothing is written.
- Mapping: `id` → `import_key`; `valueLow`/`valueHigh` → `nm_estimate_low`/`high`; `grade` → `disc_grade`; `sleeveGrade` → `sleeve_grade`; `addedAt` (ms) → `created_at`; `""` → null; `year` string → smallint or null; **`price: 0` → null**; `rating > 0` → a Kahrman rating row, `rating 0` → no row; `coverId` dropped (photos re-attached in the app). Status `owned`.
- Re-running is safe: `import_key` is unique, so existing records are skipped, never duplicated.
- The empty `wantlist` imports nothing.

## 11. Errors

- **Outbox is visible:** a header mark shows "2 changes waiting to send". A rejected change is shown with its reason and kept, never silently dropped.
- **Sign-in errors** say what to do ("That code expired. Send a new one").
- **Price check** never shows $0 or an undated number.
- **Two locks:** Zod in the app, types + constraints + RLS in the database.

## 12. Testing

- **Unit (Vitest):** grade shares and floor; estimate ranges; Discogs half-step ranges; verdicts; import mapping (0 → null, "" → null, rating → rating row); label normalisation; genre vs label colour rule; poster placeholder is deterministic.
- **Access (against a local Supabase):** a non-member reads nothing; a member can't write another person's rating; only owners invite.
- **Flows (Playwright):** sign in with a test code; Bought it moves a want to New arrivals; rating moves it to the shelf.
- **On the phone, by hand:** install; airplane mode; search → price check → Bought it with photo; airplane mode off; change appears on Megan's phone.

## 13. Open assumptions (to confirm while building)

- Genre spine colours are a first pass (rock and pop/soul borrow brick and bourbon).
- Rating words: Not for me · Didn't love it · Good · Love it · Desert island.
- Sealed ×1.30, M ×1.15 and P ×0.05 are our guesses.
- Show mode is a manual toggle.

## 14. Later projects (not in this spec)

1. **Discogs prices.** Match records to releases (search by catalog/barcode/artist+title), price suggestions per grade, marketplace stats. Requires Kahrman's Discogs account with seller settings filled in; personal token stored as a Supabase Edge Function secret. 60 requests/minute. Show the required notice: "This application uses Discogs' API but is not affiliated with, sponsored or endorsed by Discogs. 'Discogs' is a trademark of Zink Media, LLC." Friends will likely need their own Discogs connection (OAuth).
2. **AI** (Claude via Supabase Edge Function; key never on the phone). In order: **voice to inventory** (iPhone keyboard dictation → Claude drafts records with suggested grades → review stack → confirm each; nothing saved silently), want-list suggestions from both people's ratings ("Megan loves this, Kahrman loves that"), mood picks from the shelf that skip anything either person rated 1–2.
3. **Friends.** Own shelves; read-only viewing of each other's shelf; trade/sell flags (lowest priority; "Didn't love it" records are the natural trade pile).

## 15. Decisions for Plan 2 (2026-09-19)

- **Supabase project:** `rlhhrzkaosngafcoxaas` (https://rlhhrzkaosngafcoxaas.supabase.co).
- **Email:** Supabase's built-in sender for now; Megan is added to the Supabase team so her codes arrive. A custom domain + Resend comes when friends join. Both email templates (Magic Link, Confirm signup) show the 6-digit `{{ .Token }}`.
- **First-time import:** a one-time script run from Kahrman's Mac with the secret key (never in git or the app) copies `collection.json` into his shelf, skipping anything already imported (`unique (shelf_id, import_key)`). Kahrman's existing ratings come with it.
- **Joining:** `bootstrap()` runs on every sign-in and app open while online: makes the profile, accepts any open invite for the person's email, removes their own empty unshared shelf if they were invited elsewhere, and creates a shelf if they have none. One shelf per person in Plan 2.
- **Sync in Plan 2 is pull-only:** records incrementally by `updated_at` (with a 5-minute overlap), ratings and members fully refreshed, on open, on reconnect, when the app comes back to the foreground and every 60 s while visible. The outbox ships in Plan 3 with the first write features. Invites are online-only.
- **Keep-awake:** a scheduled GitHub Action calls a harmless `ping()` function every 3 days so the free project never pauses.
- **Keys:** the publishable key goes to Vercel and `.env.local`; the secret key lives only in `.env.local` on Kahrman's Mac.
- **Plan 1 clean-up:** Dexie v2 clears the local-only rows; the bundled seed and the placeholder ids leave the app; ids are uuids everywhere; signing out clears the phone.
- **Opening:** the last task of Plan 2 dresses the sign-in screen with the shelf-filling intro (plays once per device, instant under reduced motion).
