import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { clearDrafts, dropDraft, markPhotoTipsSeen, restoreDrafts, saveDraft, useDrafts, usePhotoTipsSeen } from './photoDrafts';

const bytes = () => new Uint8Array([1]).buffer;

afterEach(async () => {
  await db.photoDrafts.clear();
  await db.meta.delete('photoTipsSeen');
});

describe('photo drafts', () => {
  it('shows a saved draft', async () => {
    const { result } = renderHook(() => useDrafts());
    await waitFor(() => expect(result.current).toEqual({}));
    await saveDraft({ side: 'front', bytes: bytes(), foundEdges: true });
    await waitFor(() => expect(result.current?.front?.foundEdges).toBe(true));
  });

  it('drops one side', async () => {
    await restoreDrafts({ front: { side: 'front', bytes: bytes(), foundEdges: true }, back: { side: 'back', bytes: bytes(), foundEdges: true } });
    await dropDraft('front');
    expect(await db.photoDrafts.count()).toBe(1);
  });

  it('restores several and clears them', async () => {
    await restoreDrafts({ front: { side: 'front', bytes: bytes(), foundEdges: true }, back: { side: 'back', bytes: bytes(), foundEdges: false } });
    const { result } = renderHook(() => useDrafts());
    await waitFor(() => expect(Object.keys(result.current ?? {}).sort()).toEqual(['back', 'front']));
    await clearDrafts();
    await waitFor(() => expect(result.current).toEqual({}));
  });

  it('starts with the tips unseen, then seen', async () => {
    const { result } = renderHook(() => usePhotoTipsSeen());
    await waitFor(() => expect(result.current).toBe(false));
    await markPhotoTipsSeen();
    await waitFor(() => expect(result.current).toBe(true));
  });
});
