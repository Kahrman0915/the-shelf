import { useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useShelfItems } from '@/data/hooks';
import { LOCAL_SHELF_ID, LOCAL_USER_ID } from '@/data/session';
import { spineColor, type GenreFilter } from '@/domain/labels';
import { shelfRows, shelfTag } from '@/domain/shelf';
import { GenreSelect } from '@/ui/GenreSelect';
import { SpineRow } from '@/ui/SpineRow';

export function ShelfScreen() {
  const items = useShelfItems(LOCAL_SHELF_ID, LOCAL_USER_ID);
  const [genre, setGenre] = useState<GenreFilter>('all');
  const [query, setQuery] = useState('');
  const rows = items ? shelfRows(items, { genre, query }) : [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <header className="flex items-end justify-between gap-4 px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+1.5rem))] pb-6">
        <h1 className="font-display text-[56px] leading-[52px] tracking-[0.01em]">The Shelf</h1>
        <Button asChild variant="outline" className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent px-5 text-[15px] font-semibold">
          <Link to="/show">At the show</Link>
        </Button>
      </header>
      <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row">
        <GenreSelect value={genre} onChange={setGenre} />
        <label className="relative block flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-muted" />
          <Input
            type="search"
            aria-label="Search the shelf"
            placeholder="Artist, title or catalog"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk pl-11 text-base"
          />
        </label>
      </div>
      {items === undefined ? null : rows.length === 0 ? (
        <p className="px-4 py-8 text-ink-muted">Nothing on the shelf matches that.</p>
      ) : (
        <div className="border-t border-line">
          {rows.map((item) => (
            <SpineRow key={item.record.id} record={item.record} rating={item.myRating} color={spineColor(item.record, genre)} tag={shelfTag(item)} />
          ))}
        </div>
      )}
    </main>
  );
}
