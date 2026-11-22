# Plan 4b: Add a record from photos (design)

Date: 2026-11-22
Status: approved in conversation, awaiting written review
Builds on: `2026-11-12-plan-4a-build-2a-discogs-lookup-design.md` (Find a record is live), `2026-11-12-plan-4a-add-edit-delete-design.md` (Add/Edit/Record screens), the original spec's §9 "Photos" (`2026-09-18-the-shelf-design.md`).

## 1. Intent

Kahrman's words: *"Take a picture of the record we have and then the app finds it and adds it and saves the image all at the same time. This would make for really easy adds and save the photo all at the same time."*

He wants adding a record to be as close to effortless as possible during a big catch-up, and every record to end up with **its own photos**. The photos are of the front and back of the sleeve.

**Success:**
- Pick up a sleeve, photograph the front and the back, and the record is on the shelf with both photos, usually without typing anything.
- Every record can show its real cover, with the back one tap away.

**Anti-goals:**
- Typing becoming the normal path again.
- Photos that only exist on one phone.
- Photos visible to anyone outside the shelf.
- A slow or failed upload losing a photo.

## 2. Decisions (from the conversation)

| # | Decision | Choice |
|---|---|---|
| 1 | Photos per record | **Front and back** |
| 2 | Record page | Shows the **front**; a **Flip** button turns it over to show the **back** |
| 3 | Recognition approach | **A: Claude reads both photos** (front → artist and title; back → barcode and catalog number), then Discogs searches by barcode, then catalog number, then name. Chosen over a phone barcode scanner (no built-in reader on iPhone; old records have no barcode) and barcode-only (barcodes only appear from about the 1980s, so most of the jazz originals have none) |
| 4 | Order | **Two builds:** 4b-1 Photos first (take, store, flip, edit), then 4b-2 Recognition |
| 5 | Exact match | *Proposed, accepted:* if the back pins **one** pressing, it's saved straight away with the inline "On the shelf: … · Undo"; if several, the pressing cards to tap |
| 6 | Not recognised | *Proposed, accepted:* the search box fills in with whatever Claude read, for a quick correction |
| 7 | Size | *Proposed, accepted:* photos are shrunk on the phone before upload |
| 8 | Records without photos | *Proposed, accepted:* keep the generative poster; Flip only appears when there's a back photo |
| 9 | Existing records | *Proposed, accepted:* Edit gets **Add photos**, so records already on the shelf can get theirs |
| 10 | Offline | *Proposed, accepted:* photos save on the phone and upload later through the outbox; recognition needs signal |

## 3. Build 4b-1: Photos

### 3.1 What you see

**Add screen.** A new **Take photos** button is the first thing on the screen, above *Find a record*.
- Tapping it opens the phone's camera for **Front**. After the shot, the camera opens again for **Back**.
- Each step can be retaken or skipped. Skipping the back is allowed.
- Small front and back thumbnails then show above the Find box.
- In 4b-1 you still search and tap a card, or fill the form by hand. **Whichever record you save next takes those photos with it.**
- After a save, the thumbnails clear for the next record.
- 4b-2 later replaces "search yourself" with recognition, and the screen stays the same.

**Record screen.** Your **front photo replaces the poster** at the same size and place.
- A **Flip** button under it turns the image over to the back, with a flip animation. Under reduced-motion it simply swaps. Tapping again turns it back.
- No back photo → no Flip button. No photos → the poster, as today.

**Edit screen.** A **Photos** section shows the front and back slots as thumbnails, each with **Take** / **Retake** and **Remove**. Saving Edit saves photo changes along with any field changes.

