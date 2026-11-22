# Plan 4c: Claude reads the sleeve, and writes the fun fact (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the photos are taken on Add, Claude Haiku reads the sleeve and the record is found on Discogs (saved straight away when exact). Every record saved on this phone gets a sourced fun fact a moment later, and older records get a **Find a fun fact** button.

**Architecture:**
- **Server:** two new Supabase Edge Functions, `identify-record` and `fun-fact`, call Claude Haiku 5.5 through the Anthropic SDK. Each has a thin Deno `index.ts` over plain-TypeScript modules that Vitest tests. The shared code (`auth.ts`, the Discogs request, the result shaping) moves to `supabase/functions/_shared/`.
- **App:** the app reaches both functions only through `Backend` (`identifyRecord`, `findFunFact`).
- **Recognition:** it runs inside `FindRecord` through a `useReadSleeve` hook and feeds FindRecord's existing save / cards / search paths.
- **Fun facts:** they're a small queue kept in notebook meta, worked by one runner mounted in the app shell, and saved as ordinary `record.patch` postcards.

**Tech Stack:** React 19, TypeScript, Dexie 4, Supabase Edge Functions (Deno) with `npm:@anthropic-ai/sdk@1.6.0`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-plan-4c-claude-reads-and-fun-facts-design.md`. Read it before starting any task.

## Global Constraints

- **Model:** `claude-haiku-5-5`, used for both functions.
  - **Fun fact:** the web search tool is `{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }`.
  - **Refusals:** Haiku 5.5 has **no** server-side refusal fallback, so check `stop_reason === 'refusal'` before reading content.
- **SDK pin:** `npm:@anthropic-ai/sdk@1.6.0` in Deno; other SDK versions are not allowed. No local Deno exists, so only the pure modules are tested; `index.ts` files stay thin.
- **Data rules:**
  - No Discogs image or search result is ever stored.
  - Photos are never stored or logged by the functions.
  - Logs name only a status code or an error's name.
- **Secrets:** `ANTHROPIC_API_KEY` is a Supabase function secret, set by Kahrman in the dashboard, never in Terminal or chat. `DISCOGS_TOKEN` already exists.
- **Signed-in check:** both functions require a real signed-in user via the shared `signedInUser` (`verify_jwt = true` in `supabase/config.toml` too).
- **Timeouts:**
  - the app gives `identifyRecord` **30 s** and `findFunFact` **45 s**;
  - inside the functions, Claude gets **20 s** (identify) and **40 s** (fun fact), and Discogs gets **15 s** per request.
- **Limits:**
  - photo body: each photo **≤ 2 MB** decoded;
  - read text: barcode **8–14 digits**; catalog **≤ 40** characters; artist, title and label **≤ 200** characters each, trimmed;
  - fun fact: **1–300** characters, with an `https://` source that was among the URLs the web search returned.
- **Wording:** every string in spec §3 and §4.2 is used verbatim, with curly apostrophes. Tap targets are at least 48 px (`h-12`).
- **Writes:** every write goes through `perform` and the outbox. A fun fact is saved as one `record.patch { funFact, funFactSource }`.
- **Commits:** messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Approval:** never deploy, apply anything to production, set secrets, push or merge without Kahrman's explicit OK.

## Review Focus

1. **Undo after an automatic save must not read the sleeve again.** Instead the name search runs and other pressings show. Task 8 tests this.
2. **The person searches while a reading is on its way.** Their search wins, and the reading's late answer is ignored, with nothing saved. Task 8.
3. **Fun-fact answers that arrive late.** A fact arriving after the person typed one, or after Undo deleted the record, is not saved. Task 6.
4. **The fun-fact runner with no signal, or after two failures.** No signal keeps the queue. A record is retried at most twice and then left alone. Runs never overlap. Task 6.
5. **A Claude reply quoting a source the search never returned** (an invented URL) gives no fact. Task 3.

---

### Task 1: Shared function code moves to `supabase/functions/_shared/`

