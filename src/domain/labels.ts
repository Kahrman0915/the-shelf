import type { SwatchKey } from './sections';

export type LabelKey = 'impulse' | 'bluenote' | 'argo' | 'other';
/** All sections, or one section's id. */
export type SectionFilter = 'all' | string;

/** What colouring a record needs to know about its section. */
export type ColouredSection = { id: string; color: SwatchKey; discogsGenres: readonly string[]; isCatchAll: boolean };

export function labelKey(label: string | null): LabelKey {
  const s = (label ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (/\bimpulse/.test(s)) return 'impulse';
  if (/\bblue note\b/.test(s)) return 'bluenote';
  if (/\bargo\b/.test(s)) return 'argo';
  return 'other';
}

/** The record's section; while that isn't on the phone yet (a sync away), the shelf's catch-all. */
export function sectionOf<S extends ColouredSection>(r: { sectionId: string }, sectionsById: ReadonlyMap<string, S>): S | undefined {
  return sectionsById.get(r.sectionId) ?? [...sectionsById.values()].find((s) => s.isCatchAll);
}

/** The colour key a record is drawn in: its section's, or the catch-all's colour before any section has arrived. */
export function colorKeyOf(r: { sectionId: string }, sectionsById: ReadonlyMap<string, ColouredSection>): SwatchKey {
  return sectionOf(r, sectionsById)?.color ?? 'misc';
}

/** Colour encodes whatever the current filter is asking. Jazz is the only genre with a sub-dimension (label),
 *  so a section that takes Discogs' Jazz shows its records by label. */
export function spineColor(r: { sectionId: string; label: string | null }, sectionsById: ReadonlyMap<string, ColouredSection>, filter: SectionFilter): string {
  if (filter !== 'all' && sectionsById.get(filter)?.discogsGenres.includes('Jazz')) return `var(--label-${labelKey(r.label)})`;
  return `var(--section-${colorKeyOf(r, sectionsById)})`;
}
