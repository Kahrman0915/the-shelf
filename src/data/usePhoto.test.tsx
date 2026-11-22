import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { FakeBackend } from '@/test/fakeBackend';
import { db } from './db';
import { useBytesUrl, usePhotoUrl } from './usePhoto';

const PATH = 'shelf/record/front-abc.jpg';
const bytes = () => new Uint8Array([1, 2, 3]).buffer;

let backend: FakeBackend;
const wrapper = ({ children }: { children: ReactNode }) => <BackendProvider backend={backend}>{children}</BackendProvider>;

beforeEach(() => {
  backend = new FakeBackend({});
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(async () => {
  await db.photos.clear();
});

describe('usePhotoUrl', () => {
  it('downloads a photo it doesn’t have and keeps it', async () => {
    backend.photos.set(PATH, bytes());
    const { result } = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(result.current).toMatch(/^blob:/));
    expect(await db.photos.get(PATH)).toBeDefined();
  });

  it('uses the phone’s copy without downloading', async () => {
    await db.photos.put({ path: PATH, bytes: bytes() });
    const spy = vi.spyOn(backend, 'downloadPhoto');
    const { result } = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(result.current).toMatch(/^blob:/));
    expect(spy).not.toHaveBeenCalled();
  });

  it('stays empty, quietly, when the photo isn’t on the shelf yet', async () => {
    const spy = vi.spyOn(backend, 'downloadPhoto');
    const { result } = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await spy.mock.results[0].value;
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
    expect(await db.photos.get(PATH)).toBeUndefined();
  });

  it('stays empty when offline', async () => {
    backend.photos.set(PATH, bytes());
    backend.online = false;
    const spy = vi.spyOn(backend, 'downloadPhoto');
    const { result } = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await spy.mock.results[0].value.catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });

  it('asks once even when two covers want the same photo', async () => {
    backend.photos.set(PATH, bytes());
    const spy = vi.spyOn(backend, 'downloadPhoto');
    const { result } = renderHook(() => [usePhotoUrl(PATH), usePhotoUrl(PATH)], { wrapper });
    await waitFor(() => expect(result.current[0]).toMatch(/^blob:/));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('tries again on a fresh mount after a null answer', async () => {
    const spy = vi.spyOn(backend, 'downloadPhoto');
    const first = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await spy.mock.results[0].value;
    await new Promise((r) => setTimeout(r, 0));
    first.unmount();
    renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it('tries again on a fresh mount after an error', async () => {
    backend.online = false;
    const spy = vi.spyOn(backend, 'downloadPhoto');
    const first = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await spy.mock.results[0].value.catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    first.unmount();
    backend.online = true;
    backend.photos.set(PATH, bytes());
    const second = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(second.result.current).toMatch(/^blob:/));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not start a second download for a cover mounted while the first is in flight', async () => {
    let finish!: (b: ArrayBuffer) => void;
    const spy = vi.spyOn(backend, 'downloadPhoto').mockImplementation(() => new Promise((r) => (finish = r)));
    const first = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const second = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalledTimes(1);
    finish(bytes());
    await waitFor(() => expect(first.result.current).toMatch(/^blob:/));
    await waitFor(() => expect(second.result.current).toMatch(/^blob:/));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('lets go of the object URL when the cover goes away', async () => {
    await db.photos.put({ path: PATH, bytes: bytes() });
    const { result, unmount } = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(result.current).toMatch(/^blob:/));
    const shown = result.current;
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(shown);
  });
});

describe('useBytesUrl', () => {
  it('revokes the old URL when the bytes change', () => {
    const { result, rerender } = renderHook(({ b }) => useBytesUrl(b), { initialProps: { b: bytes() } });
    const before = result.current;
    expect(before).toMatch(/^blob:/);
    rerender({ b: new Uint8Array([9]).buffer });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(before);
    expect(result.current).not.toBe(before);
  });
});
