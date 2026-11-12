# Plan 4a: Add, edit and delete records, with Claude lookup (design spec)

Date: 2026-11-12
Status: approved in conversation, awaiting written review
Builds on: `2026-09-18-the-shelf-design.md` (original spec), `2026-11-11-plan-3-bought-and-played-design.md` (outbox, actions, Record screen), `../notes/plan-2-handoff.md` (Plan 3 → Plan 4 handoff)
Live app: https://the-shelf-sigma.vercel.app (Supabase `rlhhrzkaosngafcoxaas`, Pro)

Plan 4 was split into parts. This spec is **part 1 (4a)**: adding, editing and deleting records, plus a Claude-powered lookup that drafts a record for you. Later parts: the want list and upgrades, then cover photos.

This spec is built in **two builds**, each with its own implementation plan:

- **Build 1:** add, edit and delete by hand. It doesn't use Claude and costs nothing to run.
- **Build 2:** "Tell Claude the record" on Add, and "Ask Claude" on Edit. It uses Discogs for the facts and Claude Haiku 5.5 for the search and the fun fact.

---

## 1. What it's for

- **Catching up first.** Enter the rest of the collection that's already on the shelves, many records in one sitting.
- **Then occasional one-offs:** gifts, finds, mistakes to fix.
- **Plan 3's Bought it stays the at-the-show path.** This part is for home.

**Success looks like this:**
- A record goes from shelf to app in under a minute by hand, and in a few seconds with Claude.
- Edits show up on the other phone, and two people editing different fields never lose each other's changes.
- A deleted record can be brought back within 8 seconds.

## 2. Decisions made in this brainstorm

| # | Decision | Choice |
|---|---|---|
| 1 | Add's main job | **Catch-up first, then one-offs** → a fast *Save and add another* loop |
| 2 | Rating on Add | **Yes, optional**, the same five records as the Record screen |
| 3 | Form length | **Short form + More details**; Edit opens with More details expanded |
| 4 | Delete | **Confirm, then the 8-second Undo bar** |
| 5 | Duplicates | **Warn, allow anyway.** A second copy is simply another record (this settles Plan 4's "second copy" question) |
| 6 | Approach | **One shared form on its own full screen**, for Add (`/add`) and Edit (`/record/:id/edit`) |
| 7 | Claude's place | **One spec, two builds**: manual first, Claude straight after |
| 8 | Several pressings | **Pick from up to 3** pressing cards |
| 9 | Existing records | **Ask Claude on Edit** suggests only the missing fields; it never overwrites |
| 10 | Facts source | **Discogs** for the facts and the cover; **Claude Haiku 5.5** turns what you said into a search and writes the fun fact |
| 11 | Cover image | **Discogs cover until you take your own photo**, credited "Image: Discogs". This lifts the original spec's "no fetching album art" rule |
| 12 | Accuracy gate | A **10-record accuracy check** against your real shelf before build 2 is switched on |

## 3. Scope

### Build 1: by hand
- **Add** (`/add`), opened by an **Add** button in the shelf header beside *At the show*.
  - It creates an **owned** record that goes straight onto the shelf, never into New arrivals.
  - It has two buttons: **Save** (back to the shelf) and **Save and add another**, which keeps **genre and label**, clears everything else and puts the cursor back in Artist.
- **Edit** (`/record/:id/edit`), opened by an **Edit** button on the Record screen. It's the same form, filled in, with More details expanded. **Save** returns to the Record screen.
- **Delete:** quiet danger text, **Delete record**, at the very bottom of Edit.
  - It confirms first: "Delete *{title}*? It goes from both your shelves." The buttons are **Delete** (danger) and **Keep it**.
  - Then it returns to the shelf with the Undo bar "Deleted *{title}*" and **Undo**.
- **Rating on Add**: optional. Edit doesn't show it, because the Record screen already does.
- **Duplicate warning**, as described in §5.3.
- **Fun fact:** a new field, shown on the Record screen with its source link. You can also type one yourself.
- **Carry-overs:**
  - Roving tabindex in `GradePicker`: arrow keys move within a picker, and Tab goes to the next field. This matters now that two pickers share a form.
  - The **unsaved-changes "busy" mark**, so the auto-reload never discards a half-filled form.

### Build 2: with Claude
- **Add:** a **Tell Claude the record** box at the top (typed, or dictated with the iPhone keyboard mic). It shows up to 3 pressings to pick from, and filling the form is always a draft.
- **Edit:** an **Ask Claude to fill what's missing** button. It suggests only empty fields, and you accept or skip each one.
- **Cover from Discogs** until you add your own photo.
- The Discogs notice in Settings.

### Not in this part
- The want list and upgrades.
- Changing a record's status.
- Your own cover photos.
- Dictating a stack of records at once.
- Clearing a rating.
- Discogs prices.

## 4. Data

### 4.1 Database (one migration, applied before build 1 ships)

New columns on `public.records`:

| column | type | rule |
|---|---|---|
| `fun_fact` | text | null; trimmed, at most 500 characters |
| `fun_fact_source` | text | null; must start with `https://`; only allowed when `fun_fact` is set |
| `cover_image_url` | text | null; must start with `https://` |

- **Grants:** `grant update (fun_fact, fun_fact_source, cover_image_url)` to authenticated. The existing column grants stay as they are.
- **App rules:** `RecordSchema`, `rowMapping` and `EDITABLE_FIELDS` gain the same three fields with the same rules.
- `cover_image_url` arrives in build 1's migration so there's only one migration, but **only build 2 writes it**.
- **New table, in build 2's own migration** (applied before build 2's function is deployed): `public.ai_lookups`.
  - Columns: `id` uuid pk, `user_id` → profiles, `created_at` timestamptz default now(), `ok` boolean.
  - RLS is enabled with **no policies** for anon or authenticated. Only the Edge Function, using the service role, reads and writes it.

