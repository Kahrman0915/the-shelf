import type { Ctx } from './actions';
import type { NewPostcard } from './outbox';
import type { ShelfRecord } from './schema';

/** Which face of the sleeve a photo shows. */
export type PhotoSide = 'front' | 'back';
export const PHOTO_SIDES: readonly PhotoSide[] = ['front', 'back'];

/** A photo waiting on this phone to be sent (or kept for showing offline), keyed by its storage path. */
export type StoredPhoto = { path: string; bytes: ArrayBuffer };

/** A photo taken in the add or edit form, not yet saved with the record. */
export type DraftPhoto = { side: PhotoSide; bytes: ArrayBuffer; foundEdges: boolean };
export type Drafts = Partial<Record<PhotoSide, DraftPhoto>>;

/** The record field that holds each side’s storage path. */
export const PATH_FIELD: Record<PhotoSide, 'coverPath' | 'backPath'> = { front: 'coverPath', back: 'backPath' };

/** Where a photo lives in the bucket: {shelfId}/{recordId}/{side}-{photoId}.jpg. */
export function photoPath(shelfId: string, recordId: string, side: PhotoSide, photoId: string): string {
  return `${shelfId}/${recordId}/${side}-${photoId}.jpg`;
}

export type PhotoChange = { kind: 'new'; photo: DraftPhoto } | { kind: 'remove' };
export type PhotoChanges = Partial<Record<PhotoSide, PhotoChange>>;
/** Actions never make ids, so the caller supplies a fresh photo id per call. */
export type PhotoCtx = Ctx & { photoId: () => string };

function card(r: ShelfRecord, ctx: Ctx, kind: 'photo.upload' | 'photo.delete', path: string): NewPostcard {
  return { kind, shelfId: r.shelfId, recordId: r.id, userId: ctx.me, createdAt: ctx.now, fields: { path } };
}

function patchCard(r: ShelfRecord, ctx: Ctx, fields: Partial<ShelfRecord>): NewPostcard {
  return { kind: 'record.patch', shelfId: r.shelfId, recordId: r.id, userId: ctx.me, createdAt: ctx.now, fields };
}

/** Turn "new photo / remove photo" per side into uploads, the record fields to patch, deletes of replaced files, and the bytes to keep. */
export function editPhotos(
  record: ShelfRecord,
  changes: PhotoChanges,
  ctx: PhotoCtx,
): { uploads: NewPostcard[]; fields: Partial<ShelfRecord>; deletes: NewPostcard[]; photos: StoredPhoto[] } {
  const uploads: NewPostcard[] = [];
  const deletes: NewPostcard[] = [];
  const photos: StoredPhoto[] = [];
  const fields: Partial<ShelfRecord> = {};
  for (const side of PHOTO_SIDES) {
    const change = changes[side];
    if (!change) continue;
    const field = PATH_FIELD[side];
    const old = record[field];
    if (change.kind === 'new') {
      const path = photoPath(record.shelfId, record.id, side, ctx.photoId());
      uploads.push(card(record, ctx, 'photo.upload', path));
      photos.push({ path, bytes: change.photo.bytes });
      fields[field] = path;
    } else if (old) {
      fields[field] = null;
    }
    if (old) deletes.push(card(record, ctx, 'photo.delete', old));
  }
  return { uploads, fields, deletes, photos };
}

export type PhotoPlan = {
  /** Upload each new photo, then point the record at them. */
  postcards: NewPostcard[];
  photos: StoredPhoto[];
  /** Point the record back and delete the new files. */
  undo: NewPostcard[];
  /** Delete files this replaced; sent once the undo window has passed. */
  later: NewPostcard[];
};

/** Plan saving the photos taken in the add form onto a record (new or existing). */
export function addPhotosTo(target: ShelfRecord, drafts: Drafts, ctx: PhotoCtx): PhotoPlan {
  const changes: PhotoChanges = {};
  for (const side of PHOTO_SIDES) {
    const photo = drafts[side];
    if (photo) changes[side] = { kind: 'new', photo };
  }
  const { uploads, fields, deletes, photos } = editPhotos(target, changes, ctx);
  if (uploads.length === 0) return { postcards: [], photos: [], undo: [], later: [] };
  const old: Partial<ShelfRecord> = {};
  for (const key of Object.keys(fields) as (keyof typeof fields & ('coverPath' | 'backPath'))[]) old[key] = target[key];
  const newPaths = photos.map((p) => p.path);
  return {
    postcards: [...uploads, patchCard(target, ctx, fields)],
    photos,
    undo: [patchCard(target, ctx, old), ...newPaths.map((p) => card(target, ctx, 'photo.delete', p))],
    later: deletes,
  };
}

export function hasDrafts(drafts: Drafts): boolean {
  return PHOTO_SIDES.some((side) => drafts[side] !== undefined);
}
