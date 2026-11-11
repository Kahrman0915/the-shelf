import type { ShelfRecord } from '@/data/schema';
import { spineColor } from '@/domain/labels';

type Props = { records: ShelfRecord[]; onOpen: () => void };

/** The pile on the shelf: one raised row that says how many records are waiting to be rated. */
export function PileRow({ records, onOpen }: Props) {
  if (records.length === 0) return null;
  const n = records.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`New arrivals, ${n} waiting`}
      className="mx-4 mb-4 flex min-h-12 items-center gap-3 rounded-lg bg-surface-raised px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span aria-hidden className="flex flex-none gap-1">
        {records.slice(0, 3).map((r) => (
          <span key={r.id} className="h-8 w-1.5 rounded-xs" style={{ background: spineColor(r, 'all') }} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-bold leading-[22px] text-ink">New arrivals · {n}</span>
        <span className="block truncate text-[15px] leading-5 text-ink-muted">{records.map((r) => r.artist).join(', ')}</span>
      </span>
    </button>
  );
}
