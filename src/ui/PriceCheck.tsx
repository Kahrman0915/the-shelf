import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ShelfRecord } from '@/data/schema';
import type { Grade } from '@/domain/grades';
import { estimateRange, nmRangeOf, verdictFor } from '@/domain/price';
import { GradePicker } from './GradePicker';

const TONE = {
  teal: { bar: 'bg-teal', word: 'text-teal-ink' },
  bourbon: { bar: 'bg-bourbon', word: 'text-bourbon-ink' },
  brick: { bar: 'bg-brick', word: 'text-brick-ink' },
} as const;

export function PriceCheck({ record }: { record: ShelfRecord }) {
  const [grade, setGrade] = useState<Grade>('NM');
  const [asking, setAsking] = useState('');
  const nm = nmRangeOf(record);
  const range = nm ? estimateRange(nm, grade) : null;
  const verdict = range && asking !== '' ? verdictFor(Number(asking), range) : null;

  return (
    <section className="flex flex-col gap-6 rounded-xl bg-surface-raised p-4">
      <GradePicker value={grade} onChange={setGrade} part="Copy in hand" />

      {range ? (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">Fair for {grade}</div>
          <div className="font-display text-[44px] leading-[44px] tracking-[0.01em] tabular-nums text-ink">{`~$${range.low} – $${range.high}`}</div>
          <div className="font-mono text-xs text-ink-muted">Estimate from the NM range</div>
        </div>
      ) : (
        <p className="text-base text-ink-muted">No price yet: add a Near Mint estimate</p>
      )}

      {range && (
        <label className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">They're asking</span>
          <span className="relative block">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-display text-[26px] text-ink-muted">$</span>
            <input
              id="asking"
              inputMode="decimal"
              value={asking}
              placeholder="0"
              onChange={(e) => setAsking(e.target.value.replace(/[^0-9.]/g, ''))}
              className="min-h-14 w-full rounded-lg border-[1.5px] border-line-strong bg-surface-sunk pr-4 pl-9 font-display text-[30px] tracking-[0.02em] tabular-nums text-ink focus-visible:outline-2 focus-visible:outline-ring"
            />
          </span>
        </label>
      )}

      {verdict && (
        <div role="status" className="flex items-stretch gap-3 animate-in fade-in-0 duration-200">
          <span className={cn('w-2 flex-none', TONE[verdict.tone].bar)} />
          <div>
            <div className={cn('pt-0.5 font-display text-[28px] leading-7 tracking-[0.02em]', TONE[verdict.tone].word)}>{verdict.word}</div>
            <div className="text-[15px] leading-[22px] text-ink-muted">{verdict.line}</div>
          </div>
        </div>
      )}

      {record.valueNote && <p className="text-[15px] leading-[22px] text-ink-muted">{record.valueNote}</p>}
    </section>
  );
}
