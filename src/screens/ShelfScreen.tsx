import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Search, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { SyncNotice, useSyncStatus } from '@/app/SyncContext';
import { useSections, useSectionsById, useShelfItems } from '@/data/hooks';
import { spineColor, type SectionFilter } from '@/domain/labels';
import { newArrivals, shelfRows, shelfTag } from '@/domain/shelf';
import { PileRow } from '@/ui/PileRow';
import { SectionSelect } from '@/ui/SectionSelect';
import { SpineRow } from '@/ui/SpineRow';

export function ShelfScreen() {
  const { shelfId, userId } = useCurrentShelf();
  const navigate = useNavigate();
  const items = useShelfItems(shelfId, userId);
  const sections = useSections(shelfId);
  const sectionsById = useSectionsById(shelfId);
  const { lastSyncedAt } = useSyncStatus();
  const [chosen, setSection] = useState<SectionFilter>('all');
  // The section filtered to was merged away (or deleted), here or on another phone: back to all sections.
  const section = chosen !== 'all' && sections && !sections.some((s) => s.id === chosen) ? 'all' : chosen;
  if (section !== chosen) setSection(section);
  const [query, setQuery] = useState('');
  const rows = items ? shelfRows(items, { section, query }) : [];
  const pile = items ? newArrivals(items).map((i) => i.record) : [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <header className="flex items-end justify-between gap-4 px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+1.5rem))] pb-6">
        <h1 className="font-display text-[56px] leading-[52px] tracking-[0.01em]">The Shelf</h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent px-5 text-[15px] font-semibold">
            <Link to="/show">At the show</Link>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent px-5 text-[15px] font-semibold">
            <Link to="/want">Want list</Link>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent px-5 text-[15px] font-semibold">
            <Link to="/add">Add</Link>
          </Button>
          <Button asChild variant="ghost" className="size-12 rounded-lg p-0">
            <Link to="/settings" aria-label="Shelf settings">
              <Settings className="size-5" />
            </Link>
          </Button>
        </div>
      </header>
      <SyncNotice />
      <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row">
        <SectionSelect sections={sections ?? []} value={section} onChange={setSection} />
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
      {/* Spines wait for the sections too, so none is drawn in the wrong colour first. */}
      {sectionsById && <PileRow records={pile} sectionsById={sectionsById} onOpen={() => navigate('/arrivals')} />}
      {items === undefined || sectionsById === undefined ? null : items.filter((i) => i.record.status === 'owned').length === 0 ? (
        <p className="px-4 py-8 text-ink-muted">{lastSyncedAt ? 'Nothing on the shelf yet.' : 'Filling the shelf…'}</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-8 text-ink-muted">Nothing on the shelf matches that.</p>
      ) : (
        <div className="border-t border-line">
          {rows.map((item) => (
            <SpineRow key={item.record.id} record={item.record} rating={item.myRating} color={spineColor(item.record, sectionsById, section)} tag={shelfTag(item)} onOpen={() => navigate(`/record/${item.record.id}`)} />
          ))}
        </div>
      )}
    </main>
  );
}