**Files:**
- Move: `supabase/functions/discogs-search/{auth.ts,auth.test.ts,discogs.ts,discogs.test.ts,shape.ts,shape.test.ts,fixtures/}` → `supabase/functions/_shared/` (use `git mv`)
- Modify: `supabase/functions/discogs-search/index.ts`, `src/data/backend.ts` (the `FoundRecord` type import path), and any other importer (`grep -rn "discogs-search/" src supabase`)
- Modify: `supabase/functions/_shared/discogs.ts`

**Interfaces:**
- Produces:
  - `searchDiscogsWith(params: Record<string, string>, token: string | undefined, fetchFn?: typeof fetch): Promise<Answer>`. It builds `https://api.discogs.com/database/search?{params}&type=release&per_page=6`, with the same headers, the 15 s timeout and the same error mapping as today.
  - `askDiscogs(query, token, fetchFn)` becomes `searchDiscogsWith({ q: query, format: 'Vinyl' }, …)` and behaves exactly as before.
  - `Answer`, `shapeResults`, `FoundRecord`, `cleanQuery`, `splitTitle` and `signedInUser` are unchanged, just at their new paths.

- [ ] **Step 1:** `git mv` the files.
- [ ] **Step 2:** Update the imports. Add to `discogs.test.ts`:
  - `searchDiscogsWith sends the given params with type=release and per_page=6`: the fetch spy's URL has `barcode=0123&type=release&per_page=6`, and no `q`.
  - `askDiscogs still searches vinyl by q`: the URL has `q=…&format=Vinyl`.
- [ ] **Step 3:** Run `npx vitest run supabase/functions && npx tsc -b`. Expected: pass.
- [ ] **Step 4:** Commit: `refactor(functions): share auth and the Discogs request between functions`.

---

### Task 2: `identify-record`: reading the answer, and finding the match (pure)

**Files:**
- Create: `supabase/functions/identify-record/read.ts`, `supabase/functions/identify-record/match.ts`
- Test: `supabase/functions/identify-record/read.test.ts`, `supabase/functions/identify-record/match.test.ts`

**Interfaces:**
- Consumes: `searchDiscogsWith` and `Answer` (Task 1).
- Produces:
  - `type Read = { artist: string | null; title: string | null; barcode: string | null; catalog: string | null; label: string | null }`.
  - `READ_SCHEMA`: the JSON schema object for `output_config.format` (`{ type: 'json_schema', schema: … }`). It's an object with those five keys, each `string` or `null`, all required, and `additionalProperties: false`.
  - `readRequest(front: string, back: string | null): object`: the `messages.create` params.
    - `model: 'claude-haiku-5-5'`, `max_tokens: 1024`, and `output_config: { format: READ_SCHEMA }`.
    - A user message holds the front image, then the back image if present (`{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }`), then a text instruction. The instruction says to copy only what's printed: artist and title from the front; barcode digits, catalog number and label from the back; null for anything unreadable.
  - `cleanRead(raw: unknown): Read`. It applies the Global Constraints limits:
    - the barcode has spaces and hyphens removed, then must be 8–14 digits;
    - anything that fails becomes null;
    - non-objects give all-null.
  - `readFromMessage(message: { stop_reason: string | null; content: { type: string; text?: string }[] }): Read`.
    - A refusal, a missing text block or unparseable JSON gives all-null.
    - Otherwise it's `cleanRead(JSON.parse(text))`.
    - This is a minimal structural type on purpose: the SDK can't be imported under Vitest.
  - `type Identified = { read: Read; match: 'exact' | 'several' | 'none'; results: FoundRecord[] }`.
  - `findMatch(read: Read, search: (params: Record<string, string>) => Promise<Answer>): Promise<{ status: number; body: Identified | { error: string } }>`. It follows spec §5.1 step 2 and §4.3:
    1. barcode → `{ barcode }`;
    2. catalog with artist → `{ catno, artist, format: 'Vinyl' }`;
    3. artist and title → `{ q: \`${artist} ${title}\`, format: 'Vinyl' }`.
    - Skip a step whose inputs are null, and stop at the first step with results.
    - The match is `exact` only when step 1 or step 2 returns exactly one result; step 3 is `several` or `none`.
    - A 429 → `{ status: 429, body: { error: 'rate-limited' } }`; any other non-200 → 502 `{ error: 'down' }`.
    - All steps empty or skipped → `match: 'none'`, `results: []`.

