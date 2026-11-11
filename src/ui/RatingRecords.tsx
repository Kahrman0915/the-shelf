import { cn } from '@/lib/utils';
import { RATING_WORDS } from '@/domain/rating';

/** Five small records to tap. Filled ones (up to the current value) get a bourbon label. */
export function RatingRecords({ value, onRate, disabled = false }: { value: number | undefined; onRate: (v: number) => void; disabled?: boolean }) {
  const current = value ?? 0;
  return (
    <div role="radiogroup" aria-label="Your rating" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} of 5, ${RATING_WORDS[n]}`}
          disabled={disabled}
          onClick={() => onRate(n)}
          className="flex size-12 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
        >
          <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-ink">
            <span className={cn('size-3.5 rounded-full', n <= current ? 'bg-bourbon' : 'bg-line-strong')} />
          </span>
        </button>
      ))}
    </div>
  );
}
