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