### 4.2 Actions (pure functions, as in Plan 3 §5)

| Action | Postcards | Undo |
|---|---|---|
| `addRecord(input, ctx)` | `record.create` (status `owned`, `addedBy` = you, a new uuid made on the phone), plus `rating.set` if you rated it. Both go in **one** `perform`, so it's all-or-nothing | none |
| `editRecord(opened, edited, ctx)` | `record.patch` with **only** the fields where `edited` differs from `opened`, the values the form started with. No differences means no postcard | none |
| `deleteRecord(record, ctx)` | `record.patch { deletedAt: now }` | `record.patch { deletedAt: null }` |
| `restoreWithEdits(opened, edited, ctx)` | `record.patch { deletedAt: null, …changed fields }` | none |

- **Every result is checked against `RecordSchema`** before saving, which already includes the Near Mint estimate's "both or neither, low ≤ high" rule.
- **Delete is allowed for any status.**
- **Ratings stay in the database when a record is deleted.** They're hidden with it, and Undo brings them back.

### 4.3 Concurrency
- **Edits are worked out against the values the form opened with.** A field you didn't touch is never sent, so another person's change to it survives.
- **If two people change the same field,** the last one to reach the server wins. This is unchanged from the original spec.
- **If the record is deleted elsewhere while Edit is open,** Edit shows "That record was deleted on another phone." with **Restore with your changes** (`restoreWithEdits`) and **Leave it deleted**. That needs a hook that can read a deleted record by id. The existing `useRecord` hides deleted records on purpose.

## 5. The form

### 5.1 Fields, in order
- **Short form:**
  - Artist (required)
  - Title (required)
  - Genre (required; nine options, no preselected value on Add)
  - Disc grade (`GradePicker part="Disc"`, no default on Add: ungraded until you tap one)
  - Your rating (Add only, optional)
- **More details:**
  - Label, Catalog, Year, Pressing (`format`)
  - Sleeve grade
  - Notes
  - Fun fact, with "Source: {host}" as a link when there is one
  - Near Mint estimate, low and high
  - Value note
  - **Price paid, last**
- **Defaults:** collapsed on Add, expanded on Edit.

### 5.2 Validation (Zod, messages shown under the field)

| Rule | Message |
|---|---|
| Artist empty | `Add the artist` |
| Title empty | `Add the title` |
| No genre | `Choose a genre` |
| Year outside 1900–2100 | `Year must be between 1900 and 2100` |
| Only one of low/high | `Fill both, or neither` |
| low > high | `Low can't be more than high` |
| Fun-fact source not https | `Use a full web address (https://…)` |

Money fields use Plan 3's `sanitizeAsking` and `parsePrice`.

