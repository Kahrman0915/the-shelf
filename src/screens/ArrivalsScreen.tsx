import { Link, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { SyncNotice } from '@/app/SyncContext';
import { useShelfItems } from '@/data/hooks';
import { spineColor } from '@/domain/labels';
import { newArrivals } from '@/domain/shelf';
import { SpineRow } from '@/ui/SpineRow';

export function ArrivalsScreen() {
  const { shelfId, userId } = useCurrentShelf();
  const navigate = useNavigate();
  const items = useShelfItems(shelfId, userId);
  const rows = items ? newArrivals(items) : [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <header className="flex flex-col gap-2 px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))] pb-6">
        <Link to="/" className="inline-flex h-12 w-fit items-center gap-2 rounded-lg px-3 text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-ring">
          <ArrowLeft aria-hidden className="size-5" />
          Back
        </Link>
        <h1 className="font-display text-[44px] leading-[44px] tracking-[0.01em]">New arrivals</h1>
      </header>
      <SyncNotice />
      {items === undefined ? null : rows.length === 0 ? (
        <p className="px-4 py-8 text-ink-muted">Nothing waiting. Records you buy at a show land here.</p>
      ) : (
        <div className="border-t border-line">
          {rows.map((item) => (
            <SpineRow key={item.record.id} record={item.record} rating={item.myRating} color={spineColor(item.record, 'all')} tag="new" onOpen={() => navigate(`/record/${item.record.id}`)} />
          ))}
        </div>
      )}
    </main>
  );
}