- [ ] **Step 1: Write the failing tests.**
  - `cleanRead`:
    - `'0 25218 84312 3'` → `'025218843123'`;
    - a 7-digit barcode → null;
    - a 41-character catalog → null;
    - `'  Vince Guaraldi Trio '` → trimmed;
    - `null` → all-null;
    - extra keys ignored.
  - `readFromMessage`: refusal → all-null; invalid JSON → all-null; valid → cleaned.
  - `readRequest`:
    - two image blocks in order, front first;
    - one block when back is null;
    - model `claude-haiku-5-5`;
    - `output_config.format.schema.required` has all five keys.
  - `findMatch` with a fake `search`:
    - barcode finds 1 → exact, and only 1 call;
    - barcode finds 3 → several;
    - barcode finds 0, catalog finds 1 → exact, with the second call's params `{ catno, artist, format: 'Vinyl' }`;
    - only artist and title → step 3, and 1 result → `several`, not exact;
    - nothing readable → `none` with no calls;
    - a 429 → 429;
    - a 502 → 502 `{ error: 'down' }`.
- [ ] **Step 2:** Run `npx vitest run supabase/functions/identify-record`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same, plus `npx tsc -b`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(functions): read a sleeve's answer and find its Discogs match`.

---

### Task 3: `fun-fact`: the request and the checks (pure)

**Files:**
- Create: `supabase/functions/fun-fact/fact.ts`
- Test: `supabase/functions/fun-fact/fact.test.ts`

**Interfaces:**
- Produces:
  - `type FactInput = { artist: string; title: string; year: number | null; label: string | null }`.
  - `cleanFactInput(raw: unknown): FactInput | null`. Artist and title are required (1–200 characters, trimmed). `year` is an integer from 1900 to 2100, or null. `label` is ≤ 200 characters, or null.
  - `factRequest(input: FactInput): object`.
    - `model: 'claude-haiku-5-5'`, `max_tokens: 2048`, tools `[{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]`, and `output_config: { format: FACT_SCHEMA }`.
    - `FACT_SCHEMA` is `{ fact: string | null, sourceUrl: string | null }`.
    - The prompt asks for one surprising, true fact about this album's making, history or reception, in one or two sentences of at most 300 characters, taken from a page found with the search, with that page's URL; null for both if nothing is found.
  - `searchUrls(content: { type: string; content?: unknown }[]): Set<string>`: every `url` of the `web_search_result` items inside `web_search_tool_result` blocks. An error-object `content` contributes nothing.
  - `factFromMessage(message: { stop_reason: string | null; content: { type: string; text?: string; content?: unknown }[] }): { fact: string; sourceUrl: string } | null`.
    - A refusal → null.
    - It reads the **last** text block as JSON.
    - The fact must be 1–300 characters after trimming.
    - `sourceUrl` must start with `https://` and be **in `searchUrls(content)`**.
    - Anything else → null.

- [ ] **Step 1: Write the failing tests.**
  - `cleanFactInput`: good input → cleaned; missing title → null; year 1850 → year null.
  - `factRequest`: has the web search tool with `max_uses: 3`, and the model is `claude-haiku-5-5`.
  - `searchUrls`: two results → both URLs; an error-object block → empty.
  - `factFromMessage`:
    - valid, with the source among the search URLs → the fact;
    - **a source not among the search URLs → null**;
    - an `http://` source → null;
    - a 301-character fact → null;
    - refusal → null;
    - no text block → null;
    - `{ fact: null }` → null.
