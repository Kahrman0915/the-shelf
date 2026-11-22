# Plan 4b, Build 1: Record photos (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every record can have its own front and back photo, taken on the phone, automatically cropped to the sleeve and squared up, stored privately for the shelf. The Record screen shows the front, with a Flip to the back.

**Architecture:** Photos are squared up on the phone with OpenCV.js, which is loaded only when the camera is first used. The JPEG bytes are kept in the notebook (a new Dexie `photos` table) and sent through the existing outbox as `photo.upload` postcards. The courier uploads them to a private Supabase Storage bucket, `covers`, and only then patches the record's `coverPath` / `backPath`. Other phones download a photo when its record is opened and keep it. Pure functions in `src/data/photos.ts` turn "these photos for this record" into postcards, the same way `actions.ts` does for fields.

**Tech Stack:** React 19, TypeScript, Dexie 4, Supabase JS 2.116 (Storage), `@techstark/opencv-js` 4.12.0-release.1, Vitest + fake-indexeddb, PGlite.

**Spec:** `docs/superpowers/specs/2026-11-22-plan-4b-photo-add-design.md`. Read it before starting any task. §3 is this build.

## Global Constraints

- Screens never call Supabase. Only `src/data/supabaseBackend.ts` does, behind the `Backend` interface.
- Every write goes through the outbox (`perform` → `savePostcards`). `applyPostcard` is the only code that changes the notebook's records.
- The migration goes live before the app.
- Every tap target is at least 48 px (`h-12` or larger).
- Messages use plain words, with curly apostrophes (`’`) as in existing copy.
- A photo's storage path, which is also the value of `coverPath` / `backPath`, is `{shelfId}/{recordId}/{side}-{photoId}.jpg`, where `side` is `front` or `back` and `photoId` is a fresh `crypto.randomUUID()` for every photo taken. The bucket is `covers`, and the bucket name is not part of the path.
- A squared photo is exactly **1600 × 1600 px JPEG at quality 0.85**.
- Photo bytes are stored in IndexedDB as **`ArrayBuffer`, never `Blob`**: Blobs don't survive fake-indexeddb in tests (checked), and ArrayBuffers are the safer choice on iOS too.
- Any new key on records needs a Dexie version bump, with an upgrade that fills it on stored records **and** on queued `record.create` postcards (the build 1 lesson).
- Never store or show Discogs images beyond what build 2a already does. These photos are Kahrman's and Megan's own.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never deploy, apply migrations to production, push or merge without Kahrman's explicit OK for that step.

## Review Focus

1. **iOS reloads the app while the camera is open** (it does this under memory pressure). Photos already taken for Add must still be there afterwards. Task 8 stores drafts in the notebook and tests a remount.
2. **Photos taken with no signal, app closed, signal back later.** The uploads go after the record's create, and before the patch that points the record at them. Sign-out counts them as unsent. Tests are in Task 4.
3. **A record's create is rejected.** Its photo uploads are held, not sent, and discarding the create drops the photo bytes from the phone. Task 4.
4. **Megan opens a record before Kahrman's photo has uploaded, or the download fails.** The poster shows, there's no error, and it tries again next time. Task 7.
5. **A double tap on a Discogs card while photos are waiting.** One record and one set of uploads. Task 9.

---

### Task 1: Database: `back_path`, the `covers` bucket and its rules

**Files:**
- Create: `supabase/migrations/20261122120000_record_photos.sql`
- Modify: `supabase/tests/harness.ts` (add a Storage stand-in before migrations run)
- Test: `supabase/tests/photos.test.ts`

**Interfaces:**
- Produces: column `public.records.back_path text`, updatable by `authenticated`; check constraints on the shape of `cover_path` and `back_path`; private bucket `covers` (2 MB limit, `image/jpeg` only); function `public.can_use_cover(p_name text) returns boolean`; four policies on `storage.objects`.

- [ ] **Step 1: Add the Storage stand-in to `harness.ts`.** Real Supabase provides this schema. Add a `STORAGE_STANDIN` string, run right after `AUTH_STANDIN` in `freshDb()`:

```sql
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid, created_at timestamptz not null default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
```

- [ ] **Step 2: Write the failing tests in `supabase/tests/photos.test.ts`.** Copy `recordDetails.test.ts`'s `beforeEach`: Kahrman owns `kShelf`, Megan is a member, and a stranger owns `sShelf`. Add a helper `put(u, name)` that runs `insert into storage.objects (bucket_id, name) values ('covers', $1)` as that user. Tests:
  - `the covers bucket is private and takes only JPEGs up to 2 MB`: select from `storage.buckets` where id = 'covers' → `public = false`, `file_size_limit = 2097152`, `allowed_mime_types = {image/jpeg}`.
  - `a member can add, see, replace and remove a photo in their shelf's folder`: as Megan, insert `${kShelf}/${rec}/front-${uuid}.jpg`; select it (1 row); update its `owner` (1 row); delete it (1 row).
  - `nobody outside the shelf can see or add its photos`: Kahrman inserts one. The stranger's select returns 0 rows, and the stranger's insert into `${kShelf}/…` rejects with `/row-level security/`.
  - `a folder that isn't a shelf id is refused`: Megan inserting `not-a-uuid/x/front-${uuid}.jpg` rejects with `/row-level security/`, and doesn't throw a cast error.
  - `other buckets are untouched by these rules`: with `('other','other')` in buckets, Megan inserting into bucket `other` rejects (no policy).
  - `a member can point a record at its photos`: as Megan, `update records set cover_path = '${kShelf}/${rec}/front-${uuid}.jpg', back_path = '${kShelf}/${rec}/back-${uuid}.jpg'` → 1 row.
  - `a record can only point at photos in its own folder`: `cover_path` set to `${sShelf}/${rec}/front-…`, to `${kShelf}/${otherRec}/front-…`, to `…/back-….jpg` (wrong side), or to `…/front-x.png` → each rejects with `/violates check constraint/`. The same goes for `back_path` with `front-`.

