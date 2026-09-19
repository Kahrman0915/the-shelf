import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GENRE_KEYS, GENRE_LABELS } from '@/domain/genres';
import type { GenreFilter } from '@/domain/labels';

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-3 flex-none rounded-full" style={{ background: color }} />;
}

const itemClass = 'min-h-11 rounded-sm pl-3 text-base';

/** Genre is the mood. A dropdown, never chips: nine is too many for a thumb-width row. */
export function GenreSelect({ value, onChange }: { value: GenreFilter; onChange: (v: GenreFilter) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as GenreFilter)}>
      <SelectTrigger
        aria-label="Genre"
        className="w-full min-w-56 rounded-lg border-[1.5px] border-line-strong bg-surface-raised px-4 text-base font-semibold text-ink data-[size=default]:h-12 [&_svg]:text-ink-muted"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-lg">
        <SelectItem value="all" className={itemClass}>
          <Swatch color="var(--ink)" />
          All genres
        </SelectItem>
        {GENRE_KEYS.map((key) => (
          <SelectItem key={key} value={key} className={itemClass}>
            <Swatch color={`var(--genre-${key})`} />
            {GENRE_LABELS[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