### 5.3 Duplicate warning
- As soon as both artist and title are non-empty, the form checks the notebook for a non-deleted record on this shelf with the same normalised artist and title (Plan 3's `normalise`).
- If it finds one, a line appears under Title: **"Already on the shelf: {title} ({disc grade or 'no grade'})"** with **Open it**.
- It's a warning only, and saving is never blocked.
- It doesn't appear on Edit for the record itself.

### 5.4 Leaving and reloading
- **Leaving a form with unsaved changes** asks "Discard your changes?" with **Keep editing** (primary) and **Discard** (danger). That applies to the Back button, the device's back gesture, and in-app navigation.
  - This needs route blocking. React Router's `useBlocker` needs a data router, so the implementation plan decides whether to move from `BrowserRouter` to `createBrowserRouter`.
- **The busy mark:** while a form has unsaved changes, it marks the page busy (for example a `data-unsaved` attribute on its root). `reloadWhenSafe` also waits for that mark, the same way it waits for open dialogs.

### 5.5 Copy

| Where | Text |
|---|---|
| Shelf header button | `Add` |
| Add screen title | `Add a record` |
| Edit screen title | `Edit` |
| Save buttons | `Save`, `Save and add another` |
| Expander | `More details` |
| Delete | `Delete record`; confirm `Delete {title}? It goes from both your shelves.` with `Delete` / `Keep it`; Undo bar `Deleted {title}` |
| Deleted elsewhere | `That record was deleted on another phone.` with `Restore with your changes` / `Leave it deleted` |
| Unsaved | `Discard your changes?` with `Keep editing` / `Discard` |

## 6. Claude lookup (build 2)

### 6.1 Flow on Add
1. You type or dictate into **Tell Claude the record** and tap **Look up**. The form stays usable while it works, and the box shows "Looking it up…" with **Cancel**.
2. The app calls the Edge Function `lookup-record` with `{ mode: 'add', query }` and the person's sign-in.
3. The function:
   1. **Haiku 5.5** turns the words into a Discogs search: artist, title and catalog number when given.
   2. **Discogs** `database/search?type=release`, then release details for the best matches, up to 3.
   3. **Haiku** maps each release's Discogs genre and style to one of the nine genres.
   4. **Haiku with web search** writes **one fun fact** about the album and returns its source page.
4. The app shows up to **3 pressing cards**: the year · label · catalog line, what's different (from Discogs' format descriptions, for example "Mono, Gatefold"), and the cover thumbnail. Below them is **None of these · fill what they share**.
5. Picking a card fills: artist, title, label, catalog, year, pressing, genre, `discogs_release_id`, `cover_image_url`, fun fact and source.
   - Each filled field shows a small **Claude** tag, which goes once you change that field.
   - Disc and sleeve grades, rating, notes and prices are never filled.
6. You check it and tap **Save**. Nothing is ever saved by Claude.

### 6.2 Flow on Edit
- **Ask Claude to fill what's missing** sends `{ mode: 'fill', record }`, where `record` is the current field values.
- The function looks the record up the same way and returns suggestions **only for empty fields**: label, catalog, year, pressing, genre, `discogs_release_id`, cover, fun fact.
- Each suggestion appears beside its field with **Accept** / **Skip**. Filled fields are never changed.
- When it can't tell which pressing you have, it shows the same pressing cards first.

### 6.3 The Edge Function `lookup-record`
- **Runtime:** a Deno Supabase Edge Function, calling Claude through the official Anthropic TypeScript SDK (`npm:@anthropic-ai/sdk`).
- **Auth:** it requires a signed-in user (Supabase JWT verification on), and 401s otherwise.
- **Secrets** (Supabase function secrets, never in the app or git):
  - `ANTHROPIC_API_KEY`
  - `DISCOGS_TOKEN`
  - the service-role key for `ai_lookups`
- **Model:** `claude-haiku-5-5`, with structured outputs (`output_config.format` with a JSON schema) for every model answer.
  - Use the web search tool version Haiku 5.5 supports; confirm against the live docs at build time.
  - Haiku 5.5 has **no server-side refusal fallback**. If it declines, the function returns the Discogs facts without a fun fact.
- **Discogs:** send a descriptive `User-Agent`, authenticate with the token, and stay within 60 requests a minute. A 429 from Discogs becomes the "too many lookups" message.
- **Checks on every answer before returning it.** Anything that fails is dropped, never guessed:
  - the genre must be one of the nine keys;
  - the year must be an integer from 1900 to 2100;
  - links must be `https://`;
  - a fun fact without a source link is dropped;
  - a pressing must carry a Discogs release id.
  - If nothing survives: `{ found: false }`.