- [ ] **Step 2:** Run `npx vitest run supabase/functions/fun-fact`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same, plus `npx tsc -b`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(functions): fun-fact request and the checks that refuse unsourced facts`.

---

### Task 4: The two Edge Function entry points

**Files:**
- Create: `supabase/functions/identify-record/index.ts`, `supabase/functions/fun-fact/index.ts`
- Modify: `supabase/config.toml` (add `[functions.identify-record]` and `[functions.fun-fact]` with `verify_jwt = true`)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `POST /identify-record { front, back }` → `Identified` or an error, per spec §5.1.
  - `POST /fun-fact { artist, title, year, label }` → `{ fact, sourceUrl }` or `{ fact: null }`, per spec §5.2.

- [ ] **Step 1: Copy `discogs-search/index.ts`'s shape** (CORS, OPTIONS, 405, the signed-in check through `_shared/auth.ts`, json helper) into both files. Both use `import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0'`, and create the client once with `new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })`. A missing key → 500 `{ error: 'not-configured' }`, logged by name only.
- [ ] **Step 2: Write `identify-record`.**
  1. Validate that `front` is a base64 string whose decoded size is ≤ 2 MB, and that `back` is null or the same. Otherwise 400 `{ error: 'bad-photos' }`.
  2. Call `client.messages.create(readRequest(front, back), { timeout: 20_000, maxRetries: 0 })`, then `readFromMessage`.
  3. Call `findMatch(read, (p) => searchDiscogsWith(p, Deno.env.get('DISCOGS_TOKEN')))`.
  - Errors: an Anthropic API error or timeout → 502 `{ error: 'down' }`, logging only `error.name` and `status`.
- [ ] **Step 3: Write `fun-fact`.**
  1. `cleanFactInput` → 400 if null.
  2. `client.messages.create(factRequest(input), { timeout: 40_000, maxRetries: 0 })`.
  3. Handle `stop_reason === 'pause_turn'` by returning `{ fact: null }`. That's our call: no continuation loop for a one-line fact.
  4. Return `factFromMessage(...)` or `{ fact: null }`.
  - Errors: API error → 502 `{ error: 'down' }`.
