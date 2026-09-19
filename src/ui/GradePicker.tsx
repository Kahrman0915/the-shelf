import { cn } from '@/lib/utils';
import { GRADES, gradeInfo, type Grade } from '@/domain/grades';

/** The Goldmine scale with its help text inside the control, at the point of decision. VG is dashed: people misread it. */
export function GradePicker({ value, onChange, part }: { value: Grade; onChange: (g: Grade) => void; part: string }) {
  const info = gradeInfo(value);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">{part} condition</div>
      <div role="radiogroup" aria-label={`${part} condition`} className="grid grid-cols-8 gap-1">
        {GRADES.map((g) => (
          <button
            key={g.key}
            type="button"
            role="radio"
            aria-checked={g.key === value}
            onClick={() => onChange(g.key)}
            className={cn(
              'min-h-12 rounded-md border-[1.5px] font-mono text-[13px] font-semibold transition-colors duration-150',
              g.key === 'VG' && 'border-dashed',
              g.key === value ? 'border-ink bg-ink text-surface' : 'border-line-strong text-ink hover:bg-bourbon-soft',
            )}
          >
            {g.key}
          </button>
        ))}
      </div>
      <p className="max-w-[60ch] text-[15px] leading-[22px] text-ink-muted">
        <strong className="font-bold text-ink">{`${info.key} · ${info.word}. `}</strong>
        {info.help}
      </p>
    </div>
  );
}
