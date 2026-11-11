import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { SyncNotice, useSyncStatus } from '@/app/SyncContext';
import { useUndo } from '@/app/UndoContext';
import { boughtNew, perform, type NewBuy } from '@/data/actions';
import { db } from '@/data/db';
import { useShelfItems } from '@/data/hooks';
import { spineColor } from '@/domain/labels';
import { collectionTag, showResults } from '@/domain/shelf';
import { BuyNewSheet } from '@/ui/BuyNewSheet';
import { SpineRow } from '@/ui/SpineRow';

/** Record-show mode: one hand, fast. Search first; every result says where it stands.
 *  The query lives in the URL so "Back to search" from a price check can restore it. */
export function ShowScreen() {
  const { shelfId, userId } = useCurrentShelf();
  const items = useShelfItems(shelfId, userId);
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const navigate = useNavigate();
  const { runNow } = useSyncStatus();
  const { offer } = useUndo();
  const [buying, setBuying] = useState(false);
  const results = items ? showResults(items, query) : [];

  function setQuery(next: string) {
    setSearchParams(next === '' ? {} : { q: next }, { replace: true });
  }

  async function onSave(buy: NewBuy) {
    const result = boughtNew(buy, { me: userId, now: new Date().toISOString(), shelfId, newId: crypto.randomUUID() });
    await perform(db, result.postcards, runNow);
    const undo = result.undo;
    if (undo) offer('In New arrivals', () => perform(db, undo, runNow));
    setBuying(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <header className="flex items-end justify-between gap-4 px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+1.5rem))] pb-6">
        <h1 className="font-display text-[56px] leading-[52px] tracking-[0.01em]">At the show</h1>
        <Button asChild variant="outline" className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent px-5 text-[15px] font-semibold">
          <Link to="/">Home</Link>
        </Button>
      </header>
      <SyncNotice />
      <label className="relative mx-4 mb-4 block">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-ink-muted" />
        <Input
          type="search"
          aria-label="Search your records"
          placeholder="Artist, title or catalog"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-14 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk pl-12 text-lg"
        />
      </label>
      {query.trim() === '' ? (
        <p className="px-4 text-ink-muted">Do you own it? Is it on the want list? Type an artist, title or catalog number.</p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-start gap-4 px-4">
          <p className="text-ink-muted">Not in your collection or want list.</p>
          <Button className="h-12 rounded-lg px-6 font-display text-[22px] tracking-[0.04em]" onClick={() => setBuying(true)}>
            Bought it
          </Button>
        </div>
      ) : (
        <div className="border-t border-line">
          {results.map((item) => (
            <SpineRow
              key={item.record.id}
              record={item.record}
              rating={item.myRating}
              color={spineColor(item.record, 'all')}
              tag={collectionTag(item.record)}
              onOpen={() => navigate(`/price/${item.record.id}${query ? `?q=${encodeURIComponent(query)}` : ''}`)}
            />
          ))}
        </div>
      )}
      <BuyNewSheet open={buying} initialArtist={query.trim()} onOpenChange={setBuying} onSave={onSave} />
    </main>
  );
}
