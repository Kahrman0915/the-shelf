import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { GRADES, gradeInfo, type Grade } from '@/domain/grades';

/** The Goldmine scale with its help text inside the control, at the point of decision. VG is dashed: people misread it. */
export function GradePicker({ value, onChange, part }: { value: Grade | null; onChange: (g: Grade) => void; part: string }) {
  const info = value === null ? null : gradeInfo(value);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  // Roving tabindex: the checked grade is the one Tab stop, or the first when none is checked.
  const stop = Math.max(0, GRADES.findIndex((g) => g.key === value));

  const move = (e: KeyboardEvent<HTMLButtonElement>, from: number) => {
    // Alt, Ctrl and Cmd with these keys are browser and system shortcuts (Alt+Left is Back): leave them be.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const last = GRADES.length - 1;
    let to: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = from === last ? 0 : from + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = from === 0 ? last : from - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = last;
    else return;
    e.preventDefault();
    onChange(GRADES[to].key);
    radios.current[to]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">{part} condition</div>
      <div role="radiogroup" aria-label={`${part} condition`} className="grid grid-cols-4 gap-2 sm:grid-cols-8 sm:gap-1">
        {GRADES.map((g, i) => (
          <button
            key={g.key}
            ref={(el) => {
              radios.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={g.key === value}
            tabIndex={i === stop ? 0 : -1}
            onClick={() => onChange(g.key)}
            onKeyDown={(e) => move(e, i)}
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
        {info ? (
          <>
            <strong className="font-bold text-ink">{`${info.key} · ${info.word}. `}</strong>
            {info.help}
          </>
        ) : (
          'Tap a grade.'
        )}
      </p>
    </div>
  );
}
