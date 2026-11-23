# Plan 6: Want list, upgrades and Claude's suggestions (design)

Date: 2026-11-23
Status: draft; awaiting builder check and Kahrman's approval
Builds on:
- the original spec `2026-09-18-the-shelf-design.md` (want list; "wants upgrade"; AI want-list suggestions from both people's ratings);
- Plan 3 (Bought it, New arrivals);
- Plan 4a/4c (Find a record, Claude Edge Functions);
- Plan 5 (sections).

## 1. Intent

The original spec's show-day questions: *"Do I own this? Is it on the want list? … If I buy it, one tap logs it."*

Kahrman (2026-11-23): *"I also want the ai to suggest records I would like based on my ratings of other records. And add those to my want list."* Asked whether suggestions go straight onto the list or are seen first: **"See it first"**. Asked whose taste counts: **"Both"**, meaning his and Megan's ratings together.

**Today's groundwork:**
- records already support `status = 'wanted'`, `wants_upgrade` and `upgrade_note`;
- At the show tags results "Want list" and "Upgrade";
- Bought it moves a want to New arrivals and logs an upgrade.

**What's missing:**
- a way to add a want, to mark an upgrade, and to see the list;
- suggestions.

No record on any shelf is wanted or marked for upgrade yet.

**Success:**
- Adding a want takes a search and a tap.
- Marking an upgrade takes one switch.
- At a show, the list and the tags tell you what to look for.
- **Suggest more** gives about 8 real records that both of you would plausibly like, each with a reason, that you can add in one tap or dismiss.

**Anti-goals:**
- A suggestion added to the want list without a tap.
- An invented album, or one never released on vinyl.
- The same suggestion coming back after "Not for me".
- Surprise spending (suggestions run only on request).
- Wants cluttering the shelf.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Suggestions | **Seen first.** They appear under **Suggested for you** with **Add to want list** / **Not for me** (Kahrman) |
| 2 | Whose taste | **Both members' ratings** on the shelf, with the reason naming who liked what (Kahrman). On a one-person shelf, that person's |
| 3 | Adding a want by hand | *Proposed:* the existing **Find a record** search, reached through **+ Add** on the Want list. Tapping a pressing makes a want |
| 4 | Album or pressing | *Proposed:* a want is **the album** by default. A **This pressing only** switch on the Add flow keeps the tapped pressing's label, catalog number, year and Discogs id |
| 5 | Upgrades | *Proposed:* **Want a better copy** switch plus an optional note, on the Edit screen of an owned record |
| 6 | Want list screen | *Proposed:* reached by a **Want list** button beside At the show and Add on the shelf. Three groups: **Wanted**, **Upgrades** and **Suggested for you** |
| 7 | When suggestions run | *Proposed:* **only on request**, by **Suggest more**: about 8 a round |
| 8 | Model | *Proposed:* **Claude Sonnet 5.5** (`claude-sonnet-5-5`), for its music knowledge. A few cents a round |
| 9 | Checked on Discogs | *Proposed:* each suggestion must match a real Discogs vinyl release, or it's dropped |
| 10 | Kept and shared | *Proposed:* suggestions are stored on the shelf, seen by every member, and stay until acted on. Dismissed ones are remembered and never suggested again |

## 3. Approaches

- **Chosen: wants are records; suggestions are their own small table.** A want is a `records` row with `status = 'wanted'`, which is already how the app models it, so At the show, Bought it, sync and offline work as they do. Suggestions aren't records until added, so they live in a `suggestions` table with their reason and decision, and adding one creates a wanted record.
- **Rejected: suggestions as wanted records with a "suggested" flag.** They'd show up in At the show as wants before anyone accepted them, which breaks "seen first", and dismissing one would be a delete.
- **Rejected: suggestions only in memory, not stored.** Megan wouldn't see them, dismissals couldn't be remembered, and every visit would cost a new Claude call.

## 4. What you see

### 4.1 Want list screen (`/want`)
```
‹ Shelf                                     + Add
Want list
━━ Wanted (4)
   Bill Evans — Sunday at the Village Vanguard
   …
━━ Upgrades (2)
   John Coltrane — Ascension · want an original Impulse!
━━ Suggested for you (8)                 [Suggest more]
   Ahmad Jamal — The Awakening
   You rated At the Top 4 · Megan rated Poinciana 5
   [Add to want list]  [Not for me]
```
- **Wanted:** the shelf's `wanted` records, sorted by artist then title. A row opens the Record screen, which already shows the Want list tag and, at a show, Bought it.
- **Upgrades:** owned records with `wants_upgrade`, with their note. A row opens the Record screen.
- **Suggested for you:** pending suggestions, newest round first. Each shows the artist, the title, the reason (one line, up to 140 characters) and two `h-12` buttons.
- **Suggest more:**
  - It's disabled with no signal (`Needs signal`) and while running (`Finding records you’d like…`).
  - It needs at least **5 rated records** on the shelf. Otherwise it says `Rate a few more records first. Suggestions need at least 5 ratings.`
  - Errors use plain words, in the app's existing style.
- **Empty states:** `Nothing on your want list yet.` and `Tap Suggest more for records you might like.`
- **Removing a want:** Edit → Delete, as for any record (with Undo).

### 4.2 Adding a want by hand
**+ Add** opens a Find a record search that's set to the want list. It has the same box, cards and Discogs credit, under the heading **Add to your want list**.
- **Tapping a card** makes a `wanted` record. Its artist and title come from the card, and its section comes from the shelf's sections, as on Add.
- **This pressing only** is a switch above the cards, off by default. When on, the want also keeps the card's label, catalog number, year, format and Discogs release id.
- **Feedback:** an inline `✓ On your want list: {title} · Undo`, as Find already does for the shelf.
- **Records you already have:** a card for a record already **owned** shows `Already on the shelf`. One already **wanted** shows `Already on your want list`, and tapping it does nothing more than say so.
- **No photos and no fun facts for wants.** The fun fact comes when it's bought (§5).

### 4.3 Upgrades
Edit (owned records only) gets a **Want a better copy** switch and an **Upgrade note** text field (up to 200 characters, shown only when the switch is on). Both save through the usual edit patch (`wantsUpgrade`, `upgradeNote`).

### 4.4 Shelf screen
A **Want list** button joins At the show and Add, in the same style. The shelf itself still lists only owned records.

## 5. Rules
- **Buying a want** (Bought it → New arrivals) now also queues a fun fact for that record, as other saves do.
- **Adding a suggestion** creates the wanted record, album-level (artist, title, and section from the suggestion's Discogs genres), and marks the suggestion `added`, in one `perform`. **Undo** reverses both.
- **Not for me** marks the suggestion `dismissed`. It's kept so it's never suggested again. *Our call:* there's no Undo; a mistaken dismissal costs one suggestion.
- **Suggesting records already on the shelf:** a suggestion is never something already owned or wanted on the shelf, or ever suggested to it before (pending, added or dismissed). The server checks this after Claude answers, by normalised artist and title.

## 6. Server

### 6.1 Table `public.suggestions`
- **Columns:**
  - `id uuid pk`, `shelf_id uuid → shelves (cascade)`
  - `artist text`, `title text` (1–200 characters)
  - `reason text` (1–140)
  - `discogs_release_id int null`, `discogs_genres text[]`, `discogs_styles text[]`
  - `status` (`pending` / `added` / `dismissed`, default `pending`)
  - `decided_by uuid null`, `decided_at timestamptz null`
  - `round_at timestamptz` (when the round ran), `created_at`, `updated_at` (with the touch trigger)
- **RLS:** members can select, and can update `status`, `decided_by` and `decided_at` only. Inserts come only from the Edge Function, under the caller's own sign-in and an insert policy for members.
- **Grants:** revoke all from anon and authenticated, then grant select, insert and update of `(status, decided_by, decided_at)`.

### 6.2 Edge Function `suggest-records`
- **Request:** `POST {}`. The shelf is the caller's (one shelf per person today). It checks the caller is signed in, as the other functions do.
- **Gathering:** using the caller's sign-in (so RLS applies), it reads:
  - the shelf's members and their names;
  - every live record (artist, title, year, section name, status) with each member's rating;
  - every suggestion's artist and title, with its status.

  Fewer than 5 ratings → 400 `{ error: 'not-enough-ratings' }`.
- **Claude:**
  - `claude-sonnet-5-5`, effort `medium`, structured output `{ suggestions: [{ artist, title, reason }] }` asking for **12** (to allow for drops).
  - The prompt is told:
    - who rated what, from 1 to 5;
    - that 1–2 means disliked, so steer away from similar records;
    - that it must not suggest anything owned, wanted or already suggested;
    - only albums released on vinyl;
    - a reason of at most 140 characters that names the person or people and the records they rated highly.
  - Server-side refusal fallback: `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta header, as the Claude API docs recommend for Sonnet 5.5. A refusal that still happens gives `{ suggestions: [] }`.
  - Timeout 60 s, no retries.
- **Checking:**
  1. Drop anything whose normalised artist and title is already owned, wanted or suggested.
  2. For each remaining suggestion, in order, run a Discogs search (`q=artist title`, `format=Vinyl`, using the shared helper). Keep it only if a result's artist and title match after normalising. Store that result's release id, genres and styles.
  3. Stop at **8** kept.

  This stays within a 50 s overall budget, as `identify-record`'s deadline does.
- **Saving and answering:** it inserts the kept ones (with `round_at = now()`) and returns `{ added: n }`. The app picks them up on the next pull.
- **Logs:** name only status codes and error names.

## 7. App
- **Schema:** `Suggestion` (Zod) with row mapping; a Dexie bump adds a `suggestions` store (`'id, shelfId'`); it's pulled in full with records on every sync, like sections.
- **Backend:**
  - `suggestRecords(): Promise<{ added: number }>`, by plain `fetch` with a 70 s timeout and the existing error mapping, plus `{ error: 'not-enough-ratings' }` → the §4.1 message;
  - `patchSuggestion(id, fields)`, one row per request;
  - FakeBackend support.
- **Outbox:** a new kind, `suggestion.patch { status, decidedBy, decidedAt }`.
- **Actions (pure):**
  - `addWant(found, sections, ctx, { exactPressing })`;
  - `addSuggestion(suggestion, sections, ctx)`, which returns the record create plus the suggestion patch, with an undo that soft-deletes the record and sets the suggestion back to `pending`;
  - `dismissSuggestion(suggestion, ctx)`;
  - `setUpgrade(record, wantsUpgrade, note, ctx)`, which is `editRecord` with these fields.
- **Screens:** `WantListScreen` (§4.1); FindRecord in "want" mode (§4.2); the Edit switch (§4.3); the Shelf button (§4.4).
- **After Bought it on a want,** `wantFunFact` is called.

## 8. Not in this plan
- Price prep for the want list before a show (the original spec's "Get ready for the show").
- Suggestions on a schedule.
- Per-person want lists.
- Suggestions from Discogs or Spotify data.
- Sharing want lists between shelves.

## 9. Testing
- **Database (PGlite):** the suggestions table's checks, RLS (strangers can't see or decide; members can only change status), and the grants.
- **Function (pure modules):**
  - the request builder (both members' ratings, dislikes, exclusions);
  - the answer check (drop owned, wanted and suggested; Discogs match by normalised artist and title; stop at 8; lengths);
  - the refusal path.
- **App:**
  - `addWant` (album and pressing), `addSuggestion` with Undo, and dismiss;
  - the Want list screen's groups, empty states, the 5-ratings rule, `Needs signal` and the running state;
  - FindRecord's want mode, including "already wanted" and "already on the shelf";
  - the Edit upgrade switch;
  - Bought it on a want queues a fun fact.
- **Live, with Kahrman:** one Suggest more round on his shelf. Check the 8 are real vinyl releases, the reasons name the right people and records, and nothing owned is suggested. Read the cost from the Console.

## 10. Go-live
1. **(OK)** Apply the migration.
2. **(OK)** Deploy `suggest-records`. It reuses `ANTHROPIC_API_KEY` and `DISCOGS_TOKEN`. Then make one signed-in smoke call and read the logs.
3. **(OK)** Merge to `main`.

## 11. Left to the builder
- Exact layouts.
- Prompt wording within §6.2.
- Normalisation details (reuse `normalise` from `src/domain/search.ts`).
- Retry and backoff for the function call.
