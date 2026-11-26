import { Button } from '@/components/ui/button';
import type { FoundRecord } from '@/data/backend';
import type { Suggestion } from '@/data/schema';
import { joined } from '@/ui/joined';

type Props = { suggestion: Suggestion; detail?: FoundRecord; onAdd: () => void; onDismiss: () => void };

/** One of Claude's suggestions: the record, why, and two big buttons. */
export function SuggestionCard({ suggestion, detail, onAdd, onDismiss }: Props) {
  const first = detail ? joined([detail.year, detail.label, detail.catalog]) : '';
  const second = detail ? joined([detail.format, detail.country]) : '';
  return (
    <li className="border-b border-line px-4 py-3">
      {detail ? (
        <div className="flex items-center gap-3">
          {detail.thumb && <img src={detail.thumb} alt="" className="size-14 flex-none rounded object-cover" />}
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-bold text-ink">{`${suggestion.artist} — ${suggestion.title}`}</p>
            {first && <p className="text-[15px] leading-[22px] text-ink-muted">{first}</p>}
            {second && <p className="text-[15px] leading-[22px] text-ink-muted">{second}</p>}
          </div>
        </div>
      ) : (
        <>
          <p className="text-[17px] leading-[22px] font-bold text-ink">{suggestion.artist}</p>
          <p className="text-[15px] leading-5 text-ink-muted">{suggestion.title}</p>
        </>
      )}
      <p className="mt-2 text-[15px] leading-5 text-ink">{suggestion.reason}</p>
      <div className="mt-3 flex gap-2">
        <Button className="h-12 rounded-lg px-5 text-[15px] font-semibold" onClick={onAdd}>
          Add to want list
        </Button>
        <Button variant="ghost" className="h-12 rounded-lg px-5 text-[15px] font-semibold" onClick={onDismiss}>
          Not for me
        </Button>
      </div>
    </li>
  );
}
