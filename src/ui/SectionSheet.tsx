import { useState } from 'react';
import { Dialog, RadioGroup, Switch } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SectionChanges } from '@/data/sectionActions';
import type { Section } from '@/data/schema';
import { DISCOGS_GENRES, SWATCH_KEYS, type DiscogsGenre, type SwatchKey } from '@/domain/sections';

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted';
const ERROR = 'text-[15px] text-brick-ink';
const OUTLINE = 'h-12 flex-1 rounded-lg border-[1.5px] border-line-strong bg-transparent text-[15px] font-semibold';

export type SectionMove = 'up' | 'down';

/** Edit one section: name, colour, which Discogs genres land here, holiday, and where it sits. Nothing is saved until Save; Cancel drops it all. */
export function SectionSheet({
  open,
  section,
  sections,
  onSave,
  onCancel,
}: {
  open: boolean;
  section: Section;
  /** Every section on the shelf, in shelf order. */
  sections: Section[];
  onSave: (changes: SectionChanges, moves: SectionMove[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(section.name);
  const [color, setColor] = useState<SwatchKey>(section.color as SwatchKey);
  const [genres, setGenres] = useState<DiscogsGenre[]>(section.discogsGenres);
  const [holiday, setHoliday] = useState(section.takesHoliday);
  const [moves, setMoves] = useState<SectionMove[]>([]);
  const [error, setError] = useState<string | null>(null);

  const others = sections.filter((s) => s.id !== section.id);
  const at = sections.findIndex((s) => s.id === section.id) + moves.reduce((n, m) => n + (m === 'up' ? -1 : 1), 0);
  const trimmed = name.trim();
  const sameName = trimmed !== '' && others.some((s) => s.name.trim().toLowerCase() === trimmed.toLowerCase());

  function save() {
    if (trimmed === '') return setError('Give the section a name.');
    if (trimmed.length > 40) return setError('Keep the name to 40 characters or fewer.');
    setError(null);
    onSave({ name: trimmed, color, discogsGenres: genres, takesHoliday: holiday }, moves);
  }

  function toggle(genre: DiscogsGenre, on: boolean) {
    setGenres((g) => (on ? [...g, genre] : g.filter((x) => x !== genre)));
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-t-2xl bg-surface-raised p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-ink shadow-lg"
        >
          <Dialog.Title className="font-display text-[32px] leading-8 tracking-[0.01em]">Section</Dialog.Title>

          <div className="flex flex-col gap-2">
            <label htmlFor="section-name" className={LABEL}>Name</label>
            <Input
              id="section-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? true : undefined}
              className="h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk px-4 text-base"
            />
            {error && <p role="alert" className={ERROR}>{error}</p>}
            {sameName && <p className="text-[15px] text-ink-muted">Another section is already called that.</p>}
          </div>

          <div className="flex flex-col gap-2">
            <span id="section-colour" className={LABEL}>Colour</span>
            <RadioGroup.Root value={color} onValueChange={(v) => setColor(v as SwatchKey)} aria-labelledby="section-colour" className="flex flex-wrap gap-2">
              {SWATCH_KEYS.map((key) => (
                <RadioGroup.Item
                  key={key}
                  value={key}
                  aria-label={key}
                  className="size-12 h-12 rounded-full border-2 border-transparent data-[state=checked]:border-ink data-[state=checked]:ring-2 data-[state=checked]:ring-surface-raised"
                  style={{ background: `var(--section-${key})` }}
                />
              ))}
            </RadioGroup.Root>
          </div>

          <fieldset className="flex flex-col">
            <legend className={`${LABEL} mb-1`}>Discogs genres that go here</legend>
            {DISCOGS_GENRES.map((genre) => {
              const elsewhere = others.find((s) => s.discogsGenres.includes(genre));
              return (
                <label key={genre} className="flex h-12 items-center gap-3 text-base">
                  <input
                    type="checkbox"
                    checked={genres.includes(genre)}
                    onChange={(e) => toggle(genre, e.target.checked)}
                    className="size-6 flex-none accent-[var(--ink)]"
                  />
                  <span>
                    {genre}
                    {elsewhere && !genres.includes(genre) && (
                      <>
                        {' '}
                        <span className="text-ink-muted">(in {elsewhere.name})</span>
                      </>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>

          <div className="flex h-12 items-center justify-between gap-3">
            <label htmlFor="section-holiday" className="text-base">Holiday records go here</label>
            <Switch.Root
              id="section-holiday"
              checked={holiday}
              onCheckedChange={setHoliday}
              className="relative h-12 w-14 flex-none rounded-full bg-line-strong data-[state=checked]:bg-bourbon"
            >
              <Switch.Thumb className="block size-6 translate-x-1 rounded-full bg-surface-raised transition-transform data-[state=checked]:translate-x-7" />
            </Switch.Root>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" className={OUTLINE} disabled={at <= 0} onClick={() => setMoves((m) => [...m, 'up'])}>
              Move up
            </Button>
            <Button type="button" variant="outline" className={OUTLINE} disabled={at >= sections.length - 1} onClick={() => setMoves((m) => [...m, 'down'])}>
              Move down
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Button type="button" className="h-12 w-full rounded-lg font-display text-[22px] tracking-[0.04em]" onClick={save}>
              Save
            </Button>
            <Button type="button" variant="ghost" className="h-12 w-full rounded-lg text-[15px] font-semibold" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
