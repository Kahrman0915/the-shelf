import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useBackend } from '@/app/BackendContext';
import { db } from './db';

/** Downloads in flight, so two covers wanting the same photo ask once. */
const downloading = new Map<string, Promise<void>>();

/** An object URL for these bytes, revoked when they change or the screen goes away. */
export function useBytesUrl(bytes: ArrayBuffer | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [bytes]);
  return bytes ? url : null;
}

/** The photo at this storage path as an object URL; null while it isn't on the phone. Fetches and keeps it when missing. */
export function usePhotoUrl(path: string | null): string | null {
  const backend = useBackend();
  // undefined while reading, null when the phone doesn't have it.
  const stored = useLiveQuery(() => (path ? db.photos.get(path).then((p) => p ?? null) : null), [path]);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!path || stored !== null || asked.current === path) return;
    asked.current = path;
    let job = downloading.get(path);
    if (!job) {
      job = (async () => {
        try {
          const bytes = await backend.downloadPhoto(path);
          if (bytes) await db.photos.put({ path, bytes });
        } catch {
          // Not uploaded yet, or no signal: stay quiet, the next mount tries again.
        } finally {
          downloading.delete(path);
        }
      })();
      downloading.set(path, job);
    }
  }, [backend, path, stored]);

  return useBytesUrl(stored?.bytes ?? null);
}
