import { Button } from '@/components/ui/button';
import type { Suggestion } from '@/data/schema';

type Props = { suggestion: Suggestion; onAdd: () => void; onDismiss: () => void };

/** One of Claude's suggestions: the record, why, and two big buttons. */
export function SuggestionCard({ suggestion, onAdd, onDismiss }: Props) {
  return (
    <li className="border-b border-line px-4 py-3">
      <p className="text-[17px] leading-[22px] font-bold text-ink">{suggestion.artist}</p>
      <p className="text-[15px] leading-5 text-ink-muted">{suggestion.title}</p>
      <p className="mt-1 text-[15px] leading-5 text-ink">{suggestion.reason}</p>
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