- [ ] **Step 3: Run them to see them fail.** Run `npx vitest run supabase/tests/photos.test.ts`. Expected: FAIL (no bucket, no `back_path`).

- [ ] **Step 4: Write the migration.** The policy logic goes through a `case`, so a non-uuid folder never reaches the uuid cast:

```sql
-- A record's own front and back photos, kept in a private bucket readable only by the shelf's members.
alter table public.records
  add column back_path text,
  add constraint records_cover_path_shape check (cover_path is null
    or cover_path ~ ('^' || shelf_id::text || '/' || id::text || '/front-[0-9a-f-]{36}\.jpg$')),
  add constraint records_back_path_shape check (back_path is null
    or back_path ~ ('^' || shelf_id::text || '/' || id::text || '/back-[0-9a-f-]{36}\.jpg$'));

grant update (back_path) on public.records to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- The first folder of a photo's name is its shelf.
create function public.can_use_cover(p_name text) returns boolean language sql stable set search_path = '' as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_member(split_part(p_name, '/', 1)::uuid)
    else false
  end $$;
revoke all on function public.can_use_cover(text) from public, anon;
grant execute on function public.can_use_cover(text) to authenticated;

create policy "members see their shelf's photos" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and public.can_use_cover(name));
create policy "members add photos to their shelf" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and public.can_use_cover(name));
create policy "members replace their shelf's photos" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and public.can_use_cover(name)) with check (bucket_id = 'covers' and public.can_use_cover(name));
create policy "members remove their shelf's photos" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and public.can_use_cover(name));
```

- [ ] **Step 5: Run the tests.** Run `npx vitest run supabase/tests`. Expected: every DB test passes, including the older files, since the migration must not break them.

- [ ] **Step 6: Commit.** `git add supabase && git commit -m "feat(db): record photos: back_path, private covers bucket, member-only rules"`

---

### Task 2: `backPath` on records, and notebook version 5

**Files:**
- Modify: `src/data/schema.ts`, `src/data/rowMapping.ts`, `src/data/db.ts`, `src/data/actions.ts` (`boughtNew`, `addRecord`), `src/data/importCollection.ts`
- Modify: every test fixture that builds a whole `ShelfRecord` (`grep -rln "coverPath: null" src`) to add `backPath: null` beside it
- Create: `src/data/photos.ts` (types only in this task)
- Test: `src/data/rowMapping.test.ts`, `src/data/dbUpgrade.test.ts`, `src/data/db.test.ts`

**Interfaces:**
- Produces:
  - `ShelfRecord.backPath: string | null`;
  - `RecordRow.back_path`;
  - `'backPath'` in `EDITABLE_FIELDS`;
  - in `src/data/photos.ts`: `type PhotoSide = 'front' | 'back'`, `PHOTO_SIDES: readonly PhotoSide[]` (`['front', 'back']`), `type StoredPhoto = { path: string; bytes: ArrayBuffer }`, `type DraftPhoto = { side: PhotoSide; bytes: ArrayBuffer; foundEdges: boolean }`, `type Drafts = Partial<Record<PhotoSide, DraftPhoto>>`, `PATH_FIELD: Record<PhotoSide, 'coverPath' | 'backPath'>` (`{ front: 'coverPath', back: 'backPath' }`);
  - `ShelfDB.photos: EntityTable<StoredPhoto, 'path'>` and `ShelfDB.photoDrafts: EntityTable<DraftPhoto, 'side'>`, both cleared by `clearPhone`, `clearPhoneIfNothingWaiting` and `rememberSession`'s person switch.

- [ ] **Step 1: Write the failing tests.**
  - `rowMapping.test.ts`: `back_path round-trips` (`recordFromRow(recordToRow(r))` keeps `backPath: 'S/R/back-….jpg'`), and `patchToRow({ backPath: x })` → `{ back_path: x }`.
  - `dbUpgrade.test.ts`, new `describe('version 5')`: open a Dexie of the same name at **version 4** (copy the v4 store spec), put a record with no `backPath` key and a queued `record.create` postcard whose fields lack it, close, then open `new ShelfDB(name)`.
    - `fills backPath with null on stored records and queued creates`: both have `backPath: null`, and the record passes `RecordSchema.parse`.
    - `adds the photos and photoDrafts tables`: `put` then `get` of `{ path: 'p', bytes: new Uint8Array([1, 2]).buffer }` works, and the bytes read back equal `[1, 2]`.
  - `db.test.ts`: `clearPhone empties photos and photo drafts too`.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run src/data/rowMapping.test.ts src/data/dbUpgrade.test.ts src/data/db.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Schema and rows:** in `RecordSchema`, add `backPath: optionalText` after `coverPath`. Add `back_path` to `RecordRow`, `recordToRow`, `recordFromRow` and, after `'coverPath'`, to `EDITABLE_FIELDS`.
  - **Actions and import:** `boughtNew`, `addRecord` and `importCollection` set `backPath: null`.
  - **Dexie:** add `this.version(5)` with the v4 stores plus `photos: 'path'` and `photoDrafts: 'side'`. Its upgrade fills `backPath` on records and queued creates by reusing the v4 fill helper, generalised as `fill(keys)(r)`.
  - **Clearing:** add both new tables to `everything()`.
  - **Fixtures:** add `backPath: null` to every full record fixture (the grep above).

- [ ] **Step 4: Run all tests and the type check.** Run `npx vitest run && npx tsc -b`. Expected: all pass, no type errors.

- [ ] **Step 5: Commit.** `git commit -am "feat(data): backPath on records, notebook v5 with photos and photo drafts"`

---

### Task 3: Backend: upload, download and delete photos

**Files:**
- Modify: `src/data/backend.ts`, `src/data/supabaseBackend.ts`, `src/test/fakeBackend.ts`
- Test: `src/data/supabaseBackend.test.ts`, `src/test/fakeBackend.test.ts`

