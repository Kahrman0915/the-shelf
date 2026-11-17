# Plan 4a, Build 2a: Find a record on Discogs (design spec)

Date: 2026-11-12
Status: approved in conversation, awaiting written review
Builds on: `2026-11-12-plan-4a-add-edit-delete-design.md` (build 1 is live). This spec **replaces that spec's §6 (Claude lookup)** for now. Claude's fun fact and dictation clean-up move to a later **build 2b**.

## 1. Why this exists

Kahrman tried adding *McCoy Tyner, Forces of Nature* by hand and stopped partway: *"I DO NOT want to have to fill this all in myself for every record."* Entering records by hand is too slow for catching up a whole collection.

**Goal:** say or type what the record is, tap the pressing in your hands, and it's on the shelf. Then straight on to the next one.

**Success looks like this:**
- adding a record takes **one search plus one tap**;
- there's no year, catalog or label to look up;
- a catch-up session is search, tap, search, tap.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Source of facts | **Discogs**, with no Claude in this build |
| 2 | Covers | **Shown only while picking.** Not stored, because Discogs' terms forbid keeping images or showing them more than 6 hours out of date. The shelf keeps the generative poster until your own photos (a later part of Plan 4). This replaces build 1 spec decision #11 |
| 3 | Genre | **Set automatically** from Discogs' tags, using the mapping in §5; you can change it in Edit |
| 4 | Pop vs soul | Discogs **Funk / Soul → Pop / soul / contemporary**; Discogs **Pop → Popular pop** |
| 5 | After the tap | **Saved straight to the shelf** as owned, with no grade and no rating. A bar shows **On the shelf: {title}** with **Undo**, then the box clears for the next record |
| 6 | Several genres | The **first** Discogs genre that maps decides (the Christmas override comes first) |
| 7 | Hand entry | Stays, **folded away** under the results as *Not here? Fill it in by hand* |
| 8 | Future sections | The mapping is a **small table** in code, so "Your shelf sections" (`docs/ideas.md`) can later make it per-shelf data |

## 3. Discogs' rules (API Terms of Use, last updated 2025-05-27, read 2026-11-12)

- **Facts are CC0** (no rights reserved): release titles, dates, format, identifiers, artist and label names. They may be stored on records permanently.
- **Images are restricted data:** they may be displayed, but not stored longer than needed, and not shown when more than 6 hours out of date. → Thumbnails appear only in the live search results and are never saved.
- **Credit next to the data:** "Data provided by Discogs." must appear next to any Discogs data, linked to the discogs.com page holding that data, with no `nofollow`.
- **App notice:** *"This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC."*
- **Personal, non-commercial use** fits the terms.
- **Rate limit:** 60 authenticated requests a minute per token. Don't create extra tokens to get around it.

## 4. The Add screen