### 3.2 Rules
- **Shrinking:** each photo is shrunk on the phone to at most **1600 px** on its long edge, as JPEG at about 0.8 quality, before it's stored or uploaded. That's roughly 200–400 KB. Text on the back (catalog numbers) must stay readable for 4b-2, which is why it's 1600 px rather than the original spec's 1200.
- **Shape:** the photo is kept **as taken**; it isn't cropped. It's displayed filling a square frame (`object-fit: cover`), so a slightly off-centre shot still looks right. *Builder's call to revisit after real use.*
- **Privacy:** stored in a **private** Supabase Storage bucket `covers`, at `covers/{shelf_id}/{record_id}/front.jpg` and `…/back.jpg`. Only members of that shelf can read, write or delete objects under their shelf's folder. Megan sees Kahrman's photos and vice versa.
- **Records point to photos:** `records.cover_path`, which already exists, holds the front's storage path. A new column `records.back_path` holds the back's. A null path means no photo.
- **Offline-safe:** taking a photo saves the shrunk image **on the phone** at once, in the notebook, and queues an upload in the outbox. The record shows the photo immediately from the phone's copy. When there's signal, the courier uploads the image, *then* patches the record's path. A record's create always goes before its photo upload.
- **Viewing on the other phone:** photos are downloaded when the Record screen is opened, and **kept on the phone** so they still show offline afterwards.
- **Remove:** clears the record's path. The stored image is deleted from Storage by the courier. A failed delete is not an error the person needs to see.
- **Undo after Add:** soft-deletes the record as now. The uploaded photos may stay in Storage. *Builder's call whether to delete them too.*

### 3.3 Data
- **Migration:**
  - add `back_path text` (nullable) to `records`, with an update grant;
  - create the private bucket `covers`;
  - Storage RLS on `storage.objects` for bucket `covers`: select, insert, update and delete allowed when the first folder of the object name is a shelf the user is a member of (reuse `public.is_member`).
- **App schema:** `backPath` joins `RecordSchema`, the row mapping and `EDITABLE_FIELDS`. `coverPath` is already there.
- **Dexie version bump, with an upgrade that fills `backPath: null` on existing records and queued creates** (the build 1 lesson):
  - a `photos` table, keyed by storage path, holding the image Blob, a `pending` flag, and when it was last used;
  - outbox postcard kinds `photo.upload { path, side }` and `photo.delete { path }`.
- **Phone storage:** downloaded photos are kept, with no limit for now. Two people and a few hundred records is a few hundred MB at most. *Revisit if it grows.*

### 3.4 Not in 4b-1
- Recognition (4b-2).
- Photos in Bought it at the show.
- Photos on shelf rows or the pile.
- Cropping or rotating tools.
- More than two photos.

## 4. Build 4b-2: Recognition (outline; detailed in its own spec)

- A new Edge Function `identify-record` takes the two shrunk photos.
- **Claude Haiku 5.5**, with structured output, returns `{ artist, title, barcode, catalog }`.
- The function then searches Discogs: barcode first (`barcode=`), then catalog number (`catno=`), then name (`q=`).
- It returns the same `FoundRecord` cards as `discogs-search`. One exact barcode or catalog match → the app saves straight away. Several → cards. None → the Find box filled with what Claude read.
- It checks the caller is signed in, as `discogs-search` does.
- **Needs:** an Anthropic Console account with a monthly spending cap and an API key, stored the way the Discogs token was (the Supabase dashboard).
- **Cost:** a fraction of a cent per record, to be measured on ten real records before switch-on.

## 5. Constraints

- Everything from Plans 3 and 4a holds:
  - Backend is the only path to the server;
  - writes go through the outbox;
  - migrations go live before the app;
  - fail loudly;
  - 48 px tap targets;
  - plain-words messages;
  - secrets set via the Supabase dashboard, never pasted into Terminal.
- **iPhone camera:** use the standard file input with `capture="environment"`, so it opens the native camera. iPhone photos may arrive as HEIC; the shrinking step must produce JPEG.
- **Storage:** IndexedDB holding Blobs must work in iOS Safari home-screen apps. It does on current iOS, but test on Kahrman's phone.

## 6. Left to the builder
- The exact layout of the Take photos step and the thumbnails.
- The flip animation.
- Whether Undo also deletes uploaded photos.
- The upload retry policy within the existing courier rules.
- How photos are downloaded (signed URL vs. authenticated download).
- Messages for a failed upload, in the existing header-notice style.
