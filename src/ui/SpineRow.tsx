import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { ShelfRecord } from '@/data/schema';
import { isDisliked } from '@/domain/rating';
import type { TagKind } from '@/domain/shelf';
import { RatingDots } from './RatingDots';
import { StatusTag } from './StatusTag';

type Props = { record: ShelfRecord; rating: number | undefined; color: string; tag: TagKind | null; onOpen?: () => void };

/** A spine in a crate: colour bar, then artist, title, year · label · catalog. Square, not a card. */
export function SpineRow({ record, rating, color, tag, onOpen }: Props) {
  const meta = [record.year, record.label, record.catalog].filter((x) => x !== null && x !== '').join(' · ');
  const low = isDisliked(rating);
  const rowClass = 'flex min-h-[72px] w-full items-stretch gap-3 border-b border-line bg-surface pr-4 text-left';

  const inner: ReactNode = (
    <>
      <span aria-hidden className="w-2 flex-none" style={{ background: color }} />
      <span className="min-w-0 flex-1 py-3">
        <span className={cn('block truncate text-[17px] leading-[22px]', low ? 'font-semibold text-ink-muted' : 'font-bold text-ink')}>{record.artist}</span>
        <span className="block truncate text-[15px] leading-5 text-ink-muted">{record.title}</span>
        {meta && <span className="mt-1 block font-mono text-xs font-medium uppercase tracking-[0.04em] text-ink-muted">{meta}</span>}
      </span>
      <span className="flex flex-none flex-col items-end justify-center gap-2 py-3">
        {tag && <StatusTag kind={tag} />}
        <span className="flex items-center gap-2">
          {record.discGrade && (
            <span className="rounded-xs px-1.5 py-0.5 font-mono text-[13px] font-semibold text-ink ring-1 ring-inset ring-line-strong">{record.discGrade}</span>
          )}
          <RatingDots value={rating} compact />
        </span>
      </span>
    </>
  );

  return onOpen ? (
    <button type="button" onClick={onOpen} className={cn(rowClass, 'focus-visible:outline-2 focus-visible:outline-ring')}>
      {inner}
    </button>
  ) : (
    <div className={rowClass}>{inner}</div>
  );
}