**Layout, top to bottom:**
1. The title `Add a record` and `‹ Shelf`, as in build 1.
2. **Find a record**: a search box (`type="search"`, `enterkeyhint="search"`) with the placeholder `Artist and title, like mccoy tyner forces of nature`, plus a **Search** button. Typing or the keyboard mic both work.
3. **Results:** up to **6** cards.
   - Each card shows the thumbnail (if Discogs has one), the artist and title in bold, and `{year} · {label} · {catalog}` with `{format} · {country}` below it. Missing parts are left out.
   - A card matching a record already on the shelf (build 1's `findDuplicate`) carries the tag **Already on the shelf**. It's still tappable, so a second copy is just another record.
   - Under the list: **Data provided by Discogs**, linked to `https://www.discogs.com/search/?q={query}&type=release`.
4. **Not here? Fill it in by hand:** a disclosure that opens build 1's `RecordForm` (mode `add`), collapsed by default.

**Tap a card:**
- It saves straight away as an **owned** record (via `addFound`, §6).
- It shows the Undo bar **On the shelf: {title}** for 8 s.
- The box and results clear and focus returns to the box.
- A tap is ignored while a save is already running, so a double tap saves once.

**States:**

| State | What shows |
|---|---|
| Searching | `Searching Discogs…` on the button, which is disabled, with the cards greyed |
| No signal | the box is disabled, with `Needs signal`; the hand form still works |
| No results | `Discogs didn’t find that. Try fewer words, or fill it in by hand.` |
| Discogs rate limit | `Too many searches at once. Wait a minute and try again.` |
| Discogs down, or over 20 s | `Discogs isn’t responding. Try again, or fill it in by hand.` |

Search results live only in screen state. They're never written to the notebook or kept after you leave the screen. Results more than an hour old are cleared when the app comes back to the front, well inside Discogs' 6-hour freshness rule.

## 5. Genre mapping (a table in `src/domain/discogsGenre.ts`)

Checked in this order, and the first match wins:
1. Any **style** containing `Holiday` or `Christmas`, case-insensitive → `christmas`.
2. Otherwise, the first Discogs **genre** in the release's own order that appears in this table:

| Discogs genre | Section |
|---|---|
| Jazz | `jazz` |
| Rock | `rock` |
| Funk / Soul | `popsoul` |
| Pop | `popularpop` |
| Folk, World, & Country | `country` |
| Reggae | `reggae` |
| Stage & Screen | `soundtracks` |

3. Nothing matched → `misc`.

## 6. Data

- **No database change.** `discogs_release_id` has existed since Plan 2.
- **New pure action `addFound(found, ctx)`:**
  - It builds the fields from the search result and calls build 1's `addRecord` with `rating: null`.
  - Its **undo** is `record.patch { deletedAt: now }` for the new record.
- **Fields saved:**

| Field | Source |
|---|---|
| `artist` | the part of Discogs' `title` before the first ` - `, with a trailing ` (n)` and trailing `*` removed |
| `title` | the part after the first ` - ` |
| `label` | the first label |
| `catalog` | `catno`, unless it is `none` |
| `year` | an integer, if 1900–2100 |
| `format` | the formats joined with `, ` |
| `genre` | §5 |
| `discogsReleaseId` | the release id |

  Everything else is null.

## 7. Server: Edge Function `discogs-search`

- **Location:** `supabase/functions/discogs-search/index.ts` (Deno). The result-shaping logic lives in `supabase/functions/discogs-search/shape.ts`, plain TypeScript with no Deno APIs, so Vitest can test it.
- **Requires a signed-in user** (JWT verification on), and returns 401 otherwise.
- **Request:** `POST { query }`. The query is trimmed and must be 2–200 characters, else 400.
- **Calls** `GET https://api.discogs.com/database/search?q={query}&type=release&format=Vinyl&per_page=6`.
  - Headers: `Authorization: Discogs token={DISCOGS_TOKEN}` and `User-Agent: TheShelf/1.0 +https://the-shelf-sigma.vercel.app`.
  - `DISCOGS_TOKEN` is a Supabase function secret.
- **Response:** `{ results: FoundRecord[] }`, where a `FoundRecord` is `{ releaseId, artist, title, label, catalog, year, format, country, genres, styles, thumb }`. Genre mapping happens in the app (§5).
- **Errors:** Discogs 429 → 429 `{ error: 'rate-limited' }`; any other failure → 502 `{ error: 'discogs-down' }`. It never returns partial or invented results.
- **App side:**
  - `Backend.searchDiscogs(query): Promise<FoundRecord[]>` calls the function with plain `fetch` through `fetchWithTimeout(20_000)`, sending the signed-in user's access token and the publishable key. It doesn't use `supabase.functions.invoke`, because that would inherit the client's app-wide **15 s** limit; this call gets its own **20 s**.
  - A query that's under 2 or over 200 characters after trimming returns `[]` without calling the function.
  - It throws `BackendError` with the §4 messages, or `NO_SIGNAL`: a timeout past 20 s is `Discogs isn’t responding…` (§4), and only an offline phone or a failed connection is `NO_SIGNAL`. A 401 from the function is `Sign in again to search.`
  - The function gives its own Discogs request **15 s**, so it answers 502 before the app gives up. Its logs name only the Discogs status or the error's name, never the URL, the headers or the token.
  - `FakeBackend` gets canned results and switches for rate-limited and down.

## 8. Credits

- **Record screen:** when `discogsReleaseId` is set, show **Data provided by Discogs** under the facts, linked to `https://www.discogs.com/release/{id}` (`target="_blank" rel="noopener"`, no `nofollow`).
- **Settings:** the §3 notice, in full, at the bottom.

## 9. Testing

- **`discogsGenre` mapping:**
  - every table row;
  - the Christmas override;
  - first-match order (`['Jazz', 'Funk / Soul']` → `jazz`);
  - unknown → `misc`.
- **`shape.ts`:**
  - artist/title split, including a title that itself contains ` - `;
  - `(2)` and `*` removed;
  - `catno: 'none'` → null;
  - year bounds;
  - a format join;
  - more than 6 results trimmed;
  - tested on saved example Discogs replies.
- **`addFound`:** an owned record with the mapped fields and no grade or rating; its undo soft-deletes.
- **Add screen:**
  - search shows the cards;
  - tapping saves and shows Undo, and the box clears;
  - a double tap saves once;
  - Undo removes it;
  - the Already-on-the-shelf tag;
  - every §4 message;
  - the hand form opens;
  - offline shows Needs signal.
- **Record screen:** the Discogs link appears only for records with a release id.
- **Live, with Kahrman:** ten records from his shelf, checking the right pressing appears and the saved facts are right.

## 10. Go-live

1. **Kahrman, once:**
   1. Create a free Discogs account and generate a **personal access token** (Settings → Developers).
   2. In his own terminal, in the project folder, run `npx supabase secrets set DISCOGS_TOKEN=…`. The token is never pasted into chat or committed.
2. Deploy the function: `npx supabase functions deploy discogs-search`.
3. Merge to `main`, which deploys. There's no database migration in this build.
4. Do the ten-record check on the phone.

## 11. Later

- **Build 2b:** Claude Haiku 5.5 for the fun fact and for tidying messy dictation. Needs an Anthropic Console account.
- **Your shelf sections** (`docs/ideas.md`): per-shelf sections, with this mapping table becoming each shelf's own setting.