**Interfaces:**
- Produces:
  - `ShelfWriter.uploadPhoto(path: string, bytes: ArrayBuffer): Promise<void>`: overwrites, so it's safe to repeat.
  - `ShelfWriter.deletePhoto(path: string): Promise<void>`: deleting a missing file is not an error.
  - `Backend.downloadPhoto(path: string): Promise<ArrayBuffer | null>`: `null` when the file isn't there (yet); throws `BackendError(NO_SIGNAL)` offline.
  - `COVERS_BUCKET = 'covers'` (in `backend.ts`).
  - `REJECTED.photoGone = 'That photo is no longer on this phone.'` and `REJECTED.photoTooBig = 'That photo is too big for the shelf.'`.
  - `FakeBackend.photos: Map<string, ArrayBuffer>`, a public "server" store. Upload and delete go through `beginWrite`/`endWrite`, so `rejectNext` and `loseNextReply` work for them. Download goes through `guard()`.

- [ ] **Step 1: Write the failing tests.** In `supabaseBackend.test.ts`, use a client stub `{ storage: { from: vi.fn(() => bucket) } }` where `bucket` has `upload`, `download` and `remove` mocks.
  - `uploadPhoto sends a JPEG to the covers bucket, overwriting`: `from` was called with `'covers'`, and `upload` with `(path, bytes, { contentType: 'image/jpeg', upsert: true })`.
  - `uploadPhoto: offline → NO_SIGNAL`: an error `{ message: 'Failed to fetch' }` throws `BackendError(NO_SIGNAL)`.
  - `uploadPhoto: refused by the rules → REJECTED.permission`: `{ message: 'new row violates row-level security policy', statusCode: '403' }`.
  - `uploadPhoto: too large → REJECTED.photoTooBig`: `{ statusCode: '413', message: 'Payload too large' }`.
  - `downloadPhoto returns the bytes`: `download` resolves `{ data: new Blob([1, 2]), error: null }`, and the result is an ArrayBuffer with bytes `[1, 2]`.
  - `downloadPhoto: not there yet → null`: `{ message: 'Object not found', statusCode: '404' }`, and the same for status `'400'` with that message.
  - `deletePhoto removes that one path`: `remove` was called with `[path]`, and offline throws NO_SIGNAL.
  - In `fakeBackend.test.ts`: upload, then download returns the same bytes; delete, then download → `null`; offline download throws NO_SIGNAL.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run src/data/supabaseBackend.test.ts src/test/fakeBackend.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement it in `supabaseBackend.ts` with `client.storage.from(COVERS_BUCKET)`.**
  - **Error helper:** add `photoFailure(error: { message: string; statusCode?: string }): never`.
    - `offlineLooking` → NO_SIGNAL;
    - 403, or row-level security / unauthorized → `REJECTED.permission`;
    - 413, or `/too large|maximum allowed size/i` → `REJECTED.photoTooBig`;
    - anything else → `REJECTED.other(\`photo ${statusCode ?? 'unknown'}\`)`.
  - **Download:** a not-found error (status 404, or 400 with `/not found/i`) returns `null`. Anything else goes through `photoFailure`, and a Blob result is turned into an ArrayBuffer with `await data.arrayBuffer()`.
  - **Timeouts:** Storage requests use the client's global 15 s `fetchWithTimeout`. A timeout there counts as no signal, which is right for uploads, since the courier will try again.
  - **FakeBackend:** mirrors these methods.

- [ ] **Step 4: Run the tests.** Run `npx vitest run && npx tsc -b`. Expected: all pass.

- [ ] **Step 5: Commit.** `git commit -am "feat(backend): upload, download and delete record photos"`

---

### Task 4: Outbox and courier: photo postcards

**Files:**
- Modify: `src/data/outbox.ts`, `src/data/courier.ts`, `src/data/actions.ts` (`perform`)
- Test: `src/data/outbox.test.ts`, `src/data/courier.test.ts`

**Interfaces:**
- Consumes: Task 2's `StoredPhoto` and `db.photos`; Task 3's `uploadPhoto`, `deletePhoto` and `REJECTED.photoGone`.
- Produces:
  - `Postcard` gains `(Base & { kind: 'photo.upload'; fields: { path: string } })` and `(Base & { kind: 'photo.delete'; fields: { path: string } })`. Their `recordId` is the record the photo belongs to.
  - `savePostcards(db, postcards, photos: StoredPhoto[] = [])` writes `photos` to `db.photos` in the same transaction.
  - `perform(db, postcards, after?, photos: StoredPhoto[] = [])` passes `photos` on.

- [ ] **Step 1: Write the failing tests.**
  - `outbox.test.ts`:
    - `savePostcards keeps the photo bytes with the postcards, in one go`: after the save, `db.photos.get(path)` has the bytes and the outbox has the `photo.upload`. If a postcard in the batch breaks the record rules, neither the photo nor the postcard is saved.
    - `photo postcards don't change the record`: `applyPostcard` of `photo.upload` / `photo.delete` leaves `db.records` equal.
  - `courier.test.ts`, using FakeBackend. In each test, the batch is the create of A, then `photo.upload` for `S/A/front-…`, then `record.patch { coverPath }`.
    - `sends the create, then the photo, then the pointer`: spy on `uploadPhoto`, `insertRecord` and `patchRecord` and assert the call order. After the run, `fake.photos.get(path)` equals the bytes and `fake.recordRow(A).cover_path === path`.
    - `no signal keeps the photo for next time`: with `fake.online = false`, push → `noSignal`, the photo is still in `db.photos`, and the outbox count is 3. Then `clearPhoneIfNothingWaiting(db)` returns 3 and clears nothing.
    - `a rejected create holds that record's photos`: `fake.rejectNext = REJECTED.range` → after the push, `uploadPhoto` was never called, and the upload and patch are still `waiting`.
    - `a photo missing from the phone is rejected, not skipped`: delete `db.photos` for the path before pushing. The upload postcard becomes `rejected` with `REJECTED.photoGone`, and the patch is held.
    - `photo.delete removes the file on the shelf and on this phone`: `fake.photos` and `db.photos` no longer have the path.
    - `a lost reply on upload is safe to send again`: with `fake.loseNextReply = true`, push twice. The second run sends it again and ends with the photo stored once and the outbox empty.
    - `discarding a create drops its photo bytes from the phone`: reject the create, then `discardPostcard`. `db.photos.get(path)` is undefined.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run src/data/outbox.test.ts src/data/courier.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`applyPostcard`:** the two photo kinds `return` without changing anything.
  - **`savePostcards`:** its transaction adds `db.photos`, and does `bulkPut(photos)` before adding the postcards.
  - **`send`:** it becomes `send(db, writer, p)`.
    - `photo.upload` reads `db.photos.get(path)`. Missing → throw `BackendError(REJECTED.photoGone)`; otherwise `writer.uploadPhoto(path, photo.bytes)`.
    - `photo.delete` calls `writer.deletePhoto(path)`, then `db.photos.delete(path)`.
  - **`discardPostcard`:** its transaction adds `db.photos`, and deletes the `db.photos` entries of the dropped `photo.upload` postcards.

