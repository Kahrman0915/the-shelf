import { describe, expect, it } from 'vitest';
import type { Ctx } from './actions';
import { addPhotosTo, editPhotos, hasDrafts, photoPath, type PhotoCtx } from './photos';
import type { ShelfRecord } from './schema';

const SHELF = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const R = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-11-11T10:00:00.000Z';
const base = { shelfId: SHELF, recordId: R, userId: ME, createdAt: NOW };
const bytes = (n: number) => new Uint8Array([n]).buffer;

function ctxWith(...ids: string[]): PhotoCtx {
  const c: Ctx = { me: ME, now: NOW };
  return { ...c, photoId: () => ids.shift()! };
}
const rec = (over: Partial<ShelfRecord> = {}) => ({ id: R, shelfId: SHELF, coverPath: null, backPath: null, ...over }) as ShelfRecord;
const path = (side: 'front' | 'back', id: string) => `${SHELF}/${R}/${side}-${id}.jpg`;
const up = (p: string) => ({ ...base, kind: 'photo.upload', fields: { path: p } });
const del = (p: string) => ({ ...base, kind: 'photo.delete', fields: { path: p } });
const patch = (fields: object) => ({ ...base, kind: 'record.patch', fields });

describe('photoPath', () => {
  it('is shelf/record/side-photo.jpg', () => {
    expect(photoPath(SHELF, R, 'front', 'P')).toBe(`${SHELF}/${R}/front-P.jpg`);
  });
});

describe('editPhotos', () => {
  it('adds a new front to a record with none', () => {
    const out = editPhotos(rec(), { front: { kind: 'new', photo: { side: 'front', bytes: bytes(1), foundEdges: true } } }, ctxWith('a'));
    expect(out.uploads).toEqual([up(path('front', 'a'))]);
    expect(out.fields).toEqual({ coverPath: path('front', 'a') });
    expect(out.deletes).toEqual([]);
    expect(out.photos).toEqual([{ path: path('front', 'a'), bytes: bytes(1) }]);
  });

  it('retaking the back deletes the old one', () => {
    const OLD = path('back', 'old');
    const out = editPhotos(rec({ backPath: OLD }), { back: { kind: 'new', photo: { side: 'back', bytes: bytes(2), foundEdges: false } } }, ctxWith('n'));
    expect(out.fields).toEqual({ backPath: path('back', 'n') });
    expect(out.deletes).toEqual([del(OLD)]);
  });

  it('removing the front clears it and deletes the file', () => {
    const OLD = path('front', 'old');
    const out = editPhotos(rec({ coverPath: OLD }), { front: { kind: 'remove' } }, ctxWith());
    expect(out.fields).toEqual({ coverPath: null });
    expect(out.deletes).toEqual([del(OLD)]);
    expect(out.uploads).toEqual([]);
    expect(out.photos).toEqual([]);
  });

  it('removing a side with no photo does nothing', () => {
    expect(editPhotos(rec(), { back: { kind: 'remove' } }, ctxWith())).toEqual({ uploads: [], fields: {}, deletes: [], photos: [] });
  });

  it('uploads front then back', () => {
    const out = editPhotos(
      rec(),
      {
        back: { kind: 'new', photo: { side: 'back', bytes: bytes(2), foundEdges: true } },
        front: { kind: 'new', photo: { side: 'front', bytes: bytes(1), foundEdges: true } },
      },
      ctxWith('f', 'b'),
    );
    expect(out.uploads).toEqual([up(path('front', 'f')), up(path('back', 'b'))]);
  });
});

describe('addPhotosTo', () => {
  it('plans both drafts for a new record', () => {
    const plan = addPhotosTo(
      rec(),
      { front: { side: 'front', bytes: bytes(1), foundEdges: true }, back: { side: 'back', bytes: bytes(2), foundEdges: true } },
      ctxWith('f', 'b'),
    );
    const f = path('front', 'f');
    const b = path('back', 'b');
    expect(plan.postcards).toEqual([up(f), up(b), patch({ coverPath: f, backPath: b })]);
    expect(plan.undo).toEqual([patch({ coverPath: null, backPath: null }), del(f), del(b)]);
    expect(plan.later).toEqual([]);
    expect(plan.photos).toHaveLength(2);
  });

  it('replaces an existing front, keeping the old file until later', () => {
    const OLD = path('front', 'old');
    const n = path('front', 'n');
    const plan = addPhotosTo(rec({ coverPath: OLD }), { front: { side: 'front', bytes: bytes(1), foundEdges: false } }, ctxWith('n'));
    expect(plan.postcards).toEqual([up(n), patch({ coverPath: n })]);
    expect(plan.undo).toEqual([patch({ coverPath: OLD }), del(n)]);
    expect(plan.later).toEqual([del(OLD)]);
  });

  it('plans nothing for empty drafts', () => {
    expect(addPhotosTo(rec(), {}, ctxWith())).toEqual({ postcards: [], photos: [], undo: [], later: [] });
  });
});

describe('hasDrafts', () => {
  it('is true when either side has a draft', () => {
    expect(hasDrafts({})).toBe(false);
    expect(hasDrafts({ back: { side: 'back', bytes: bytes(1), foundEdges: true } })).toBe(true);
  });
});
