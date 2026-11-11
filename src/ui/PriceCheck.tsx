import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ShelfRecord } from '@/data/schema';
import type { Grade } from '@/domain/grades';
import { estimateRange, formatMoney, nmRangeOf, parsePrice, sanitizeAsking, verdictFor } from '@/domain/price';
import { GradePicker } from './GradePicker';

const TONE = {
  teal: { bar: 'bg-teal', word: 'text-teal-ink' },
  bourbon: { bar: 'bg-bourbon', word: 'text-bourbon-ink' },
  brick: { bar: 'bg-brick', word: 'text-brick-ink' },
} as const;

export type BoughtInput = { grade: Grade; pricePaid: number | null };

export function PriceCheck({
  record,
  buyable = false,
  onBought,
}: {
  record: ShelfRecord;
  buyable?: boolean;
  onBought?: (input: BoughtInput) => Promise<void>;
}) {
  const [grade, setGrade] = useState<Grade>('NM');
  const [asking, setAsking] = useState('');
  const nm = nmRangeOf(record);
  const range = nm ? estimateRange(nm, grade) : null;
  const price = parsePrice(asking);
  const verdict = range ? verdictFor(price, range) : null;
  // A ref, not just state: two taps before React re-renders must still log one purchase.
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  // Held after a successful purchase until the record (or whether it is buyable) changes, so a tap on a
  // stale record can't post a second purchase. Released at once on failure so it can be tried again.
  useEffect(() => {
    running.current = false;
    setBusy(false);
  }, [record, buyable]);

  async function bought() {
    if (!onBought || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await onBought({ grade, pricePaid: price });
    } catch {
      // The screen shows the error; just let the button be pressed again.
      running.current = false;
      setBusy(false);
    }
  }

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

      {(range || buyable) && (
        <label className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">They're asking</span>
          <span className="relative block">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-display text-[26px] text-ink-muted">$</span>
            <input
              id="asking"
              inputMode="decimal"
              value={asking}
              placeholder="0"
              onChange={(e) => setAsking(sanitizeAsking(e.target.value))}
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

      {buyable && (
        <div className="flex flex-col gap-2">
          <Button className="h-14 rounded-lg font-display text-[22px] tracking-[0.04em]" disabled={busy} onClick={() => void bought()}>
            Bought it
          </Button>
          <p className="text-[15px] leading-[22px] text-ink-muted">
            {price !== null ? `Logs ${grade} · ${formatMoney(price)} paid` : `Logs ${grade}`}
          </p>
        </div>
      )}

      {record.valueNote && <p className="text-[15px] leading-[22px] text-ink-muted">{record.valueNote}</p>}
    </section>
  );
}
