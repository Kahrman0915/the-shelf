import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Section } from '@/data/schema';
import type { SectionFilter } from '@/domain/labels';

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-3 flex-none rounded-full" style={{ background: color }} />;
}

export const SECTION_ITEM_CLASS = 'min-h-12 rounded-sm pl-3 text-base';

/** The shelf filter: all sections, or one. A dropdown, never chips: a shelf's sections are too many for a thumb-width row. */
export function SectionSelect({ sections, value, onChange }: { sections: Section[]; value: SectionFilter; onChange: (v: SectionFilter) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Section"
        className="w-full min-w-56 rounded-lg border-[1.5px] border-line-strong bg-surface-raised px-4 text-base font-semibold text-ink data-[size=default]:h-12 [&_svg]:text-ink-muted"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-lg">
        <SelectItem value="all" className={SECTION_ITEM_CLASS}>
          <Swatch color="var(--ink)" />
          All sections
        </SelectItem>
        {sections.map((s) => (
          <SelectItem key={s.id} value={s.id} className={SECTION_ITEM_CLASS}>
            <Swatch color={`var(--section-${s.color})`} />
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
