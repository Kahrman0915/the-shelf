import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { PHOTO_SIDES, type DraftPhoto, type Drafts, type PhotoSide } from './photos';

const TIPS_KEY = 'photoTipsSeen';

/** The photos taken for the next record, kept on the phone so a reload doesn’t lose them. Undefined while reading. */
export function useDrafts(): Drafts | undefined {
  return useLiveQuery(async () => {
    const out: Drafts = {};
    for (const photo of await db.photoDrafts.toArray()) out[photo.side] = photo;
    return out;
  }, []);
}

export async function saveDraft(photo: DraftPhoto): Promise<void> {
  await db.photoDrafts.put(photo);
}

export async function dropDraft(side: PhotoSide): Promise<void> {
  await db.photoDrafts.delete(side);
}

export async function clearDrafts(): Promise<void> {
  await db.photoDrafts.clear();
}

/** Put these drafts back (undo of an add), replacing whatever is there. */
export async function restoreDrafts(drafts: Drafts): Promise<void> {
  await db.transaction('rw', db.photoDrafts, async () => {
    for (const side of PHOTO_SIDES) {
      const photo = drafts[side];
      if (photo) await db.photoDrafts.put(photo);
    }
  });
}

/** Whether this phone has seen the photo tips. Undefined while reading. */
export function usePhotoTipsSeen(): boolean | undefined {
  return useLiveQuery(async () => (await db.meta.get(TIPS_KEY)) !== undefined, []);
}

export async function markPhotoTipsSeen(): Promise<void> {
  await db.meta.put({ key: TIPS_KEY, value: '1' });
}