- [ ] **Step 4: Check what can be checked.**
  - There's no local Deno, so run `npx tsc --noEmit --allowImportingTsExtensions --moduleResolution bundler --target es2022 --module esnext --types node supabase/functions/_shared/*.ts supabase/functions/identify-record/{read,match}.ts supabase/functions/fun-fact/fact.ts` to check the pure modules.
  - Confirm that SDK 1.6.0 accepts `output_config` and the `web_search_20250305` tool. Run `npm pack @anthropic-ai/sdk@1.6.0` into a scratch folder, unpack it there and read its messages types. Quote what you found in the report. If 1.6.0 lacks either, report DONE_WITH_CONCERNS, and don't pick another version yourself.
  - Then `npx vitest run supabase/functions`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(functions): identify-record and fun-fact Edge Functions`.

---

### Task 5: Backend methods in the app

**Files:**
- Modify: `src/data/backend.ts`, `src/data/supabaseBackend.ts`, `src/test/fakeBackend.ts`
- Test: `src/data/supabaseBackend.test.ts`, `src/test/fakeBackend.test.ts`

**Interfaces:**
- Consumes: the `Read` and `Identified` types, re-exported for the app from `supabase/functions/identify-record/match.ts` the same way `FoundRecord` is.
- Produces:
  - `Backend.identifyRecord(front: ArrayBuffer, back: ArrayBuffer | null): Promise<Identified>`, which base64-encodes the bytes.
  - `Backend.findFunFact(r: { artist: string; title: string; year: number | null; label: string | null }): Promise<{ fact: string; sourceUrl: string } | null>`.
  - Both use plain `fetch` through `fetchWithTimeout(30_000)` / `fetchWithTimeout(45_000)`, with the access token and publishable key, like `searchDiscogs`.
  - **Errors:**
    - 401 → `BackendError('Sign in again to look it up.')`;
    - 429 → `DISCOGS_MESSAGES.rateLimited`;
    - timeout or other failure → `BackendError(CLAUDE_DOWN)`;
    - offline or TypeError → `NO_SIGNAL`.

    `CLAUDE_DOWN = 'Couldn’t read the sleeve. Try again, or search below.'`, exported from `backend.ts`.
  - `findFunFact`: 200 `{ fact: null }` → `null`.
  - **FakeBackend:**
    - `identified: Identified` (default `{ read: all-null, match: 'none', results: [] }`), `funFacts: Map<string, { fact; sourceUrl } | null>` keyed by `${artist}|${title}`, and `claudeFails: 'down' | null`;
    - call logs `identifyCalls: number` and `funFactCalls: string[]`;
    - both methods go through `guard()`, so offline → NO_SIGNAL.
  - **Photo encoding:** a `base64(bytes: ArrayBuffer): string` helper in `supabaseBackend.ts` that works for 2 MB buffers, chunked rather than one giant spread.

- [ ] **Step 1: Write the failing tests**, in `supabaseBackend.test.ts`, stubbing the global fetch as the `searchDiscogs` tests do:
  - the request goes to `/functions/v1/identify-record` with `{ front, back }` as base64, and the base64 round-trips for a 3-byte buffer;
  - 401, 429, 502 and timeout each map to their message, and offline maps to NO_SIGNAL;
  - `findFunFact` returns null on `{ fact: null }`.
- [ ] **Step 2: Write the failing FakeBackend tests:** canned answers come back, and offline throws.
- [ ] **Step 3:** Run, expect FAIL; implement; run `npx vitest run src/data/supabaseBackend.test.ts src/test/fakeBackend.test.ts && npx tsc -b`, expect PASS.
- [ ] **Step 4:** Commit: `feat(backend): read a sleeve and find a fun fact`.

---

### Task 6: Fun facts arrive by themselves

**Files:**
- Create: `src/data/funFacts.ts`, `src/app/useFunFacts.ts`
- Modify:
  - `src/data/actions.ts` (add `addFunFact`);
  - `src/app/App.tsx` (mount the runner inside `SyncProvider`);
  - the three save paths: `src/ui/FindRecord.tsx` (new-record saves only), `src/screens/AddScreen.tsx` (the hand form, only when `funFact` is empty), and `src/screens/ShowScreen.tsx` (Bought it new).
- Test: `src/data/funFacts.test.ts`, `src/data/actions.test.ts`, `src/app/useFunFacts.test.tsx`, plus one test per save path in its existing test file.

**Interfaces:**
- Consumes: `Backend.findFunFact` (Task 5).
- Produces:
  - `addFunFact(r: ShelfRecord, found: { fact: string; sourceUrl: string }, ctx: Ctx): ActionResult`. It returns one `record.patch { funFact, funFactSource }` (checked against the record rules), with no undo.
  - `wantFunFact(db: ShelfDB, recordId: string): Promise<void>`, which adds the record to meta key `funFactQueue` (a JSON `{ recordId: string; tries: number }[]`) if it isn't already there.
  - `runFunFacts(db: ShelfDB, backend: Pick<Backend, 'findFunFact'>, ctx: { me: string }, after?: () => void): Promise<void>`. It works the queue oldest first, one at a time.
    - **Skip and remove** a record that is missing, deleted, or already has `funFact`.
    - **For each record:**
      1. Call `findFunFact({ artist, title, year, label })`.
      2. Re-read the record. Only if it still exists, isn't deleted and `funFact === null`, `perform(db, addFunFact(...).postcards, after)`.
      3. Remove it from the queue.
    - **`null`:** remove it and set meta `funFactNone:{recordId}` = `'true'`.
    - **NO_SIGNAL:** stop and keep the rest.
    - **Any other error:** increment `tries`; at 2, remove it.
    - **Overlap:** runs never overlap on one notebook (a module-level WeakMap chain, like `pushOutbox`).
  - `useFunFactStatus(recordId: string): 'queued' | 'none' | 'idle'`, a live query on the queue and `funFactNone:*`.
  - `useFunFacts()`, mounted once in the app shell. It runs `runFunFacts` on mount, on the window `online` event, and whenever `funFactQueue` changes (a live query), with `ctx.me` from `useCurrentShelf` and `runNow` from `useSyncStatus`.

- [ ] **Step 1: Write the failing tests** in `funFacts.test.ts`, with FakeBackend and a fresh `ShelfDB`:
  - **Saving a found fact:** the found fact is patched and leaves the queue.
  - **Typed meanwhile:** a fact typed between the request and the answer (set `funFact` on the record inside the fake's answer) → no patch, and it leaves the queue.
  - **Deleted meanwhile:** a record deleted meanwhile → no patch.
  - **No fact found:** `null` → `funFactNone:{id}` is set and it leaves the queue.
  - **Offline:** the queue is kept, with no tries counted.
  - **Two failures:** `claudeFails = 'down'` twice → removed after the second run.
  - **No overlap:** two `runFunFacts` called together → `findFunFact` is called once per record.
  - **No duplicates:** `wantFunFact` twice → one entry.
  - In `actions.test.ts`: `addFunFact` makes one patch with both fields, and refuses an `http://` source (record rules).
