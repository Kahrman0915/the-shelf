import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { SyncNotice, useSyncStatus } from '@/app/SyncContext';
import { useLeaveGuard } from '@/app/useLeaveGuard';
import { addRecord, perform, type RecordFields } from '@/data/actions';
import { db } from '@/data/db';
import { useShelfItems } from '@/data/hooks';
import { emptyForm } from '@/domain/recordForm';
import { cn } from '@/lib/utils';
import { FindRecord } from '@/ui/FindRecord';
import { RecordForm } from '@/ui/RecordForm';

export function AddScreen() {
  const { shelfId, userId } = useCurrentShelf();
  const items = useShelfItems(shelfId, userId);
  const records = useMemo(() => (items ?? []).map((i) => i.record), [items]);
  const { runNow } = useSyncStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const initial = useMemo(() => emptyForm(), []);
  const [dirty, setDirty] = useState(false);
  const [byHand, setByHand] = useState(false);
  const { leave, dialog } = useLeaveGuard(dirty);
  const back = () => leave(() => (location.key !== 'default' ? navigate(-1) : navigate('/')));

  async function onSave(fields: RecordFields, { rating, another }: { rating: number | null; another: boolean }) {
    const ctx = { me: userId, now: new Date().toISOString(), shelfId, newId: crypto.randomUUID() };
    await perform(db, addRecord(fields, rating, ctx).postcards, runNow);
    if (!another) navigate('/');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))]">
        <Button variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold" onClick={back}>
          ‹ Shelf
        </Button>
      </div>
      <SyncNotice />
      <h1 className="px-4 font-display text-[44px] leading-[44px] tracking-[0.01em]">Add a record</h1>
      <FindRecord records={records} />
      <div className="px-4">
        <button
          type="button"
          aria-expanded={byHand}
          aria-controls="add-by-hand"
          onClick={() => setByHand((x) => !x)}
          className="flex min-h-12 w-full items-center justify-between rounded-lg border-[1.5px] border-line-strong px-4 text-base font-semibold text-ink"
        >
          Not here? Fill it in by hand
          <span aria-hidden className={cn('transition-transform', byHand && 'rotate-180')}>⌄</span>
        </button>
      </div>
      {/* Folded, not unmounted: what was typed by hand survives folding, and still counts as unsaved. */}
      <div id="add-by-hand" hidden={!byHand}>
        <RecordForm
          mode="add"
          initial={initial}
          records={records}
          onSave={onSave}
          onOpenDuplicate={(id) => leave(() => navigate(`/record/${id}`))}
          onDirtyChange={setDirty}
        />
      </div>
      {dialog}
    </main>
  );
}
