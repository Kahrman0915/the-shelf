import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBackend } from '@/app/BackendContext';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { useSyncStatus } from '@/app/SyncContext';
import { addFound, perform } from '@/data/actions';
import type { FoundRecord } from '@/data/backend';
import { db } from '@/data/db';
import { addPhotosTo, PATH_FIELD, PHOTO_SIDES, type Drafts, type PhotoCtx } from '@/data/photos';
import type { ShelfRecord } from '@/data/schema';
import { findDuplicate } from '@/domain/recordForm';
import { cn } from '@/lib/utils';
import { PhotoDuplicateDialog } from './PhotoDuplicateDialog';
import { messageFor, NEEDS_SIGNAL, useSavedOffer, type SavedOffer } from './useSavedOffer';

const MAX_CARDS = 6;
/** The longest query the discogs-search function accepts. */
const MAX_QUERY = 200;
/** Discogs asks that its data be no more than 6 hours old; results older than this are dropped
 *  when the app comes back to the front. */
const STALE_MS = 60 * 60 * 1000;
const NO_RESULTS = 'Discogs didn’t find that. Try fewer words, or fill it in by hand.';
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const joined = (parts: (string | number | null)[]) => parts.filter((p) => p !== null && p !== '').join(' · ');

/** Photos waiting for the next record saved: `onUsed` once a save took them, `onBack` with them after that save is undone. */
type Photos = { drafts: Drafts; onUsed: () => void; onBack: (drafts: Drafts | null) => void };

/** The record on the shelf already has a photo on a side these drafts would fill. */
function replaces(record: ShelfRecord, drafts: Drafts): boolean {
  return PHOTO_SIDES.some((side) => drafts[side] !== undefined && record[PATH_FIELD[side]] !== null);
}

/** Search Discogs and put a record on the shelf with one tap. Results live only in this component's state.
 *  With photos waiting, the record saved takes them; if it's already on the shelf, it asks where they go first. */
