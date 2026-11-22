# Plan 4c: Claude reads the sleeve, and writes the fun fact (design)

Date: 2026-11-22
Status: draft, written while Kahrman was out; awaiting builder check and his approval
Builds on:
- `2026-11-22-plan-4b-photo-add-design.md`: photos are live, and §4 there outlined recognition.
- `2026-11-12-plan-4a-build-2a-discogs-lookup-design.md`: Find a record, `discogs-search`, and the Discogs terms.
- `2026-11-12-plan-4a-add-edit-delete-design.md` §6: the original Claude lookup and fun-fact rules. This spec replaces that §6.

## 1. Intent

Kahrman's words:
- At the start of the photo idea: *"Take a picture of the record we have and then the app finds it and adds it and saves the image all at the same time."*
- On typing everything in by hand: *"I DO NOT want to have to fill this all in myself for every record… if that is the experience this app will fail."*
- From Plan 4a: *"I should be able to say claude add this record to my shelf and it goes and looks up all the details including a fun fact about the record."*

He tested build 4b-1 today and the crops came out clean and squared. But it "didn't search for anything to add it", because recognition wasn't built yet. This plan closes that gap and adds the fun fact.

**Success:**
- **Catch-up loop:** pick up a sleeve, photograph the front and back, and, with no typing, the record is on the shelf with the right pressing, both photos and a fun fact. Then straight on to the next sleeve.
- **Fun facts everywhere:** a fun fact appears on its own a moment after any record is saved, however it was added. Each fact has its source link.
- **Older records:** records already on the shelf can get a fun fact with one tap.

**Anti-goals:**
- An invented fun fact, or one with no real source.
- The wrong pressing saved without the person noticing.
- A surprise bill.
- Waiting on a spinner with no way past it.
- Typing becoming the normal path again.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | How a record is recognised | **Approach A (Plan 4b):** Claude reads both photos (front → artist and title; back → barcode, catalog number and label), then Discogs searches by barcode, then catalog number, then name |
| 2 | One exact match | Saved straight away, with photos, and the inline **On the shelf: … · Undo** (4b decision 5) |
| 3 | Several matches | The pressing cards, to tap (4b decision 5) |
| 4 | No match | The Find box fills with what Claude read (4b decision 6) |
| 5 | Already on the shelf | The existing **Add these photos to the one on your shelf?** question (4b decision 11) |
| 6 | When the fun fact appears | **Automatically, a moment after any record is saved.** Existing records get a **Find a fun fact** button. Kahrman chose this today |
| 7 | Fun fact accuracy | **Claude Haiku 5.5 with web search.** The fact must come with a source page that the search really returned; otherwise there's no fact (Plan 4a §6.3) |
| 8 | Model | **Claude Haiku 5.5** (`claude-haiku-5-5`) for both jobs (Plan 4a: "honestly a job for Haiku") |
| 9 | Spending | An **Anthropic Console** account with a **monthly spending cap** that Kahrman sets, which is the hard stop. Expected: well under 2¢ a record (§7) |
| 10 | When the sleeve is read | *Our call:* **automatically**, as soon as the photos are done (back taken or skipped) and the phone has signal. There's no extra tap |

## 3. What you see

### 3.1 Add screen, after the photos
```
[front]  [back]
Looking it up…                       ← replaces "Now find it below…"
```
Then one of four things happens:
- **Exact match:** saved, as when you tap a card: `✓ On the shelf: A Charlie Brown Christmas · Undo`. The photos clear for the next sleeve. Undo brings them back, as now.
- **Already on the shelf:** the existing question, **Add these photos to the one on your shelf?**
- **Several pressings:** `Which pressing is yours?` above the usual cards, tagged **Already on the shelf** where that applies, with the Discogs credit. Tap one and it saves with the photos.
- **No match:** `Couldn’t pin it down. Check the search below.` The Find box is filled with what Claude read (for example `vince guaraldi trio a charlie brown christmas`) and its search runs straight away.

Other states:
- **No signal:** the line reads `Needs signal to look it up. Your photos are kept.`, with a **Look it up** button that works once signal is back. Photos and drafts are kept, as now.
- **Error or timeout** (no answer after 30 s): `Couldn’t read the sleeve. Try again, or search below.`, with **Try again**.
- **While it's reading:** you can still type in the Find box. A search you start yourself takes over, and the reading's answer is then ignored (the "only the latest search answers" rule FindRecord already has).
- **Retake:** retaking a photo after a reading starts a new reading.

