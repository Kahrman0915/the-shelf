import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { useUndo } from '@/app/UndoContext';
import { useSyncStatus } from '@/app/SyncContext';
import { boughtIt, buyKind, perform } from '@/data/actions';
import { db } from '@/data/db';
import { useRecord } from '@/data/hooks';
import { PriceCheck, type BoughtInput } from '@/ui/PriceCheck';

export function PriceCheckScreen() {
  const { id } = useParams();
  const { shelfId, userId } = useCurrentShelf();
  const record = useRecord(shelfId, id);
  const { runNow } = useSyncStatus();
  const { offer } = useUndo();
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const backHref = query ? `/show?q=${encodeURIComponent(query)}` : '/show';

  async function onBought(input: BoughtInput) {
    if (!record) return;
    setError(null);
    try {
      const kind = buyKind(record);
      const result = boughtIt(record, input, { me: userId, now: new Date().toISOString() });
      await perform(db, result.postcards, runNow);
      const undo = result.undo;
      if (undo) offer(kind === 'want' ? 'In New arrivals' : 'Upgrade logged', () => perform(db, undo, runNow));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <Button asChild variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold">
        <Link to={backHref}>
          <ArrowLeft className="size-5" />
          Back to search
        </Link>
      </Button>
      {record === undefined ? null : record === null ? (
        <p className="text-ink-muted">That record isn’t on this phone.</p>
      ) : (
        <>
          <div>
            <div className="text-[17px] leading-[22px] font-bold">{record.artist}</div>
            <div className="text-[15px] leading-5 text-ink-muted">{record.title}</div>
          </div>
          <PriceCheck record={record} buyable={buyKind(record) !== null} onBought={onBought} />
          {error && <p role="alert" className="text-[15px] text-brick-ink">{error}</p>}
        </>
      )}
    </main>
  );
}
