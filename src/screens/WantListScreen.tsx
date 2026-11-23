import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { useBackend } from '@/app/BackendContext';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { SyncNotice, useSyncStatus } from '@/app/SyncContext';
import { useUndo } from '@/app/UndoContext';
import { perform } from '@/data/actions';
import { NOT_ENOUGH_RATINGS, SIGN_IN_AGAIN } from '@/data/backend';
import { db } from '@/data/db';
import { useRatedCount, useSections, useShelfItems, useSuggestions } from '@/data/hooks';
import type { Suggestion } from '@/data/schema';
import { pullShelf } from '@/data/sync';
import { addSuggestion, dismissSuggestion } from '@/data/wantActions';
import { normalise } from '@/domain/search';
import { NEEDS_SIGNAL, messageFor } from '@/ui/useSavedOffer';
import { SuggestionCard } from '@/ui/SuggestionCard';

const MIN_RATED = 5;
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const RUNNING = 'Finding records you’d like…';
const NOTHING_NEW = 'No new suggestions this time.';

const byName = (a: { artist: string; title: string }, b: { artist: string; title: string }) =>
  normalise(a.artist).localeCompare(normalise(b.artist)) || normalise(a.title).localeCompare(normalise(b.title));

const ROW = 'flex min-h-12 w-full flex-col justify-center border-b border-line px-4 py-2 text-left';

function GroupHeading({ children }: { children: string }) {
  return <h2 className="border-b border-line-strong px-4 pt-6 pb-2 font-display text-[22px] tracking-[0.04em]">{children}</h2>;
}

/** The want list: what you want, what you'd upgrade, and what Claude suggests. */
export function WantListScreen() {
  const { shelfId, userId } = useCurrentShelf();
  const navigate = useNavigate();
  const backend = useBackend();
  const { runNow } = useSyncStatus();
  const { offer } = useUndo();
  const items = useShelfItems(shelfId, userId);
  const suggestions = useSuggestions(shelfId);
  const sections = useSections(shelfId);
  const rated = useRatedCount(shelfId);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);
  const [online, setOnline] = useState(isOnline);
  // Suggestions being added or dismissed right now, so a second tap can't repeat the action on stale data.
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    const update = () => setOnline(isOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const wanted = useMemo(() => (items ?? []).map((i) => i.record).filter((r) => r.status === 'wanted').sort(byName), [items]);
  const upgrades = useMemo(() => (items ?? []).map((i) => i.record).filter((r) => r.status === 'owned' && r.wantsUpgrade).sort(byName), [items]);
  const pending = useMemo(
    () => (suggestions ?? []).filter((s) => s.status === 'pending').sort((a, b) => b.roundAt.localeCompare(a.roundAt) || a.createdAt.localeCompare(b.createdAt)),
    [suggestions],
  );

  const offline = !online;
  const tooFew = rated !== undefined && rated < MIN_RATED;

  const once = async (s: Suggestion, run: () => Promise<void>) => {
    if (inFlight.current.has(s.id)) return;
    inFlight.current.add(s.id);
    try {
      await run();
    } finally {
      inFlight.current.delete(s.id);
    }
  };

  const add = (s: Suggestion) => once(s, async () => {
    const result = addSuggestion(s, (items ?? []).map((i) => i.record), { me: userId, now: new Date().toISOString(), shelfId, newId: crypto.randomUUID(), sections: sections ?? [] });
    await perform(db, result.postcards, runNow);
    const undo = result.undo;
    if (undo) offer(`On your want list: ${s.title}`, () => perform(db, undo, runNow));
  });

  const dismiss = (s: Suggestion) =>
    once(s, async () => {
      await perform(db, dismissSuggestion(s, { me: userId, now: new Date().toISOString() }).postcards, runNow);
    });

  const pendingNow = () => db.suggestions.where('shelfId').equals(shelfId).filter((s) => s.status === 'pending').count();

  const suggestMore = async () => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setMessage(null);
    const before = await pendingNow();
    try {
      const { added } = await backend.suggestRecords();
      runNow();
      if (added === 0) setMessage(NOTHING_NEW);
    } catch (e) {
      const text = messageFor(e);
      if (text === NOT_ENOUGH_RATINGS || text === SIGN_IN_AGAIN) {
        setMessage(text);
      } else {
        // The call may have finished on the server even though its reply was lost: look before showing an error.
        await pullShelf(db, backend, shelfId).catch(() => {});
        if ((await pendingNow()) <= before) setMessage(text);
      }
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  const suggestLabel = offline ? NEEDS_SIGNAL : running ? RUNNING : 'Suggest more';
  const line = tooFew ? NOT_ENOUGH_RATINGS : message;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))]">
        <Button variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold" onClick={() => navigate('/')}>
          ‹ Shelf
        </Button>
        <Button asChild variant="outline" className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent px-5 text-[15px] font-semibold">
          <Link to="/want/add">+ Add</Link>
        </Button>
      </div>
      <h1 className="px-4 pt-2 font-display text-[44px] leading-[44px] tracking-[0.01em]">Want list</h1>
      <SyncNotice />

      <GroupHeading>{`Wanted (${wanted.length})`}</GroupHeading>
      {items !== undefined && wanted.length === 0 ? (
        <p className="px-4 py-4 text-ink-muted">Nothing on your want list yet.</p>
      ) : (
        <ul>
          {wanted.map((r) => (
            <li key={r.id}>
              <Link to={`/record/${r.id}`} className={ROW}>
                <span className="block truncate text-[17px] leading-[22px] font-bold">{r.artist}</span>
                <span className="block truncate text-[15px] leading-5 text-ink-muted">{r.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <GroupHeading>{`Upgrades (${upgrades.length})`}</GroupHeading>
      <ul>
        {upgrades.map((r) => (
          <li key={r.id}>
            <Link to={`/record/${r.id}`} className={ROW}>
              <span className="block truncate text-[17px] leading-[22px] font-bold">{r.artist}</span>
              <span className="block truncate text-[15px] leading-5 text-ink-muted">{r.title}</span>
              {r.upgradeNote && <span className="block text-[15px] leading-5">{r.upgradeNote}</span>}
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex items-end justify-between gap-3 border-b border-line-strong px-4 pt-6 pb-2">
        <h2 className="font-display text-[22px] tracking-[0.04em]">{`Suggested for you (${pending.length})`}</h2>
        <Button variant="outline" className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent px-5 text-[15px] font-semibold" disabled={offline || running || tooFew} onClick={() => void suggestMore()}>
          {suggestLabel}
        </Button>
      </div>
      {line && (
        <p role="status" className="px-4 pt-2 text-[15px] leading-[22px] text-ink-muted">
          {line}
        </p>
      )}
      {suggestions !== undefined && pending.length === 0 ? (
        <p className="px-4 py-4 text-ink-muted">Tap Suggest more for records you might like.</p>
      ) : (
        <ul>
          {pending.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} onAdd={() => void add(s)} onDismiss={() => void dismiss(s)} />
          ))}
        </ul>
      )}
    </main>
  );
}