- [ ] **Step 2: Write the failing save-path tests:**
  - **FindRecord:** tapping a card queues the new record, and "Add to that one" does **not** queue anything.
  - **AddScreen hand form:** a save with an empty fun fact queues it; a typed fact doesn't.
  - **ShowScreen:** Bought it new queues it.
  - **`useFunFacts.test.tsx`:** mounted with a queued record and FakeBackend → the record gets its fact.
- [ ] **Step 3:** Run them and expect FAIL. Implement, then run `npx vitest run && npx tsc -b` and expect PASS.
- [ ] **Step 4:** Commit: `feat(facts): a sourced fun fact arrives a moment after a record is saved`.

---

### Task 7: The Record screen's fun-fact states, and the Settings notice

**Files:**
- Modify: `src/screens/RecordScreen.tsx`, `src/screens/SettingsScreen.tsx`
- Test: `src/screens/RecordScreen.test.tsx`, `src/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `useFunFactStatus` and `wantFunFact` (Task 6).

- [ ] **Step 1: Write the failing tests** for the Record screen when `funFact` is null:
  - status `queued` → `Finding a fun fact…` (`role="status"`) and no button;
  - status `idle` → a **Find a fun fact** button (`h-12`); tapping it queues the record and shows `Finding a fun fact…`;
  - status `none` → the button plus `Claude couldn’t find one with a source.`;
  - a record that has a fact shows it as today, with no button.
- [ ] **Step 2: Write the failing Settings test.** The notice reads exactly `Photos you take to add a record are sent to Anthropic’s Claude to read the sleeve. They aren’t stored there.`, and sits next to the Discogs notice.
- [ ] **Step 3:** Run them and expect FAIL. Implement, then run `npx vitest run src/screens && npx tsc -b` and expect PASS.
- [ ] **Step 4:** Commit: `feat(record): find a fun fact for older records`.

---

### Task 8: Add screen: Claude reads the sleeve

**Files:**
- Create: `src/ui/useReadSleeve.ts`
- Modify:
  - `src/ui/PhotoCapture.tsx`: add an `onReady?: (ready: boolean) => void` prop, and remove its "Now find it below…" line, which moves to FindRecord;
  - `src/ui/FindRecord.tsx`;
  - `src/screens/AddScreen.tsx`: pass `ready` from PhotoCapture to FindRecord's `photos.ready`.
- Test: `src/ui/useReadSleeve.test.tsx`, `src/ui/FindRecord.test.tsx`, `src/ui/PhotoCapture.test.tsx` (move the hint-line tests into FindRecord's), `src/screens/AddScreen.test.tsx`

**Interfaces:**
- Consumes: `Backend.identifyRecord` and `Identified` (Task 5); FindRecord's existing `pick` / `save` / `search` paths and `photos` prop.
- Produces:
  - **`onReady`:** PhotoCapture calls it with `true` exactly when its old hint-line condition holds (photos shown, not asking for the back, nothing squaring), and with `false` otherwise.
  - **`photos.ready`:** the `Photos` prop type gains `ready: boolean`.
  - **The hook:** `useReadSleeve({ drafts, ready, onAnswer }: { drafts: Drafts | null; ready: boolean; onAnswer: (a: Identified) => void }): { state: 'idle' | 'reading' | 'offline' | 'failed'; message: string | null; retry(): void; cancel(): void; skipNext(): void }`.
    - **Starting:** it starts a reading when `ready && drafts?.front` and these drafts (by object identity) haven't been read yet.
    - **Offline:** with no signal it gives state `offline`. `retry()` (the **Look it up** button) reads once signal is back.
    - **Late answers:** an answer that arrives after `cancel()`, after the drafts change, or after unmount is dropped.
    - **After Undo:** `skipNext()` marks the next drafts object as already read. FindRecord calls it in `onUndone`, before the drafts come back.
- **FindRecord** shows a status line above its search form, using the spec §3.1 copy verbatim:
  - `reading` → `Looking it up…`;
  - `offline` → `Needs signal to look it up. Your photos are kept.` with **Look it up**;
  - `failed` → the error with **Try again**;
  - idle with photos → `Now find it below, and these photos go with it.`;
  - `none` answer → `Couldn’t pin it down. Check the search below.`.
- **`onAnswer`:**
  - **`exact`:** as if the person tapped `results[0]`, through `pick`, so a duplicate still asks. The saved line gets a second line, `{year} · {label} · {catalog}`, with missing parts left out. To carry it, `SavedOffer` gains an optional `detail: string | null`.
  - **`several`:** show the cards with `Which pressing is yours?` above them, and set `found` the same way `search` does, with the query being what Claude read.
  - **`none`:** fill the box with what Claude read (`artist title`, lower-cased), show the `none` message, and run the search.
- **After Undo of a recognised save:** call `skipNext()`, fill the box with what Claude read, and run the name search. Record what was read with the saved offer, so Undo knows it.
- **The person's own search:** editing the box or submitting a search calls `cancel()`.

- [ ] **Step 1: Write the failing `useReadSleeve` tests** with FakeBackend:
  - **Starts once:** it reads when ready, and only once for the same drafts object.
  - **Offline:** state `offline`, then `retry()` once online → reads.
  - **Cancelled:** `cancel()` before the answer → `onAnswer` is never called.
  - **After Undo:** `skipNext()` → the next drafts aren't read.
  - **Failure:** `claudeFails` → state `failed` with `CLAUDE_DOWN`.
- [ ] **Step 2: Write the failing FindRecord tests**, with drafts and `ready: true`:
  - **Exact:** an exact answer saves the record with both photos, and the saved line shows the title and `1988 · Fantasy · F-8431`.
  - **Exact duplicate:** an exact answer for a record already on the shelf → the duplicate question.
  - **Several:** `Which pressing is yours?` and the cards.
  - **None:** the box is filled, the message shows, and a Discogs search is made.
  - **Undo after an exact save:** no second `identifyRecord` call, the box is filled with what was read, and a search is made.
  - **Typing during a reading:** the reading's answer is ignored, with no save.
  - **Offline:** the message and the **Look it up** button.
  - **Failure:** the message and **Try again**.
  - **The hint line:** it shows when idle with photos (the moved PhotoCapture tests).
- [ ] **Step 3: Write the failing AddScreen test.** Taking the front and back with an exact FakeBackend answer → one record with both photos, and the drafts are cleared.
- [ ] **Step 4:** Run them and expect FAIL. Implement, then run `npx vitest run && npx tsc -b && npm run build` and expect PASS.
- [ ] **Step 5:** Commit: `feat(add): Claude reads the sleeve and finds the record`.

---

### Task 9: Go live with Kahrman

This task is run by the controller with Kahrman. Each **(OK)** step needs his explicit yes.

- [ ] **Step 1: Ready check.** Run `npx vitest run && npx tsc -b && npm run build`.
- [ ] **Step 2: Kahrman sets up Claude** (spec §10.1): the Console account, the spending cap, the key and the dashboard secret `ANTHROPIC_API_KEY`. Check its name only, with `npx supabase secrets list --project-ref rlhhrzkaosngafcoxaas`.
- [ ] **Step 3 (OK): Deploy.** `npx supabase functions deploy identify-record fun-fact discogs-search --project-ref rlhhrzkaosngafcoxaas --yes`. Then smoke-test each function. Without sign-in → 401. Then make **one signed-in call to each**, from the test link on Kahrman's phone:
  - one real sleeve through Add, which calls `identify-record`;
  - one known album through **Find a fun fact**, which calls `fun-fact`.

  Read both functions' logs. Expect no `stop` lines and no 400s; a 400 here is not billed. This costs under 5¢. If a schema or a parameter is refused, fix it before the ten-sleeve test.
- [ ] **Step 4 (OK): Phone test.** Push the branch and test on the stable preview link with ten real sleeves (spec §9): exact and right, any wrong pressing, each fact against its source, and the cost from the Console.
- [ ] **Step 5 (OK): Merge to `main`.**
- [ ] **Step 6: Handoff.** Add the notes to `docs/superpowers/notes/plan-2-handoff.md` and commit.