- [ ] **Step 4: Run all tests.** Run `npx vitest run && npx tsc -b`. Expected: all pass.

- [ ] **Step 5: Commit.** `git commit -am "feat(outbox): photo upload and delete postcards, sent in order by the courier"`

---

### Task 5: Photo actions (pure)

**Files:**
- Modify: `src/data/photos.ts`, `src/data/actions.ts` (`editRecord`, `restoreWithEdits`)
- Test: `src/data/photos.test.ts`, `src/data/actions.test.ts`

**Interfaces:**
- Consumes: Task 2's types and Task 4's postcard kinds.
- Produces, in `src/data/photos.ts`:
  - `photoPath(shelfId: string, recordId: string, side: PhotoSide, photoId: string): string`.
  - `type PhotoChange = { kind: 'new'; photo: DraftPhoto } | { kind: 'remove' }` and `type PhotoChanges = Partial<Record<PhotoSide, PhotoChange>>`.
  - `type PhotoCtx = Ctx & { photoId: () => string }`.
  - `editPhotos(record: ShelfRecord, changes: PhotoChanges, ctx: PhotoCtx): { uploads: NewPostcard[]; fields: Partial<ShelfRecord>; deletes: NewPostcard[]; photos: StoredPhoto[] }`.
  - `type PhotoPlan = { postcards: NewPostcard[]; photos: StoredPhoto[]; undo: NewPostcard[]; later: NewPostcard[] }`.
  - `addPhotosTo(target: ShelfRecord, drafts: Drafts, ctx: PhotoCtx): PhotoPlan`.
  - `hasDrafts(drafts: Drafts): boolean`.
- Produces, in `actions.ts`: `editRecord(record, opened, edited, ctx, extra: Partial<ShelfRecord> = {})` and `restoreWithEdits(record, opened, edited, ctx, extra: Partial<ShelfRecord> = {})`. `extra` is merged into the one patch, so a photo-only edit still produces a patch.

- [ ] **Step 1: Write the failing tests in `photos.test.ts`.** Use a fixed `photoId` sequence `() => ids.shift()!`.
  - `photoPath`: `photoPath(S, R, 'front', P)` === `` `${S}/${R}/front-${P}.jpg` ``.
  - **`editPhotos`, new front on a record with none:** `uploads` is one `photo.upload` with that path; `fields` is `{ coverPath: path }`; `deletes` is `[]`; `photos` is `[{ path, bytes }]`.
  - **`editPhotos`, retaking the back:** the record has `backPath: OLD`. `fields` is `{ backPath: NEW }` and `deletes` is one `photo.delete { path: OLD }`.
  - **`editPhotos`, removing the front:** `fields` is `{ coverPath: null }`, `deletes` deletes the old one, and there are no uploads.
  - **`editPhotos`, removing a side that has no photo:** nothing at all.
  - **`editPhotos`, both sides:** the uploads are in the order front, then back.
  - **`addPhotosTo`, new record with both drafts:** `postcards` is the front upload, the back upload, then one `record.patch { coverPath, backPath }`. `undo` is a patch restoring both to null, plus deletes of both new paths. `later` is `[]`.
  - **`addPhotosTo`, an existing record that has a front, with only a front draft:** the patch sets only `coverPath`. `undo` restores the old `coverPath` and deletes the new file. `later` deletes the old front.
  - **`addPhotosTo` with empty drafts:** every list is empty.
  - In `actions.test.ts`: `editRecord with only photo fields still makes one patch` (`extra = { coverPath: p }`, no field changes → one patch `{ coverPath: p }`), and `restoreWithEdits merges extra after deletedAt`.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run src/data/photos.test.ts src/data/actions.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `addPhotosTo` is built on `editPhotos`, with each draft becoming a `{ kind: 'new' }` change.
    - Its `postcards` are `[...uploads, patch(fields)]`.
    - Its `undo` is `[patch(the target's old values of the changed path fields), ...photo.delete for each new path]`.
    - Its `later` is the `deletes` from `editPhotos`.
  - Every postcard uses `ctx.me`, `ctx.now`, `target.shelfId` and `target.id`.

- [ ] **Step 4: Run all tests.** Run `npx vitest run && npx tsc -b`. Expected: all pass.

- [ ] **Step 5: Commit.** `git commit -am "feat(data): pure photo actions for adding, retaking and removing photos"`

---

### Task 6: Squaring up a photo on the phone

**Files:**
- Modify: `package.json` (add `"@techstark/opencv-js": "4.12.0-release.1"`, exact), `vite.config.ts`
- Create: `src/photo/loadCv.ts`, `src/photo/geometry.ts`, `src/photo/findSleeve.ts`, `src/photo/squareUp.ts`
- Test: `src/photo/geometry.test.ts`, `src/photo/findSleeve.test.ts`