export function FindRecord({ records, onAdded, photos }: { records: ShelfRecord[]; onAdded?: () => void; photos?: Photos }) {
  const backend = useBackend();
  const { shelfId, userId } = useCurrentShelf();
  const { runNow } = useSyncStatus();

  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; results: FoundRecord[]; at: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  // Where an undone save hands its photos back. Kept from the save itself: once the drafts are used, `photos` goes.
  const handBack = useRef<Photos['onBack'] | null>(null);
  // The save that can still be undone. Shown inline under the box: the app-wide bottom bar is hidden
  // by the iPhone keyboard, which stays open here on purpose.
  const { saved, error: undoError, offer, undo: undoSaved } = useSavedOffer({
    onUndone: (drafts) => {
      box.current?.focus();
      if (drafts) handBack.current?.(drafts);
    },
  });
  // A card that's already on the shelf, picked with photos waiting: the question of where the photos go.
  const [asking, setAsking] = useState<{ record: FoundRecord; existing: ShelfRecord; photos: Photos; searchBefore: number } | null>(null);
  const [online, setOnline] = useState(isOnline);
  const box = useRef<HTMLInputElement>(null);
  // Only the latest search may show its answer: an older one that returns late is ignored.
  const latest = useRef(0);
  // A ref, not just state: two taps before React re-renders must still save one record.
  // 'running' while a save is under way, whatever else lands meanwhile. 'held' after a save until
  // the cards it came from have left the screen. Back to 'idle' at once on failure.
  const saving = useRef<'idle' | 'running' | 'held'>('idle');
  useEffect(() => {
    if (saving.current === 'held') saving.current = 'idle';
  }, [found]);

  useEffect(() => {
    const update = () => setOnline(isOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      latest.current++;
    };
  }, []);

  useEffect(() => {
    const dropStale = () => {
      if (document.visibilityState !== 'visible') return;
      setFound((f) => (f && Date.now() - f.at > STALE_MS ? null : f));
    };
    document.addEventListener('visibilitychange', dropStale);
    return () => document.removeEventListener('visibilitychange', dropStale);
  }, []);

  const q = query.trim();
  const canSearch = online && !searching && q.length >= 2;

  function edit(value: string) {
    setQuery(value);
    // Changing the words abandons a search still on its way, so a new one can start at once.
    latest.current++;
    setSearching(false);
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!canSearch) return;
    const mine = ++latest.current;
    setSearching(true);
    setMessage(null);
    try {
      const results = await backend.searchDiscogs(q);
      if (mine !== latest.current) return;
      setFound({ query: q, results: results.slice(0, MAX_CARDS), at: Date.now() });
      setMessage(results.length === 0 ? NO_RESULTS : null);
    } catch (err) {
      if (mine !== latest.current) return;
      setFound(null);
      setMessage(messageFor(err));
    } finally {
      if (mine === latest.current) setSearching(false);
    }
  }

  function pick(record: FoundRecord) {
    // Inside the tap itself: iOS only opens the keyboard for a focus() made before any await.
    box.current?.focus();
    if (saving.current !== 'idle') return;
    saving.current = 'running';
    const searchBefore = latest.current;
    const existing = photos ? findDuplicate(records, record.artist, record.title) : null;
    if (photos && existing) {
      // Stays 'running' while the question is up, so another tap can't start a save meanwhile.
      setAsking({ record, existing, photos, searchBefore });
      return;
    }
    void save(record, { kind: 'new', photos: photos ?? null }, searchBefore);
  }

  /** Save a new record (with the photos, if any) or put the photos on one already on the shelf. Called with saving 'running'. */
  async function save(record: FoundRecord, to: { kind: 'new'; photos: Photos | null } | { kind: 'existing'; photos: Photos; existing: ShelfRecord }, searchBefore: number) {
    try {
      const ctx: PhotoCtx & { shelfId: string; newId: string } = {
        me: userId,
        now: new Date().toISOString(),
        shelfId,
        newId: crypto.randomUUID(),
        photoId: () => crypto.randomUUID(),
      };
      const drafts = to.photos?.drafts ?? null;
      let made: SavedOffer;
      if (to.kind === 'existing') {
        const plan = addPhotosTo(to.existing, to.photos.drafts, ctx);
        await perform(db, plan.postcards, runNow, plan.photos);
        made = { text: `Photos added: ${to.existing.title}`, undo: plan.undo, drafts, later: plan.later };
      } else {
        const found = addFound(record, ctx);
        const create = found.postcards[0];
        const plan = drafts && create.kind === 'record.create' ? addPhotosTo(create.fields, drafts, ctx) : null;
        await perform(db, [...found.postcards, ...(plan?.postcards ?? [])], runNow, plan?.photos ?? []);
        made = { text: `On the shelf: ${record.title}`, undo: [...(found.undo ?? []), ...(plan?.undo ?? [])], drafts, later: [] };
      }
      if (to.photos) {
        handBack.current = to.photos.onBack;
        to.photos.onUsed();
      }
      offer(made);
      if (latest.current === searchBefore) {
        saving.current = 'held';
        latest.current++;
        setQuery('');
        setFound(null);
        setMessage(null);
        setSearching(false);
      } else {
        // New words or a new search arrived while saving: keep them, and their cards are fair game.
        saving.current = 'idle';
      }
      onAdded?.();
    } catch (err) {
      setMessage(messageFor(err));
      saving.current = 'idle';
    }
  }

  function answer(choice: 'existing' | 'copy' | null) {
    const question = asking;
    setAsking(null);
    if (!question) return;
    if (choice === null) {
      saving.current = 'idle';
      return;
    }
    const { record, existing, photos: waiting, searchBefore } = question;
    void save(record, choice === 'existing' ? { kind: 'existing', photos: waiting, existing } : { kind: 'new', photos: waiting }, searchBefore);
  }

  const shown = online ? message : NEEDS_SIGNAL;
  const results = found?.results ?? [];

  return (
    <section className="flex flex-col gap-3 px-4">
      <form role="search" onSubmit={(e) => void search(e)} className="flex flex-col gap-2">
        <label htmlFor="find-record" className={LABEL}>
          Find a record
        </label>
        <div className="flex gap-2">
          <Input
            ref={box}
            id="find-record"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={MAX_QUERY}
            placeholder="Artist and title, like mccoy tyner forces of nature"
            value={query}
            disabled={!online}
            onChange={(e) => edit(e.target.value)}
            className="h-12 flex-1 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk px-4 text-base"
          />
          <Button type="submit" disabled={!canSearch} className="h-12 shrink-0 rounded-lg px-5 text-base font-semibold">
            {searching ? 'Searching Discogs…' : 'Search'}
          </Button>
        </div>
      </form>

      {/* Always mounted, so a screen reader announces the text when it arrives. */}
      <div role="status" aria-live="polite">
        {saved && !undoError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border-[1.5px] border-line-strong bg-surface-raised py-1 pr-1 pl-4">
            <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-ink">
              <Check aria-hidden="true" className="size-4 flex-none" />
              <span>{saved.text}</span>
            </span>
            <Button type="button" variant="outline" className="h-12 shrink-0 rounded-lg px-4 text-[15px] font-semibold" onClick={() => void undoSaved()}>
              Undo
            </Button>
          </div>
        )}
      </div>
      {saved && undoError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border-[1.5px] border-line-strong bg-surface-raised py-1 pr-1 pl-4">
          <span role="alert" className="text-[15px] font-semibold text-ink">
            {undoError}
          </span>
          <Button type="button" variant="outline" className="h-12 shrink-0 rounded-lg px-4 text-[15px] font-semibold" onClick={() => void undoSaved()}>
            Undo
          </Button>
        </div>
      )}

      {shown && (
        <p role="status" className="text-[15px] leading-[22px] text-ink-muted">
          {shown}
        </p>
      )}

      {found && results.length > 0 && (
        <>
          <ul className={cn('flex flex-col gap-2', searching && 'opacity-50')}>
            {results.map((r) => {
              const first = joined([r.year, r.label, r.catalog]);
              const second = joined([r.format, r.country]);
              const onShelf = findDuplicate(records, r.artist, r.title) !== null;
              return (
                <li key={r.releaseId}>
                  <button
                    type="button"
                    disabled={searching}
                    onClick={() => pick(r)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg border-[1.5px] border-line-strong bg-surface-raised p-3 text-left text-ink"
                  >
                    {r.thumb && <img src={r.thumb} alt="" className="size-14 flex-none rounded object-cover" />}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-bold">{`${r.artist} — ${r.title}`}</span>
                      {first && <span className="text-[15px] leading-[22px] text-ink-muted">{first}</span>}
                      {second && <span className="text-[15px] leading-[22px] text-ink-muted">{second}</span>}
                      {onShelf && <span className="text-[15px] font-semibold leading-[22px] text-bourbon-ink">Already on the shelf</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <a
            href={`https://www.discogs.com/search/?q=${encodeURIComponent(found.query)}&type=release`}
            target="_blank"
            rel="noopener"
            className="flex min-h-12 w-fit items-center text-[15px] text-ink-muted underline underline-offset-2"
          >
            Data provided by Discogs
          </a>
        </>
      )}

      <PhotoDuplicateDialog
        open={asking !== null}
        replacing={asking !== null && replaces(asking.existing, asking.photos.drafts)}
        onAdd={() => answer('existing')}
        onCopy={() => answer('copy')}
        onClose={() => answer(null)}
      />
    </section>
  );
}
