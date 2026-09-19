import type { GenreKey } from './genres';

export type LabelKey = 'impulse' | 'bluenote' | 'argo' | 'other';
export type GenreFilter = GenreKey | 'all';

export function labelKey(label: string | null): LabelKey {
  const s = (label ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (/\bimpulse/.test(s)) return 'impulse';
  if (/\bblue note\b/.test(s)) return 'bluenote';
  if (/\bargo\b/.test(s)) return 'argo';
  return 'other';
}

/** Colour encodes whatever the current filter is asking. Jazz is the only genre with a sub-dimension (label). */
export function spineColor(r: { genre: GenreKey; label: string | null }, filter: GenreFilter): string {
  if (filter === 'jazz') return `var(--label-${labelKey(r.label)})`;
  return `var(--genre-${r.genre})`;
}