**Interfaces:**
- Produces:
  - `loadCv(): Promise<Cv>`: memoised; dynamic `import('@techstark/opencv-js')`; resolves once the runtime is ready. It handles both export styles: if `'Mat' in mod` it's ready; otherwise wait for `onRuntimeInitialized`. Never `await` the module object itself, because it's a thenable that can loop. `type Cv` is the package's default export type.
  - In `geometry.ts`:
    - `type Point = { x: number; y: number }` and `type Quad = [Point, Point, Point, Point]` (top-left, top-right, bottom-right, bottom-left);
    - `orderCorners(points: Point[]): Quad`;
    - `looksLikeSleeve(q: Quad, width: number, height: number): boolean`;
    - `centreSquare(width: number, height: number): Quad`;
    - `scaleQuad(q: Quad, factor: number): Quad`.
  - `findSleeveCorners(cv: Cv, image: { data: Uint8ClampedArray; width: number; height: number }): Quad | null`.
  - In `squareUp.ts`:
    - `SQUARE_PX = 1600`, `JPEG_QUALITY = 0.85`, `DETECT_PX = 800`, `SOURCE_MAX_PX = 3000`;
    - `squareUpPhoto(file: Blob): Promise<{ bytes: ArrayBuffer; foundEdges: boolean }>`.

- [ ] **Step 1: Install.** Run `npm install --save-exact @techstark/opencv-js@4.12.0-release.1`.

- [ ] **Step 2: Write the failing geometry tests.**
  - `orderCorners` puts four shuffled corners of a rotated square in TL, TR, BR, BL order.
  - `looksLikeSleeve`:
    - true for a 10°-rotated square covering 50% of the image;
    - false when it covers under 20%;
    - false when one pair of opposite sides differs by more than 40% (too skewed);
    - false when the width-to-height ratio is outside 0.6–1.6;
    - false when not convex (a bow-tie order).
  - `centreSquare(4000, 3000)` is the 3000 × 3000 square centred at x = 500.
  - `scaleQuad` multiplies every coordinate.

- [ ] **Step 3: Write the failing `findSleeve.test.ts`.** Add `// @vitest-environment node` at the top, and `beforeAll` with `cv = await loadCv()` (allow 30 s). Use a test helper `paint(width, height, quad, sleeve: number, table: number)`. It returns RGBA data with grey `sleeve` inside the quad (point-in-polygon) and `table` outside, plus ±8 random noise from a seeded generator.
  - `finds a dark sleeve on a light table, straight on`: 800 × 600, a quad 150 px in from each edge, made square. Every corner is within 2% of the image width.
  - `finds a sleeve shot at an angle`: a perspective quad (TL 120,90 / TR 690,130 / BR 650,560 / BL 160,520). Corners within 2%.
  - `finds a light sleeve on a dark table`: the straight case, with the colours swapped.
  - `gives up on a plain image`: uniform grey → `null`.
  - `gives up on a sleeve that's too small`: a quad covering 10% → `null`.
  - If `@techstark/opencv-js` can't run under Vitest at all, stop and report BLOCKED with the error. Don't mock it.

- [ ] **Step 4: Run them to see them fail.** Run `npx vitest run src/photo`. Expected: FAIL.

- [ ] **Step 5: Implement `geometry.ts`, then `findSleeve.ts`.**
  - **First attempt, edges:** gray → `GaussianBlur` 5 × 5 → `Canny(50, 150)` → `dilate` 3 × 3 → `findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)`. Go through contours from largest area to smallest. For each, `approxPolyDP` with epsilon at 2% of its perimeter. Take the first with 4 points that `isContourConvex` and `looksLikeSleeve` after `orderCorners`.
  - **Second attempt, if nothing is found:** an Otsu threshold (`THRESH_BINARY + THRESH_OTSU`), and then its inverse, through the same contour search.
  - **Memory:** `delete()` every Mat and MatVector in a `finally`. WebAssembly memory is not garbage-collected.

- [ ] **Step 6: Implement `squareUp.ts`.** It's browser-only and has no unit test; Task 11 checks it on the phone.
  1. `createImageBitmap(file, { imageOrientation: 'from-image' })`.
  2. Draw it on a canvas scaled so its long edge is ≤ `SOURCE_MAX_PX`. This keeps it under iOS's canvas limit and the WebAssembly memory small.
  3. Make a second copy scaled to ≤ `DETECT_PX` and run `findSleeveCorners` on its `getImageData`.
  4. Scale the quad back up. If none was found, use `centreSquare`.
  5. `getPerspectiveTransform` to the 1600 square, then `warpPerspective` with `INTER_CUBIC`.
  6. `cv.imshow` to a 1600 × 1600 canvas, then `toBlob('image/jpeg', JPEG_QUALITY)` → `arrayBuffer()`.
  - **If `loadCv()` fails** (first use with no signal): skip detection, draw the centre square straight onto the 1600 canvas with `drawImage`, and return `foundEdges: false`.
  - Delete the Mats in a `finally`, and close the ImageBitmap.

- [ ] **Step 7: Keep OpenCV out of the install download, and cached after first use.**
  - In `vite.config.ts` `workbox`, add `globIgnores: ['**/opencv*.js']`.
  - Add `runtimeCaching: [{ urlPattern: /\/assets\/opencv[^/]*\.js$/, handler: 'CacheFirst', options: { cacheName: 'opencv', expiration: { maxEntries: 2 } } }]`.
  - Run `npm run build` and check that `ls dist/assets` shows the OpenCV chunk's real name. Adjust both patterns to match it, and confirm it isn't listed in `dist/sw.js`'s precache manifest.

- [ ] **Step 8: Run the tests and the build.** Run `npx vitest run && npm run build`. Expected: all pass and the build succeeds. Ignore a chunk-size warning for the OpenCV chunk only.

- [ ] **Step 9: Commit.** `git add -A && git commit -m "feat(photo): find the sleeve and square it up on the phone with OpenCV"`

---

### Task 7: Showing photos: download and keep, and Flip on the Record screen

**Files:**
- Create: `src/data/usePhoto.ts`, `src/ui/RecordCover.tsx`
- Modify: `src/screens/RecordScreen.tsx` (`<Poster …/>` → `<RecordCover record={record} />`)
- Test: `src/data/usePhoto.test.tsx`, `src/ui/RecordCover.test.tsx`

