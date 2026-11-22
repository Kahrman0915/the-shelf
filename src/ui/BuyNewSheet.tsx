import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { NewBuy } from '@/data/actions';
import { SHELF_LOADING } from '@/data/backend';
import type { Section } from '@/data/schema';
import { GRADE_KEYS, type Grade } from '@/domain/grades';
import { parsePrice, sanitizeAsking } from '@/domain/price';
import { GradePicker } from './GradePicker';
import { SECTION_ITEM_CLASS } from './SectionSelect';

/** The sheet's fields as typed (all strings); `price` comes out as dollars or null. */
export const BuyNewFormSchema = z.object({
  artist: z.string().trim().min(1, 'Add the artist'),
  title: z.string().trim().min(1, 'Add the title'),
  sectionId: z.string().min(1, 'Choose a section'),
  grade: z.enum(GRADE_KEYS),
  price: z.string().transform((s) => parsePrice(s)),
});

type Field = 'artist' | 'title' | 'sectionId';
type Errors = Partial<Record<Field, string>>;

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted';
const INPUT = 'h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk px-4 text-base';
const ERROR = 'text-[15px] text-brick-ink';

export function BuyNewSheet({
  open,
  initialArtist,
  sections,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialArtist: string;
  /** The shelf's sections, in shelf order, for the Section picker; undefined while they load. */
  sections: Section[] | undefined;
  onOpenChange: (open: boolean) => void;
  onSave: (buy: NewBuy) => Promise<void>;
}) {
  const [artist, setArtist] = useState(initialArtist);
  const [title, setTitle] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [grade, setGrade] = useState<Grade>('NM');
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  // A ref, not just state: two taps before React re-renders must save one purchase.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);

  // Each time the sheet opens it starts fresh, with the artist from the search.
  useEffect(() => {
    if (!open) return;
    setArtist(initialArtist);
    setTitle('');
    setSectionId('');
    setGrade('NM');
    setPrice('');
    setErrors({});
    setFailure(null);
    saving.current = false;
    setBusy(false);
  }, [open, initialArtist]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    const parsed = BuyNewFormSchema.safeParse({ artist, title, sectionId, grade, price });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'artist' || key === 'title' || key === 'sectionId') && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setFailure(null);
    saving.current = true;
    setBusy(true);
    const { artist: a, title: t, sectionId: sid, grade: gr, price: p } = parsed.data;
    try {
      await onSave({ artist: a, title: t, sectionId: sid, grade: gr, pricePaid: p });
      // Held on success: the sheet closes, and re-opening resets it.
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-t-2xl bg-surface-raised p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-ink shadow-lg"
        >
          <Dialog.Title className="font-display text-[32px] leading-8 tracking-[0.01em]">Bought it</Dialog.Title>
          <form noValidate onSubmit={submit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="buy-artist" className={LABEL}>Artist</label>
              <Input
                id="buy-artist"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                aria-invalid={errors.artist ? true : undefined}
                aria-describedby={errors.artist ? 'buy-artist-error' : undefined}
                className={INPUT}
              />
              {errors.artist && <p id="buy-artist-error" className={ERROR}>{errors.artist}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="buy-title" className={LABEL}>Title</label>
              <Input
                id="buy-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-invalid={errors.title ? true : undefined}
                aria-describedby={errors.title ? 'buy-title-error' : undefined}
                className={INPUT}
              />
              {errors.title && <p id="buy-title-error" className={ERROR}>{errors.title}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="buy-section" className={LABEL}>Section</label>
              <Select value={sectionId} onValueChange={setSectionId} disabled={!sections?.length}>
                <SelectTrigger
                  id="buy-section"
                  aria-invalid={errors.sectionId ? true : undefined}
                  aria-describedby={errors.sectionId ? 'buy-section-error' : sections?.length === 0 ? 'buy-section-loading' : undefined}
                  className="w-full rounded-lg border-[1.5px] border-line-strong bg-surface-sunk px-4 text-base text-ink data-[size=default]:h-12 [&_svg]:text-ink-muted"
                >
                  <SelectValue placeholder="Choose a section" />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  {sections?.map((s) => (
                    <SelectItem key={s.id} value={s.id} className={SECTION_ITEM_CLASS}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Only once they've loaded and there are none: while they load the picker just waits. */}
              {sections?.length === 0 && <p id="buy-section-loading" className="text-[15px] text-ink-muted">{SHELF_LOADING}</p>}
              {errors.sectionId && <p id="buy-section-error" className={ERROR}>{errors.sectionId}</p>}
            </div>

            <GradePicker value={grade} onChange={setGrade} part="Disc" />

            <div className="flex flex-col gap-2">
              <label htmlFor="buy-price" className={LABEL}>Price paid</label>
              <Input
                id="buy-price"
                inputMode="decimal"
                value={price}
                placeholder="0"
                onChange={(e) => setPrice(sanitizeAsking(e.target.value))}
                className={INPUT}
              />
            </div>

            {failure && <p role="alert" className={ERROR}>{failure}</p>}
            <Button type="submit" disabled={busy} className="h-12 w-full rounded-lg font-display text-[22px] tracking-[0.04em]">
              Bought it
            </Button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