### 3.2 Record screen: the fun fact
- **When there's a fact:** it shows as today, with `Source: {host}`, plus a quiet `Found by Claude` line. *Our call*, so you can tell it from one you typed.
- **While it's being found:** `Finding a fun fact…` in the fun-fact spot.
- **No fact:** a **Find a fun fact** button (`h-12`). If nothing is found: `Claude couldn’t find one with a source.` The button stays for another try another day.
- **Edit:** the fun fact and its source stay editable, as now. A fact you typed is never replaced.

## 4. Rules

### 4.1 When a fun fact is fetched
- **Automatically:** right after any record is saved **on this phone** with `funFact` empty, whether it was saved by a card, by recognition, by the hand form or by Bought it new at the show. **Undo** cancels it if it hasn't started.
- **Offline or failed:** the record goes on a small **fun-fact to-do list** kept on the phone (notebook meta). The list is worked through when signal is back, one at a time. A record is tried **at most twice automatically**, then left for the button.
- **Saving the fact:** a found fact is saved as an ordinary `record.patch { funFact, funFactSource }` (a pair, as in Plan 4a). It's patched only if the record **still has no fun fact** and isn't deleted when the answer arrives.
- **Which phone asks:** only the phone that saved the record. A record Megan added gets its fact from her phone.

### 4.2 Sending photos to Claude
- **What's sent:** the two squared photos (1600 px JPEG) go to the Edge Function. It sends them to Claude and keeps nothing; it logs only the status.
- **Settings notice** (*our call*): *"Photos you take to add a record are sent to Anthropic's Claude to read the sleeve. They aren't stored there."*
- **Rechecking what Claude read:**
  - Barcodes are digits only, 8–14 long.
  - A catalog number is trimmed text of up to 40 characters.
  - Artist and title are trimmed text of up to 200 characters.
  - Anything that fails is dropped, never guessed.

### 4.3 "Exact"
A match counts as exact only when:
- the **barcode** search returns exactly **one** release; or
- the **catalog-number** search, filtered to the artist Claude read, returns exactly **one** release.

A name-only search is **never** exact: it always shows cards.

## 5. Server

Two new Edge Functions, written the way `discogs-search` is:
- a thin Deno `index.ts`;
- plain-TypeScript modules that Vitest tests;
- the same **signed-in user check**, using `auth.ts`, which moves to `supabase/functions/_shared/` and is reused by all three functions;
- `verify_jwt = true` in `config.toml`.

### 5.1 `identify-record`
- **Request:** `POST { front: base64 JPEG, back: base64 JPEG | null }`.
  - Each photo must be at most 2 MB once decoded, else 400.
  - Missing front: 400.
- **Step 1, reading the sleeve:**
  - **Model and output:** `claude-haiku-5-5` with structured output (`output_config.format`, a JSON schema) returning `{ artist, title, barcode, catalog, label }`, each a string or null. It is told to copy only what's printed and return null for anything it can't read.
  - **Refusals:** Haiku 5.5 has **no server-side refusal fallback**. A `refusal` stop reason is treated as nothing read.
- **Step 2, searching Discogs** (with the existing token and helper):
  1. `barcode={digits}&type=release`
  2. `catno={catalog}&artist={artist}&type=release&format=Vinyl`
  3. `q={artist} {title}&type=release&format=Vinyl` (the 2a search)

  It stops at the first step that finds anything.
- **Response:**
  ```
  {
    read: { artist, title, barcode, catalog, label },
    match: 'exact' | 'several' | 'none',
    results: FoundRecord[]
  }
  ```
  `results` uses the same shape and shaping as `discogs-search`, up to 6.
- **Errors:**
  - Claude or Discogs down → 502 `{ error: 'down' }`;
  - Discogs rate limit → 429;
  - not signed in → 401.
- **Timeouts:** the app gives it 30 s; inside, Claude gets 20 s and Discogs 15 s per request.

### 5.2 `fun-fact`
- **Request:** `POST { artist, title, year: number | null, label: string | null }`.
- **The model call:**
  - `claude-haiku-5-5` with the **web search tool**: `web_search_20250305`, the basic version, because Haiku isn't on the dynamic-filtering list. Use `max_uses: 3`.
  - Structured output `{ fact: string | null, sourceUrl: string | null }`.
  - The prompt asks for **one** surprising, true fact about this album's making, history or reception, in one or two sentences (at most 300 characters), with the page it came from.
- **Checks before returning** (Plan 4a §6.3). The function returns `{ fact: null }` if any of these fail:
  - `fact` is 1–300 characters;
  - `sourceUrl` is `https://`;
  - `sourceUrl` is **one of the URLs the web search actually returned in this response**. This is the guard against invented sources.
