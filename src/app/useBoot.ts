import { useEffect, useState } from 'react';
import collection from '../../collection.json';
import { db } from '@/data/db';
import { ImportError } from '@/data/importCollection';
import { seedIfEmpty } from '@/data/seed';
import { LOCAL_SHELF_ID, LOCAL_USER_ID } from '@/data/session';

type Boot = { state: 'loading' } | { state: 'ready' } | { state: 'error'; problems: string[] };

export function useBoot(): Boot {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    seedIfEmpty(db, collection, { shelfId: LOCAL_SHELF_ID, userId: LOCAL_USER_ID, newId: () => crypto.randomUUID() })
      .then(() => live && setBoot({ state: 'ready' }))
      .catch((e: unknown) => {
        if (!live) return;
        setBoot({ state: 'error', problems: e instanceof ImportError ? e.problems : [String(e)] });
      });
    return () => {
      live = false;
    };
  }, []);
  return boot;
}