**Interfaces:**
- Consumes: `db.photos` and `Backend.downloadPhoto`.
- Produces:
  - `usePhotoUrl(path: string | null): string | null`: an object URL for the photo, or null while it isn't on the phone.
    - It reads `db.photos` live. When the photo is missing, it calls `backend.downloadPhoto(path)` once per path per mount. In-flight downloads are shared through a module-level `Map<string, Promise<void>>`.
    - A download is stored with `db.photos.put`. A `null` result or any error leaves it null, with no message; the next mount tries again.
  - `useBytesUrl(bytes: ArrayBuffer | null): string | null`: makes the object URL from `new Blob([bytes], { type: 'image/jpeg' })` and revokes it on change and unmount.
  - `RecordCover({ record }: { record: ShelfRecord })`:
    - It renders `<Poster>` exactly as today when `coverPath` is null. It only mounts the photo part, which uses `useBackend`, when there's a path, so existing screen tests without a `BackendProvider` keep working.
    - While the front isn't on the phone, it shows the poster.

- [ ] **Step 1: Write the failing tests.**
  - `usePhoto.test.tsx`, using FakeBackend:
    - `downloads a photo it doesn't have and keeps it`: the hook returns a URL, and `db.photos.get(path)` is set afterwards.
    - `uses the phone's copy without downloading`: spy on `downloadPhoto`; it's not called.
    - `stays empty, quietly, when the photo isn't on the shelf yet`: the download returns null → the hook stays null and no error is thrown.
    - `stays empty when offline`.
    - `asks once even when two covers want the same photo`: two hooks mounted together → `downloadPhoto` is called once.
  - `RecordCover.test.tsx`:
    - `shows the poster when the record has no photos`.
    - `shows the front photo in place of the poster`: `img` with name `Front of {title}`.
    - `has no Flip without a back photo`.
    - `Flip shows the back, and again shows the front`: the button's aria-label goes "Show the back" → "Show the front". The hidden face has `aria-hidden="true"`.
    - `shows the poster while the front is still on its way`.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run src/data/usePhoto.test.tsx src/ui/RecordCover.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Frame:** a square (`aspect-square w-full`) with both faces stacked.
    - Front: `<img alt="Front of {title}" class="size-full object-cover">`. Back: `alt="Back of {title}"`.
    - The card uses `[transform-style:preserve-3d] transition-transform duration-500 motion-reduce:transition-none`, turned with `rotateY(180deg)` when flipped. Each face has `[backface-visibility:hidden]`, and the back face is pre-rotated 180°.
  - **Flip button:** under the frame, `variant="outline" h-12`, labelled `↻ Flip` with the aria-label above. It appears only when the back photo's URL is ready.

- [ ] **Step 4: Run all tests.** Run `npx vitest run && npx tsc -b`. Expected: all pass, including the existing `RecordScreen.test.tsx`.

- [ ] **Step 5: Commit.** `git commit -am "feat(ui): the Record screen shows your front photo, with Flip to the back"`

---

### Task 8: Taking photos: camera, tips, squaring and drafts

**Files:**
- Create: `src/data/photoDrafts.ts`, `src/ui/useCamera.tsx`, `src/ui/PhotoThumb.tsx`, `src/ui/PhotoTips.tsx`, `src/ui/PhotoCapture.tsx`
- Test: `src/data/photoDrafts.test.ts`, `src/ui/PhotoCapture.test.tsx`

**Interfaces:**
- Consumes: `squareUpPhoto` (Task 6), `db.photoDrafts`, `db.meta` and `useBytesUrl` (Task 7).
- Produces:
  - In `photoDrafts.ts`:
    - `useDrafts(): Drafts | undefined`;
    - `saveDraft(photo: DraftPhoto): Promise<void>`;
    - `dropDraft(side: PhotoSide): Promise<void>`;
    - `clearDrafts(): Promise<void>`;
    - `restoreDrafts(drafts: Drafts): Promise<void>`;
    - `usePhotoTipsSeen(): boolean | undefined` and `markPhotoTipsSeen(): Promise<void>`, using meta key `'photoTipsSeen'`.
  - `useCamera(onFile: (file: File) => void): { open(): void; input: ReactNode }`. The input is a hidden `<input type="file" accept="image/*" capture="environment">`. `open()` calls `input.click()` **synchronously**, so it must be called inside a tap handler. The value is reset after each change, so the same file can be picked again.
  - `PhotoThumb({ side, url, squaring, noEdges, children }: { side: PhotoSide; url: string | null; squaring: boolean; noEdges: boolean; children?: ReactNode })`: a 96 px square with an `img` (alt "Front photo" / "Back photo"), or the text "Squaring up…" (`role="status"`), with `children` (its buttons) below.
  - `PhotoTips({ open, onDone }: { open: boolean; onDone: () => void })`: a Radix `Dialog` with title **Tips for a sharp cover**, the four tips from spec §3.1 in order, and a 48 px **Got it** button that calls `onDone`.
  - `PhotoCapture()`: the Add screen's photo area. It takes no props and reads and writes drafts itself.

