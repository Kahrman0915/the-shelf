# Plan 5: Your shelf sections (design)

Date: 2026-11-23
Status: builder-checked; awaiting Kahrman's approval
Builds on: `docs/ideas.md` → "Your shelf sections (2026-11-12)"; the genre mapping in `2026-11-12-plan-4a-build-2a-discogs-lookup-design.md` §5; Plan 4c (recognition saves through the same Discogs mapping).

## 1. Intent

Kahrman's words: *"the categories I have are because on my shelf I have those little separators and that is what I have put on my separators… some users won't want a lot of separators so they combine some genres together. They should be able to match their physical shelf sections with their in app shelf sections."*

Friends now have their own shelves (2026-11-22), and they're sorted into Kahrman's nine personal dividers. Each shelf should instead have **its own sections**, matching the dividers on that person's real shelf. A record found on Discogs, whether by search or by photo, should land in the right one by itself.

**Success:**
- A friend renames, merges or deletes sections until the app matches their dividers, and from then on new records sort themselves into the right one.
- Kahrman's shelf looks and behaves exactly as it does today, with the same nine in the same order.

**Anti-goals:**
- Losing or orphaning a record when a section is merged or deleted.
- A record with no section.
- Kahrman's shelf changing in any visible way.
- Megan's or a friend's phone, still on the old app during the changeover, failing to sync or save.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Whose sections | **Per shelf**: everyone on a shared shelf sees and edits the same sections (Kahrman and Megan share one set) |
| 2 | A new shelf starts with | **A standard starter set** (Kahrman chose this): Jazz, Rock, Soul & Funk, Pop, Country & Folk, Reggae, Soundtracks, Christmas, Everything else |
| 3 | Kahrman's shelf | *Proposed, "keep going":* keeps his nine exactly: names, colours, order and Discogs rules |
| 4 | Where sections are edited | *Proposed:* a **Sections** screen in Settings: add, rename, colour, choose Discogs genres, reorder, merge, delete |
| 5 | Combining genres | *Proposed:* each section lists the **Discogs genres** that land in it; one Discogs genre belongs to at most one section |
| 6 | Delete / merge | *Proposed:* a section with records is never deleted with records in it. **Merge into…** moves its records, then removes it |
| 7 | Catch-all | *Proposed:* every shelf has one catch-all section (**Everything else** in the starter set, **Miscellaneous** on Kahrman's). It can be renamed and moved like any other, but not deleted. Anything no section claims lands there |
| 8 | Colours | *Proposed:* each section picks from about 12 swatches that read well in both themes. The spine bar and the poster use the section's colour |
| 9 | Label colours | *Proposed:* filtering to any section that takes Discogs' **Jazz** colours its spines by label (Impulse!, Blue Note, Argo), as Jazz does today |
| 10 | Christmas | *Proposed:* a section can take **holiday records**: anything Discogs tags with a Holiday or Christmas style goes there first, whatever its genre |

## 3. Approaches

- **Chosen: sections as their own table, each record pointing at one.** Sections are rows with a name, colour, order and Discogs genres, each belonging to one shelf. A record stores its section's id. Shelves can differ, rename freely, add and remove sections, and both phones on a shelf stay in step through the existing sync.
- **Rejected: keep the nine built-in genres and let each shelf rename or hide them.** Cheap, but nobody could add a tenth section or truly combine two, which is the point (Kahrman: "some users… combine some genres together").
- **Rejected: sections as a list stored inside the shelf row (JSON).** No database checks that a record's section exists, and merging becomes a whole-list rewrite that races between two phones.

## 4. What you see

### 4.1 Settings → Sections
```
Sections                              + Add
━━━━ Jazz / big band              ⋮
━━━━ Rock                         ⋮
━━━━ Pop / soul / contemporary    ⋮
…
━━━━ Everything else  (can't be deleted)
```
- **Tap a section** to open its sheet:
  - **Name:** 1–40 characters, unique on the shelf, ignoring case.
  - **Colour:** a swatch row.
  - **Discogs genres that go here:** a checkbox list of Discogs' 15 genres. One already claimed by another section shows that section's name and can be moved here.
  - **Holiday records go here:** a toggle. At most one section has it.
  - **Move up / Move down.**
  - Every control is 48 px.
- **⋮ menu:**
  - **Merge into…** picks the section to move to. It asks *"Move {n} records from {A} into {B}? {A} will be removed."* (**Merge** / **Keep it**).
  - **Delete** shows only for an empty section, with a confirm.
  - A section with records shows **Merge into…** in place of Delete.
  - **Everything else** has neither.
- **+ Add** makes a new section with a fresh name, the next free colour and no Discogs genres. It's placed at the end of the list, with its sheet opened.
- **Reorder:** *our call* is up / down buttons in the sheet (reliable on an iPhone and accessible). A drag handle is the builder's call, if it's cheap to make robust.
- Changes save through the outbox like any edit, so they work offline and appear on the other phone after sync.

### 4.2 Everywhere else
- **Shelf filter:** "All sections" and then the shelf's sections, in order, each with its swatch. The words "All genres" become **All sections**.
- **Section pickers on Add, Edit and Bought it new:** they list the shelf's sections in order. The field is labelled **Section**.
- **Spine bars, poster colours and Record screen labels** use the record's section.
- **Discogs (search tap and photo recognition):**
  1. If a style contains Holiday or Christmas, the record goes to the holiday section, when there is one.
  2. Otherwise, the first Discogs genre in the release's own order that a section claims decides.
  3. Otherwise it goes to Everything else.

  This is today's rule, now read from the shelf's own sections.

## 5. Sets of sections

**Kahrman's nine:** today's names, colours and rules, in today's order.

| Section | Colour | Discogs genres | Holiday |
|---|---|---|---|
| Jazz / big band | jazz | Jazz | |
| Rock | rock | Rock | |
| Pop / soul / contemporary | popsoul | Funk / Soul | |
| Popular pop | popularpop | Pop | |
| Miscellaneous | misc | (catch-all) | |
| Country | country | Folk, World, & Country | |
| Reggae | reggae | Reggae | |
| Soundtracks | soundtracks | Stage & Screen | |
| Christmas | christmas | | ✓ |

Miscellaneous is his catch-all, and it stays fifth. *Our call (builder check):* the catch-all can sit anywhere in the list, so his shelf doesn't change at all.

**The starter set:** the same colours, new names, in this order.

| Section | Colour | Discogs genres | Holiday |
|---|---|---|---|
| Jazz | jazz | Jazz | |
| Rock | rock | Rock | |
| Soul & Funk | popsoul | Funk / Soul | |
| Pop | popularpop | Pop | |
| Country & Folk | country | Folk, World, & Country | |
| Reggae | reggae | Reggae | |
| Soundtracks | soundtracks | Stage & Screen | |
| Christmas | christmas | | ✓ |
| Everything else | misc | (catch-all) | |

**Who gets which:**
- New shelves get the starter set, created inside `bootstrap()`.
- Existing shelves are handled by the migration: a shelf with any record carrying an `import_key` (Kahrman's, imported from his collection) gets his nine; every other existing shelf gets the starter set.
- Existing records move to the section matching their old genre. The nine genres map one-to-one onto both sets, so no record is left without a section.

## 6. Data

### 6.1 Database (one migration, applied before the app)
- **New table `public.sections`:**
  - `id uuid pk`
  - `shelf_id uuid → shelves`
  - `name text` (1–40, trimmed)
  - `color text`, one of the swatch keys
  - `position int`
  - `discogs_genres text[]`, each one of Discogs' 15 genres
  - `takes_holiday bool`
  - `is_catch_all bool`
  - `created_at`, `updated_at` (stamped by the server, as for records)

  Constraints:
  - exactly one catch-all per shelf (a unique partial index);
  - at most one holiday section per shelf;

  The rule that a Discogs genre is claimed only once per shelf is enforced in the app and in the merge function; on conflict, the first in position order wins.
- **Rules (RLS):** members of the shelf can see, add and change its sections. Delete works only for an empty, non-catch-all section; anything else is refused.
- **`records.section_id uuid not null`**, referencing `sections`, restricted on delete. It must belong to the same shelf, which a check trigger enforces.
- **Ids the phone can work out itself** (*our call, builder check*): the sections the migration and `bootstrap()` create get ids derived from the shelf and the old genre, `md5(shelf_id || ':' || legacy_genre)::uuid`. The phone computes the same id, so it can fill `sectionId` without the server (§6.2).
- **`merge_section(p_from uuid, p_into uuid)`:**
  - security invoker, so the RLS rules apply;
  - in one transaction, moves every record (including soft-deleted ones) from `p_from` to `p_into`, deletes `p_from`, and hands its Discogs genres and holiday flag to `p_into`;
  - both sections must be on the same shelf, and `p_from` mustn't be the catch-all;
  - it records `p_from → p_into` in **`section_redirects`** (shelf-scoped, readable by members).
- **Delete is a merge into the catch-all** (*our call, builder check*). Deleted records still count, because another phone can restore them. So "Delete" on a section with no live records runs `merge_section(section, catch_all)`, which also moves any deleted records quietly. If one is restored later, it appears in the catch-all.
- **Late changes from another phone** (*our call, builder check*). A trigger on `records` insert and update follows `section_redirects` when `section_id` points at a merged or deleted section, landing on the survivor. If the id is unknown, it uses the shelf's catch-all. A late write is therefore rerouted rather than refused, and no record is held up in the outbox.
- **Name clashes** (*our call, builder check*): names are unique per shelf only as a warning in the app, not a database rule. Two phones adding "Blues" offline then both succeed, and the person can merge them.
- **`bootstrap()`** creates the starter set when it creates a shelf.
- **The changeover:**
  - `records.genre` stays for now, kept filled so older app versions keep working: each section carries a hidden `legacy_genre` (one of the nine; new sections get `misc`), and a trigger keeps `records.genre` equal to the section's `legacy_genre`.
  - If an old app inserts a record without `section_id`, or changes only `genre`, a trigger moves the record to the first section (by position) whose `legacy_genre` matches. If none matches (that section was merged away), it follows the redirect from the section's derived id to the survivor, and failing that goes to the catch-all. *Our call (builder check):* an old-app genre edit moves the record; it's never quietly undone.
  - The column and triggers are removed in a later plan, once every phone has updated.

### 6.2 App
- **Schema:**
  - `Section` gets its own Zod schema and row mapping.
  - `ShelfRecord.genre` is replaced by `sectionId`. `genre` stays readable during the changeover but is never written by the new app.
  - Dexie version bump: a `sections` table. *Our call (builder check):* the app works offline the first time it opens after updating.
    - The upgrade fills `sectionId` on stored records, queued creates and queued patches that carry `genre`, using the derived ids (§6.1). It drops `genre` from queued patches.
    - It seeds the phone's `sections` table for its shelf with the matching set: Kahrman's nine if any stored record has an `importKey`, else the starter set.
    - It also forgets the last pull time, so the first sync after the update fetches everything, sections included, and corrects anything seeded.
- **Sync:** sections are pulled with records (every pull, since they're few). A record is applied only after its section exists on the phone.
- **Outbox postcard kinds:**
  - `section.create`, `section.patch` (the fields changed) and `section.delete` (empty only);
  - `section.merge { into }`, sent through the RPC.

  Each is applied to the notebook at once, like records: a merge moves the phone's records and removes the section locally.
- **Discogs mapping:** `sectionFor(genres, styles, sections)` replaces the fixed table in `src/domain/discogsGenre.ts`.
- **Colours:**
  - `--section-{key}` CSS variables for the swatch keys, in both themes. The nine existing genre colours become nine of the keys, and three more are added (teal, slate, sand).
  - The poster's accent rule, which avoids the accent matching the genre colour, compares colour keys.

## 7. Not in this plan
- Sections shared between shelves.
- Sub-sections.
- Sorting rules inside a section.
- Mapping Discogs *styles* other than holiday.
- Dropping `records.genre` (a later clean-up).
- Changing how the shelf is sorted.

## 8. Testing
- **Database (PGlite):**
  - each set is created correctly (Kahrman's shelf detected by `import_key`);
  - every existing record gets its section;
  - the one-catch-all and one-holiday rules;
  - derived ids match the phone's calculation;
  - late writes are rerouted through `section_redirects` or to the catch-all;
  - an old-app genre change moves the record;
  - delete moves deleted records to the catch-all;
  - RLS (strangers can't see or change sections; members can);
  - merge moves everything atomically;
  - old-app inserts without `section_id` are filled;
  - `genre` is kept in step.
- **Pure:** `sectionFor` on each set, including holiday-first, release genre order, an unclaimed genre going to the catch-all, and two sections claiming one genre (first by position wins).
- **Screens:**
  - the Sections screen: add, rename, colour, genres, reorder, merge, delete-only-when-empty, and the catch-all can't be deleted;
  - the filter, pickers and spines use sections;
  - Find and recognition saves land in the mapped section.
- **The Dexie upgrade:** offline, a notebook from the old version opens with every record in the right section, and its unsent changes still send.
- **Live:**
  - Kahrman's shelf looks unchanged;
  - a friend renames and merges sections, and a Discogs add lands right;
  - Megan's phone on the old version still syncs during the changeover.

## 9. Go-live
1. **(OK)** Check production: count records per genre, check `import_key` on Kahrman's shelf only, and check every shelf's members.
2. **(OK)** Apply the migration. Then check that every record has a `section_id` and every shelf has exactly one catch-all.
3. **(OK)** Push a test link. Kahrman checks his shelf, and a friend tries the Sections screen.
4. **(OK)** Merge to `main`.

## 10. Left to the builder
- The Sections screen's exact layout.
- Drag versus buttons for reordering, beyond the up/down floor.
- The three extra swatch colours' exact values (they must pass contrast in both themes).
- Copy for errors in plain words.
- How the section picker shows swatches.