- **Refusals and tool errors:** a refusal, or a web search tool error, also gives `{ fact: null }`.
- **Timeouts:** the app gives it 45 s, in the background; inside, Claude gets 40 s.
- *Builder's call, confirm at build time:* whether structured output combines with web search on Haiku 5.5. If it doesn't, ask for the JSON in the text and validate it in code; the same checks apply.

### 5.3 Secrets and spending
- **The key:** `ANTHROPIC_API_KEY` is a Supabase function secret, set by Kahrman in the dashboard (Edge Functions → Secrets), never in Terminal.
- **Limits:** the Console's monthly spending cap is the hard stop. There's no per-person table for two people. *Our call*, a change from Plan 4a's `ai_lookups`.
- **Logs:** they name only status codes and error names: no photos, no text, no keys.

## 6. App

- **`Backend` interface:**
  - `identifyRecord(front: ArrayBuffer, back: ArrayBuffer | null): Promise<Identified>`
  - `findFunFact(r: { artist; title; year; label }): Promise<{ fact: string; sourceUrl: string } | null>`

  Both use plain `fetch` with their own timeouts, like `searchDiscogs`, and the same error words (`NO_SIGNAL`; `Sign in again…`; down; rate-limited). `FakeBackend` gets canned answers and failure switches.
- **Add screen:**
  - Reading starts from the photo area once the photos are done. Its answer feeds FindRecord: exact → the same save path as tapping a card, including the duplicate question; several → cards; none → fill and search.
  - *Builder's call:* exactly how the reading state is shared between PhotoCapture and FindRecord.
- **Fun facts:**
  - A small `funFacts` module holds the to-do list (notebook meta) and a hook on the app shell that works through it when online.
  - Saves call `wantFunFact(recordId)` after `perform`.
  - The Record screen gets the button and the "Finding…" state.
- **No database migration.** `fun_fact` and `fun_fact_source` exist since build 1; the record rules already require https and a fact with any source.

## 7. Cost

These are expected figures, to be measured on ten real records before go-live, from the Haiku 5.5 rates of $0.10 per million input tokens and $0.50 per million output tokens:
- **Reading a sleeve:** two images at about 3,000 tokens each, plus a short answer, comes to about 0.1¢.
- **A fun fact:** one to three web searches at $10 per 1,000 (1–3¢), plus the tokens of the search results (about 0.2¢), comes to about 1–3¢. The search is most of the cost.
- **Catch-up session:** a 300-record catch-up comes to about $3–10 in total.

*Proposal:* a $10 monthly cap. Kahrman decides.

## 8. Not in this plan
- Dictation clean-up ("tell Claude the record" by voice). Typing or the keyboard mic into Find already works.
- Claude filling other missing fields on old records.
- Recognition for Bought it at the show.
- Any per-person usage limits or a usage screen.

## 9. Testing
- **Unit tests:**
  - the read-answer checks (barcode digits, lengths);
  - the exact / several / none rule;
  - the Discogs search order;
  - the fun-fact checks, including a source that isn't among the search results → null;
  - the to-do list (retries capped at two, deleted records and filled facts skipped).
- **Fakes:** FakeBackend-driven screen tests cover every state in §3.1 and §3.2. An exact match saves with photos, Undo restores them, and duplicate still asks.
- **Live, with Kahrman, before go-live:** ten sleeves from his shelf, checking:
  - how many were exact and right;
  - any wrong pressing saved;
  - each fun fact's truth, against its source;
  - the measured cost, read from the Console.

## 10. Go-live
1. **Kahrman, once:**
   1. Create an Anthropic Console account at console.anthropic.com. It's separate from Claude Pro.
   2. Add a payment method and set the monthly spending cap.
   3. Create an API key.
   4. Paste the key into Supabase dashboard → Edge Functions → Secrets as `ANTHROPIC_API_KEY`. Never into chat or Terminal.
2. **(OK)** Deploy `identify-record` and `fun-fact`, and redeploy `discogs-search` for the shared `auth.ts`.
3. **(OK)** Push the branch for a test link. Run the ten-sleeve check on the phone.
4. **(OK)** Merge to `main`.

## 11. Left to the builder
- Prompt wording within the rules above.
- How the reading state flows between the photo area and Find.
- The fun-fact to-do list's storage shape.
- Retry back-off.
- Whether to shrink photos further before sending, if cost or speed calls for it.