- [ ] **Step 1: Write the failing tests.** Use `vi.mock('@/photo/squareUp')` so that `squareUpPhoto` resolves `{ bytes: new Uint8Array([9]).buffer, foundEdges: true }`, and `false` in the "no edges" test. A user picks a file with `userEvent.upload(input, file)`, finding the input by `aria-label`: "Front photo file" / "Back photo file".
  - `photoDrafts.test.ts`: save, then `useDrafts` shows it; `restoreDrafts` writes several; `clearDrafts` empties them; tips are unseen at first and seen after `markPhotoTipsSeen`.
  - `PhotoCapture.test.tsx`:
    - **First time:** tapping **Take photos** shows **Tips for a sharp cover** first. **Got it** marks them seen and opens the camera for the front (spy on the front input's `click`).
    - **Later:** with tips seen, **Take photos** opens the front camera straight away.
    - **After the front:** its thumbnail appears, then the prompt **Now the back** with **Take the back** and **Skip the back**.
    - **Skip the back:** leaves the front thumbnail only.
    - **No edges found:** the thumbnail shows **Couldn’t find the edges** and a **Retake** button.
    - **Retake** opens the camera for that side and replaces its draft. **Remove** drops it.
    - **Survives an app reload:** unmount and mount a fresh `PhotoCapture`, and the drafts' thumbnails are still there.
    - The **Photo tips** link reopens the tips sheet.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run src/data/photoDrafts.test.ts src/ui/PhotoCapture.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement `PhotoCapture`'s flow.**
  - **Idle, no drafts:** a full-width primary **Take photos** button (`h-14`, display font like the form's Save), with a ghost **Photo tips** link (`h-12`) under it.
  - **Taking:** a camera file is squared with `squareUpPhoto`, with "Squaring up…" shown on that side's thumbnail while it runs, then `saveDraft`.
  - **After the front:** iPhone only opens the camera from a tap, so the back can't open by itself. Show **Now the back** with **Take the back** (primary) and **Skip the back** (ghost).
  - **Thumbnails** go in a row: front, then back. Each has **Retake** and **Remove** (`h-12`), and a front with `foundEdges: false` shows the edge note.
  - **Tips:** the seen flag is read before any tap via `usePhotoTipsSeen`, so the tap can open the camera synchronously.
  - **Errors:** a squaring failure shows `Couldn’t prepare that photo. Try again.` (`role="alert"`) and stores nothing.

- [ ] **Step 4: Run all tests.** Run `npx vitest run && npx tsc -b`. Expected: all pass.

- [ ] **Step 5: Commit.** `git commit -am "feat(ui): take front and back photos with first-time tips, kept as drafts"`

---

### Task 9: Add screen: photos go with the record you save

**Files:**
- Create: `src/ui/useSavedOffer.ts`, `src/ui/PhotoDuplicateDialog.tsx`
- Modify: `src/ui/FindRecord.tsx`, `src/screens/AddScreen.tsx`
- Test: `src/ui/FindRecord.test.tsx`, `src/screens/AddScreen.test.tsx`, `src/ui/PhotoDuplicateDialog.test.tsx`

**Interfaces:**
- Consumes: `addFound`, `addRecord`, `addPhotosTo`, `hasDrafts`, `findDuplicate`, `useDrafts`, `clearDrafts`, `restoreDrafts`, `perform(…, photos)` and `PhotoCapture`.
- Produces:
  - `type SavedOffer = { text: string; undo: NewPostcard[]; drafts: Drafts | null; later: NewPostcard[] }`.
  - `useSavedOffer({ onUndone }: { onUndone: (drafts: Drafts | null) => void }): { saved: SavedOffer | null; error: string | null; offer(s: SavedOffer): void; undo(): Promise<void> }`. This moves FindRecord's existing inline confirmation logic (timer `UNDO_WINDOW_MS`, double-tap guard, error) into a hook, and adds two things:
    - when an offer ends **without** Undo (timer, replaced by a newer offer, or unmount), its `later` postcards are performed;
    - after a successful Undo, `onUndone(drafts)` is called.
  - `FindRecord` gets a new optional prop, `photos?: { drafts: Drafts; onUsed: () => void; onBack: (drafts: Drafts | null) => void }`.
  - `PhotoDuplicateDialog({ open, replacing, onAdd, onCopy, onClose }: { open: boolean; replacing: boolean; onAdd: () => void; onCopy: () => void; onClose: () => void })`:
    - message **Add these photos to the one on your shelf?**, with buttons **Add to that one** and **Save a second copy**;
    - when `replacing`, the message is **Replace the photos on the one on your shelf?** and the first button reads **Replace them**;
    - Escape or outside → `onClose`, which saves nothing.
    - A new component, not `ConfirmDialog`: that one turns Escape into its cancel action.

- [ ] **Step 1: Write the failing tests.** Wrap renders in `BackendProvider` with FakeBackend, as `FindRecord.test.tsx` does.
  - `FindRecord.test.tsx`, with `photos` drafts for both sides:
    - **Saving with photos:** tapping a card that isn't on the shelf saves the record, and `db.photos` holds two paths under the new record. The record's `coverPath` and `backPath` are set to them. `onUsed` is called, and the confirmation reads `On the shelf: {title}`.
    - **Undo:** after a save with photos, the record is deleted, `onBack` is called with the same drafts, and the outbox has a `photo.delete` for each new path.
    - **Double tap:** with photos waiting → one record and two `photo.upload` postcards.
    - **Duplicate with photos:** the dialog asks **Add these photos to the one on your shelf?**.
      - **Add to that one:** no new record; the existing one has the new paths; the confirmation reads `Photos added: {title}`.
      - **Save a second copy:** a second record with the photos.
      - **Escape:** nothing saved; drafts untouched (`onUsed` not called).
    - **Replace:** the duplicate already has a front → the dialog reads **Replace the photos on the one on your shelf?**. After **Replace them**, the old front's `photo.delete` is queued only after `UNDO_WINDOW_MS` (fake timers), and never if Undo was tapped.
    - **No photos waiting:** a duplicate card saves a second copy with no dialog, as today.
    - All existing FindRecord tests still pass unchanged.
  - `AddScreen.test.tsx`:
    - **Layout:** the **Take photos** button comes before **Find a record** in document order.
    - **Hand form:** with drafts, saving by hand puts the photos on the new record and clears the drafts.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run src/ui/FindRecord.test.tsx src/screens/AddScreen.test.tsx src/ui/PhotoDuplicateDialog.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Context:** `photoId: () => crypto.randomUUID()` is added to the action context.
  - **A new record with photos:** the target is the `record.create`'s `fields`.
    - postcards: `[...addFound(...).postcards, ...plan.postcards]`;
    - undo: `[...addFound undo, ...plan.undo]`;
    - `later` is empty; `drafts` are the drafts used; text `On the shelf: {title}`.
  - **Add to that one:** `addPhotosTo(existing, drafts)`, with offer `{ text: 'Photos added: {existing.title}', undo: plan.undo, drafts, later: plan.later }`.
  - **After a save with photos:** call `photos.onUsed()`.
  - **AddScreen:**
    - renders `<PhotoCapture />` between the title and `<FindRecord>`;
    - passes `photos={hasDrafts(drafts) ? { drafts, onUsed: clearDrafts, onBack: (d) => d && restoreDrafts(d) } : undefined}`;
    - in `onSave`, when drafts exist, appends `addPhotosTo(newRecord, drafts)` to the create and calls `clearDrafts()` after `perform`.
  - **Our call, mark it in a code comment:** the hand form's own duplicate warning stays as it is. Photos saved through the hand form go on the record being saved there.

- [ ] **Step 4: Run all tests.** Run `npx vitest run && npx tsc -b`. Expected: all pass.

- [ ] **Step 5: Commit.** `git commit -am "feat(add): photos go with the record you save, with Undo and the duplicate question"`

---

### Task 10: Edit screen: add, retake and remove photos

**Files:**
- Create: `src/ui/EditPhotos.tsx`
- Modify: `src/screens/EditScreen.tsx`
- Test: `src/ui/EditPhotos.test.tsx`, `src/screens/EditScreen.test.tsx`

**Interfaces:**
- Consumes: `editPhotos`, `PhotoChanges`, `usePhotoUrl`, `useBytesUrl`, `useCamera`, `PhotoThumb`, `squareUpPhoto`, `usePhotoTipsSeen` / `PhotoTips`, `useUnsavedMark`, and the `extra` parameter of `editRecord` / `restoreWithEdits`.
- Produces: `EditPhotos({ record, changes, onChange }: { record: ShelfRecord; changes: PhotoChanges; onChange: (next: PhotoChanges) => void })`. It's a **Photos** section with a front and a back slot.
  - Each slot shows the pending new photo, else the stored one, else an empty frame.
  - Each slot has **Take** (no photo) or **Retake** (has one), plus **Remove** when there's a photo to remove. All are `h-12`.
  - It uses the same first-time tips rule as Add.

- [ ] **Step 1: Write the failing tests.** Use `vi.mock('@/photo/squareUp')` as in Task 8.
  - `EditPhotos.test.tsx`:
    - **Empty slots:** a record with no photos shows **Take** for both.
    - **Retake:** a new front calls `onChange({ front: { kind: 'new', … } })`.
    - **Remove** on a stored back calls `onChange({ back: { kind: 'remove' } })`, and the slot then shows empty, with **Take**.
  - `EditScreen.test.tsx`:
    - **Save with photos:** saving after a new front, with no field change, queues `photo.upload` then `record.patch { coverPath }`, and the record shows the new path.
    - **Retake with field changes:** retaking the back while changing the year sends one patch `{ year, backPath }`, then `photo.delete` of the old back.
    - **Unsaved changes:** a photo change alone makes leaving ask about unsaved changes, and marks `body[data-unsaved]`.
    - **Restoring:** "Restore with your changes" on a record deleted elsewhere includes the photo fields in its patch.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run src/ui/EditPhotos.test.tsx src/screens/EditScreen.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Layout:** `EditScreen` holds `photoChanges` state and renders `<EditPhotos>` above `<RecordForm>`.
  - **Unsaved:** dirty is `formDirty || Object.keys(photoChanges).length > 0`, and `useUnsavedMark(photosDirty)` is added.
  - **`onSave`:**
    - `const ph = editPhotos(record, photoChanges, { ...ctx, photoId: () => crypto.randomUUID() })`;
    - the patch from `editRecord` / `restoreWithEdits` gets `ph.fields` as `extra`;
    - `perform(db, [...ph.uploads, ...patch, ...ph.deletes], runNow, ph.photos)`.
  - **Our call, mark it in a code comment:** Edit's photo changes live only in memory. If iOS reloads during the camera, they're lost, along with any typed changes, as today.

- [ ] **Step 4: Run all tests.** Run `npx vitest run && npx tsc -b && npm run build`. Expected: all pass, and the build succeeds.

- [ ] **Step 5: Commit.** `git commit -am "feat(edit): add, retake and remove a record's photos"`

---

### Task 11: Check on Kahrman's phone, then go live

This task is run by the controller with Kahrman, not by an implementer subagent. Every step marked **(OK)** needs his explicit yes for that step.

- [ ] **Step 1: Ready check.** Run `npx vitest run && npx tsc -b && npm run build`. Expected: all green.
- [ ] **Step 2: Production read (no change).** Run `select count(*) from public.records where cover_path is not null` and expect `0`, so the new shape constraint can't fail on existing rows. Also confirm with the Supabase dashboard or `storage.buckets` that no `covers` bucket exists yet.
- [ ] **Step 3 (OK): Apply the migration to production.** `npx supabase db push --remote --yes`. Then re-run the policy checks by reading `pg_policies` for `storage.objects`; expect the 4 new policies.
- [ ] **Step 4 (OK): Phone test before merge.** The test needs https, because `crypto.randomUUID` requires a secure page, so a plain local-network address won't work.
  - Push `plan-4b-photos` for a Vercel preview, first checking that the Preview environment has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
  - On Kahrman's phone, open the preview, sign in, and on Add take photos of real sleeves:
    - a light sleeve on a dark surface, and a dark sleeve on a light one;
    - one shot at a slight angle;
    - one with glare.
  - Check that the crops are clean and squared, that the Record screen flips, that it works in airplane mode and uploads afterwards, and that Megan's phone sees the photos.
  - Note how often the squaring missed. If it's often, raise approach A (a corner check) with Kahrman before merging.
- [ ] **Step 5 (OK): Merge to `main`**, which deploys. Confirm the live bundle changed and the app updates on the phone.
- [ ] **Step 6: Handoff.** Update `docs/superpowers/notes/plan-2-handoff.md` with:
  - the photo storage layout;
  - the OpenCV caching rule;
  - the iOS camera-tap rule (no automatic second camera);
  - any squaring misses seen in Step 4;
  - what 4b-2 (recognition) needs: an Anthropic Console account with a spending cap, and the `ANTHROPIC_API_KEY` secret set in the dashboard.

  Then commit.