- **Limits:**
  - **100 lookups per person per day**, counted in `ai_lookups` (one row per call, `ok` true or false).
  - The **monthly spending cap is set on the Anthropic Console** account and is the hard stop.
- **Timeout:** the app calls this function with its **own 60-second limit**, not the app-wide 15 seconds (Plan 3's `fetchWithTimeout`). Expected time is about 3–10 seconds.
- **Safety:** web and Discogs text is treated as data. The model can only return the fixed JSON shape, and its output only ever fills a draft you review. The only thing sent to Anthropic is the words you typed, plus field values in `fill` mode.

### 6.4 Cover images
- A record shows, in this order: **your own photo** (a later part) → **`cover_image_url`** (Discogs) → the **generative poster**.
- The Discogs image carries **"Image: Discogs"** on the Record screen.
- **Offline:** it shows when the browser has cached it, and otherwise falls back to the poster.
- **Before build 2's plan:** check Discogs' current API terms for displaying release images and the credit they require, and adjust this section if needed.

### 6.5 Discogs notice
Settings shows: *"This application uses Discogs' API but is not affiliated with, sponsored or endorsed by Discogs. 'Discogs' is a trademark of Zink Media, LLC."* (wording from the original spec §14).

### 6.6 Messages

| Situation | Message |
|---|---|
| No signal | `Needs signal` (the box is disabled) |
| Over 60 s | `Claude took too long. Try again, or fill it in yourself.` |
| Daily limit | `That's today's 100 lookups. More tomorrow.` |
| Nothing found or declined | `Claude couldn't find this record. Fill it in yourself.` |
| Discogs down | `Discogs isn't responding. Try again, or fill it in yourself.` |
| Discogs 429 | `Too many lookups at once. Wait a minute and try again.` |
| Function or service down | `Claude isn't available right now. Fill it in yourself.` |

## 7. Testing

**Rules (Vitest):**
- `addRecord` with and without a rating, all-or-nothing.
- `editRecord` sends only changed fields, and nothing when nothing changed.
- Two people changing different fields both survive, through the courier and FakeBackend.
- `deleteRecord` and its Undo, including after it has already been sent.
- `restoreWithEdits`.
- The form schema's messages.
- The duplicate check uses normalised matching and ignores deleted records.

**Database (PGlite):**
- The three new columns can be updated by a member.
- The `https://` checks refuse anything else.
- `fun_fact_source` without `fun_fact` is refused.
- A stranger can't update them.
- `ai_lookups` is invisible to authenticated users.

**Screens (Testing Library + FakeBackend):**
- More details toggles.
- *Save and add another* keeps genre and label, and clears the rest.
- The duplicate warning, with Open it.
- The discard-changes guard.
- Delete confirms, then Undo.
- Deleted elsewhere → Restore with your changes.
- `reloadWhenSafe` waits on the unsaved mark.
- `GradePicker` arrow keys and Tab order.

**Edge Function (build 2):**
- Tested with **saved example responses** from Discogs and Claude, so no live calls and no spend:
  - a good answer;
  - a missing fun-fact source (dropped);
  - a wrong genre (dropped);
  - more than 3 pressings (trimmed);
  - nothing found;
  - a decline;
  - a Discogs 429;
  - the daily limit;
  - an unauthenticated call.
- `fill` mode never returns a field that was already filled.

**Live, with Kahrman's OK:**
- **The 10-record accuracy check:** ten of his records through `lookup-record`, compared field by field with what's on his shelf, before build 2 is switched on.
- **On both phones:**
  - add by hand → see it on the other phone;
  - edit on one phone while the other edits a different field → both changes kept;
  - delete → Undo;
  - the same with Claude.

## 8. Before each build ships

**Build 1:**
1. Apply the migration to production (with `--remote`) before the app ships.
2. Merge to `main`, which deploys.
3. Do the phone checks.

**Build 2:**
1. Kahrman creates:
   - an Anthropic Console account with credit and a **monthly spending limit**;
   - an API key;
   - a free Discogs account and personal token.
2. Set the secrets in Supabase.
3. Deploy the function.
4. Run the 10-record check.
5. Merge to `main`.

Phones that are already open pick up each deploy on the next reopen (Plan 3's auto-reload).
