import { useState } from 'react';
import { Link } from 'react-router';
import { DropdownMenu, Dialog } from 'radix-ui';
import { ArrowLeft, EllipsisVertical, Plus } from 'lucide-react';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { useSyncStatus } from '@/app/SyncContext';
import { Button } from '@/components/ui/button';
import { perform } from '@/data/actions';
import { db } from '@/data/db';
import { useSectionCounts, useSections } from '@/data/hooks';
import type { NewPostcard } from '@/data/outbox';
import type { Section } from '@/data/schema';
import { createSection, deleteSection, editSection, mergeSections, moveSection, type SectionChanges } from '@/data/sectionActions';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { SectionSheet, type SectionMove } from '@/ui/SectionSheet';

const ITEM = 'flex h-12 cursor-default items-center rounded-sm px-3 text-base outline-none data-[highlighted]:bg-surface-sunk';

type Pending = { kind: 'pick'; from: Section } | { kind: 'merge'; from: Section; into: Section } | { kind: 'delete'; section: Section };

/** Apply the moves to a copy as they are made, so a second move starts from where the first left off. */
function movePostcards(section: Section, moves: SectionMove[], sections: Section[], ctx: { me: string; now: string }): NewPostcard[] {
  const out: NewPostcard[] = [];
  let current = sections;
  for (const direction of moves) {
    const { postcards } = moveSection(section, direction, current, ctx);
    out.push(...postcards);
    current = current.map((s) => {
      const patch = postcards.find((p) => p.recordId === s.id);
      return patch && patch.kind === 'section.patch' ? { ...s, ...patch.fields } : s;
    });
    section = current.find((s) => s.id === section.id) ?? section;
  }
  return out;
}

export function SectionsScreen() {
  const { shelfId, userId } = useCurrentShelf();
  const { runNow } = useSyncStatus();
  const sections = useSections(shelfId);
  const counts = useSectionCounts(shelfId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const ctx = () => ({ me: userId, now: new Date().toISOString() });
  const countOf = (s: Section) => counts?.get(s.id) ?? 0; // only asked once counts are loaded

  async function run(make: () => { postcards: NewPostcard[] }) {
    setFailure(null);
    try {
      const { postcards } = make();
      if (postcards.length > 0) await perform(db, postcards, runNow);
      return postcards;
    } catch (e) {
      setFailure('Couldn’t save that. Check the section and try again.');
      return null;
    }
  }

  async function add() {
    const made = await run(() => createSection(shelfId, sections ?? [], { ...ctx(), newId: () => crypto.randomUUID() }));
    if (made?.[0]) setOpenId(made[0].recordId);
  }

  async function save(section: Section, changes: SectionChanges, moves: SectionMove[]) {
    const c = ctx();
    const saved = await run(() => ({ postcards: [...editSection(section, changes, c).postcards, ...movePostcards(section, moves, sections ?? [], c)] }));
    if (saved) setOpenId(null);
  }

  const open = sections?.find((s) => s.id === openId);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <Button asChild variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold">
        <Link to="/settings">
          <ArrowLeft className="size-5" />
          Back to settings
        </Link>
      </Button>
      <h1 className="font-display text-[56px] leading-[52px] tracking-[0.01em]">Sections</h1>

      <ul className="flex flex-col border-t border-line">
        {(sections ?? []).map((s) => {
          const n = counts ? countOf(s) : null;
          return (
            <li key={s.id} className="flex items-center border-b border-line">
              <button
                type="button"
                aria-label={n === null ? s.name : `${s.name}, ${n} ${n === 1 ? 'record' : 'records'}`}
                aria-describedby={s.isCatchAll ? `${s.id}-kept` : undefined}
                onClick={() => {
                  setFailure(null);
                  setOpenId(s.id);
                }}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-1 text-left"
              >
                <span aria-hidden className="size-4 flex-none rounded-full" style={{ background: `var(--section-${s.color})` }} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[17px] font-bold">{s.name}</span>
                  {s.isCatchAll && (
                    <span id={`${s.id}-kept`} className="text-[15px] text-ink-muted">
                      Can’t be deleted
                    </span>
                  )}
                </span>
                {n !== null && <span aria-hidden className="text-[15px] text-ink-muted">{n}</span>}
              </button>
              {!s.isCatchAll && n !== null && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button type="button" aria-label={`More for ${s.name}`} className="flex size-12 h-12 flex-none items-center justify-center rounded-lg text-ink-muted">
                      <EllipsisVertical className="size-5" aria-hidden />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content align="end" className="z-50 min-w-44 rounded-lg bg-surface-raised p-1 text-ink shadow-lg">
                      <DropdownMenu.Item className={ITEM} onSelect={() => setPending({ kind: 'pick', from: s })}>
                        Merge into…
                      </DropdownMenu.Item>
                      {n === 0 && (
                        <DropdownMenu.Item className={`${ITEM} text-brick-ink`} onSelect={() => setPending({ kind: 'delete', section: s })}>
                          Delete
                        </DropdownMenu.Item>
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
            </li>
          );
        })}
      </ul>

      <Button
        type="button"
        variant="outline"
        aria-label="Add a section"
        disabled={!sections}
        onClick={() => void add()}
        className="h-12 w-full rounded-lg border-[1.5px] border-line-strong bg-transparent text-[15px] font-semibold"
      >
        <Plus className="size-5" aria-hidden />
        Add
      </Button>
      {failure && !open && <p role="alert" className="text-base text-brick-ink">{failure}</p>}

      {open && sections && (
        <SectionSheet key={open.id} open section={open} sections={sections} onSave={(changes, moves) => void save(open, changes, moves)} onCancel={() => { setFailure(null); setOpenId(null); }} failure={failure} />
      )}

      <Dialog.Root open={pending?.kind === 'pick'} onOpenChange={(next) => !next && setPending(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface-raised p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-ink shadow-lg"
          >
            <Dialog.Title className="font-display text-[32px] leading-8">Merge into…</Dialog.Title>
            {pending?.kind === 'pick' &&
              (sections ?? [])
                .filter((s) => s.id !== pending.from.id)
                .map((s) => (
                  <Button key={s.id} variant="outline" className="h-12 w-full justify-start rounded-lg border-[1.5px] border-line-strong bg-transparent text-base font-semibold" onClick={() => setPending({ kind: 'merge', from: pending.from, into: s })}>
                    <span aria-hidden className="size-4 flex-none rounded-full" style={{ background: `var(--section-${s.color})` }} />
                    {s.name}
                  </Button>
                ))}
            <Button variant="ghost" className="h-12 w-full rounded-lg text-[15px] font-semibold" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={pending?.kind === 'merge'}
        message={pending?.kind === 'merge' ? `Move ${countOf(pending.from)} ${countOf(pending.from) === 1 ? 'record' : 'records'} from ${pending.from.name} into ${pending.into.name}? ${pending.from.name} will be removed.` : ''}
        confirmLabel="Merge"
        cancelLabel="Keep it"
        danger="confirm"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending?.kind !== 'merge') return;
          const { from, into } = pending;
          setPending(null);
          void run(() => mergeSections(from, into, ctx()));
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'delete'}
        message={pending?.kind === 'delete' ? `Delete ${pending.section.name}?` : ''}
        confirmLabel="Delete"
        cancelLabel="Keep it"
        danger="confirm"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending?.kind !== 'delete') return;
          const { section } = pending;
          setPending(null);
          void run(() => deleteSection(section, sections ?? [], ctx()));
        }}
      />
    </main>
  );
}
