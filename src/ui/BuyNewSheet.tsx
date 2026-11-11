import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { NewBuy } from '@/data/actions';
import { GENRE_KEYS, GENRE_LABELS } from '@/domain/genres';
import { GRADE_KEYS, type Grade } from '@/domain/grades';
import { parsePrice, sanitizeAsking } from '@/domain/price';
import { GENRE_ITEM_CLASS } from './GenreSelect';
import { GradePicker } from './GradePicker';

/** The sheet's fields as typed (all strings); `price` comes out as dollars or null. */
export const BuyNewFormSchema = z.object({
  artist: z.string().trim().min(1, 'Add the artist'),
  title: z.string().trim().min(1, 'Add the title'),
  genre: z.enum(GENRE_KEYS, 'Choose a genre'),
  grade: z.enum(GRADE_KEYS),
  price: z.string().transform((s) => parsePrice(s)),
});

type Field = 'artist' | 'title' | 'genre';
type Errors = Partial<Record<Field, string>>;

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted';
const INPUT = 'h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk px-4 text-base';
const ERROR = 'text-[15px] text-brick-ink';

export function BuyNewSheet({
  open,
  initialArtist,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialArtist: string;
  onOpenChange: (open: boolean) => void;
  onSave: (buy: NewBuy) => Promise<void>;
}) {
  const [artist, setArtist] = useState(initialArtist);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
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
    setGenre('');
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
    const parsed = BuyNewFormSchema.safeParse({ artist, title, genre, grade, price });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'artist' || key === 'title' || key === 'genre') && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setFailure(null);
    saving.current = true;
    setBusy(true);
    const { artist: a, title: t, genre: g, grade: gr, price: p } = parsed.data;
    try {
      await onSave({ artist: a, title: t, genre: g, grade: gr, pricePaid: p });
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
              <label htmlFor="buy-genre" className={LABEL}>Genre</label>
              <Select value={genre} onValueChange={setGenre}>
                <SelectTrigger
                  id="buy-genre"
                  aria-invalid={errors.genre ? true : undefined}
                  aria-describedby={errors.genre ? 'buy-genre-error' : undefined}
                  className="w-full rounded-lg border-[1.5px] border-line-strong bg-surface-sunk px-4 text-base text-ink data-[size=default]:h-12 [&_svg]:text-ink-muted"
                >
                  <SelectValue placeholder="Choose a genre" />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  {GENRE_KEYS.map((key) => (
                    <SelectItem key={key} value={key} className={GENRE_ITEM_CLASS}>
                      {GENRE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.genre && <p id="buy-genre-error" className={ERROR}>{errors.genre}</p>}
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
