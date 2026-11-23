import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { SyncNotice } from '@/app/SyncContext';
import { useShelfItems } from '@/data/hooks';
import { FindRecord } from '@/ui/FindRecord';

/** Add to the want list by searching Discogs. */
export function AddWantScreen() {
  const { shelfId, userId } = useCurrentShelf();
  const items = useShelfItems(shelfId, userId);
  const records = useMemo(() => (items ?? []).map((i) => i.record), [items]);
  const navigate = useNavigate();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))]">
        <Button variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold" onClick={() => navigate('/want')}>
          ‹ Want list
        </Button>
      </div>
      <SyncNotice />
      <h1 className="px-4 font-display text-[44px] leading-[44px] tracking-[0.01em]">Add to your want list</h1>
      <FindRecord mode="want" records={records} />
    </main>
  );
}
