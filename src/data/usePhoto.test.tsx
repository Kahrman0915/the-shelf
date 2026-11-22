import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { FakeBackend } from '@/test/fakeBackend';
import { db } from './db';
import { usePhotoUrl } from './usePhoto';

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
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBeNull();
    expect(await db.photos.get(PATH)).toBeUndefined();
  });

  it('stays empty when offline', async () => {
    backend.photos.set(PATH, bytes());
    backend.online = false;
    const spy = vi.spyOn(backend, 'downloadPhoto');
    const { result } = renderHook(() => usePhotoUrl(PATH), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBeNull();
  });

  it('asks once even when two covers want the same photo', async () => {
    backend.photos.set(PATH, bytes());
    const spy = vi.spyOn(backend, 'downloadPhoto');
    const { result } = renderHook(() => [usePhotoUrl(PATH), usePhotoUrl(PATH)], { wrapper });
    await waitFor(() => expect(result.current[0]).toMatch(/^blob:/));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
