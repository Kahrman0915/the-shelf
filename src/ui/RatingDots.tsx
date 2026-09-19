import { cn } from '@/lib/utils';
import { RATING_WORDS, isDisliked } from '@/domain/rating';

/** Plain dots. Rows (compact) show only the filled ones; unplayed shows nothing. */
export function RatingDots({ value, compact = false, who }: { value: number | undefined; compact?: boolean; who?: string }) {
  const v = value ?? 0;
  const low = isDisliked(value);
  const prefix = who ? `${who}: ` : '';
  const label = `${prefix}${v ? `${v} of 5, ${RATING_WORDS[v]}` : 'Unplayed'}`;

  if (compact) {
    if (v === 0) return null;
    return (
      <span role="img" aria-label={label} className="inline-flex items-center gap-[3px]">
        {Array.from({ length: v }, (_, i) => (
          <span key={i} className={cn('size-1.5 rounded-full', low ? 'bg-line-strong' : 'bg-ink')} />
        ))}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-3">
      <span role="img" aria-label={label} className="inline-flex gap-1.5">
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={cn(
              'size-4 rounded-full border-[1.5px]',
              i < v ? (low ? 'border-line-strong bg-line-strong' : 'border-ink bg-ink') : 'border-line-strong',
            )}
          />
        ))}
      </span>
      <span className={cn('text-[15px] font-semibold', low ? 'text-ink-muted' : 'text-ink')}>{prefix + RATING_WORDS[v]}</span>
    </span>
  );
}
