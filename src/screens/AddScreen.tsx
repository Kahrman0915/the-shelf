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
      <RecordForm
        mode="add"
        initial={initial}
        records={records}
        onSave={onSave}
        onOpenDuplicate={(id) => leave(() => navigate(`/record/${id}`))}
        onDirtyChange={setDirty}
      />
      {dialog}
    </main>
  );
}
