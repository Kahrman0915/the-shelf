import { SWATCH_KEYS } from '@/domain/sections';
import { BackendError } from './backend';
import type { Ctx } from './actions';
import type { NewPostcard } from './outbox';
import { SectionSchema, type Section } from './schema';

export type SectionResult = { postcards: NewPostcard[] };

/** What a person can change on a section from the edit screen. */
export type SectionChanges = Partial<Pick<Section, 'name' | 'color' | 'discogsGenres' | 'takesHoliday'>>;

function card(s: Section, ctx: Ctx, kind: 'section.patch', fields: Partial<Section>): NewPostcard;
function card(s: Section, ctx: Ctx, kind: 'section.create', fields: Section): NewPostcard;
function card(s: Section, ctx: Ctx, kind: 'section.merge', fields: { into: string }): NewPostcard;
function card(s: Section, ctx: Ctx, kind: NewPostcard['kind'], fields: unknown): NewPostcard {
  return { kind, shelfId: s.shelfId, recordId: s.id, userId: ctx.me, createdAt: ctx.now, fields } as NewPostcard;
}

function checkSection(candidate: Section): Section {
  const parsed = SectionSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BackendError(`Section rules broken: ${issue.path.join('.') || 'section'} ${issue.message}`);
  }
  return parsed.data;
}

function newName(sections: Section[]): string {
  const used = new Set(sections.map((s) => s.name.trim().toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'New section' : `New section ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

export function createSection(shelfId: string, sections: Section[], ctx: Ctx & { newId: () => string }): SectionResult {
  const inUse = new Set(sections.map((s) => s.color));
  const section = checkSection({
    id: ctx.newId(),
    shelfId,
    name: newName(sections),
    color: SWATCH_KEYS.find((k) => !inUse.has(k)) ?? 'slate',
    position: sections.reduce((max, s) => Math.max(max, s.position), -1) + 1,
    discogsGenres: [],
    takesHoliday: false,
    isCatchAll: false,
    legacyGenre: 'misc',
    updatedAt: ctx.now,
  });
  return { postcards: [card(section, ctx, 'section.create', section)] };
}

/**
 * Change a section. Taking holiday or claiming genres also clears them from the other sections, as the
 * server's trigger does, so the phone is right while offline.
 */
export function editSection(section: Section, changes: SectionChanges, sections: Section[], ctx: Ctx): SectionResult {
  const next = checkSection({ ...section, ...changes });
  const fields: Partial<Section> = {};
  if (next.name !== section.name) fields.name = next.name;
  if (next.color !== section.color) fields.color = next.color;
  if (next.takesHoliday !== section.takesHoliday) fields.takesHoliday = next.takesHoliday;
  if (next.discogsGenres.join('\n') !== section.discogsGenres.join('\n')) fields.discogsGenres = next.discogsGenres;

  const postcards: NewPostcard[] = [];
  if (Object.keys(fields).length > 0) postcards.push(card(section, ctx, 'section.patch', fields));

  for (const other of sections) {
    if (other.id === section.id) continue;
    const clear: Partial<Section> = {};
    if (fields.takesHoliday === true && other.takesHoliday) clear.takesHoliday = false;
    if (fields.discogsGenres && other.discogsGenres.some((g) => next.discogsGenres.includes(g))) {
      clear.discogsGenres = other.discogsGenres.filter((g) => !next.discogsGenres.includes(g));
    }
    if (Object.keys(clear).length > 0) postcards.push(card(other, ctx, 'section.patch', clear));
  }
  return { postcards };
}

/** Swap places with the neighbour above or below; at either end there is nothing to do. */
export function moveSection(section: Section, direction: 'up' | 'down', sections: Section[], ctx: Ctx): SectionResult {
  const ordered = [...sections].sort((a, b) => a.position - b.position);
  const at = ordered.findIndex((s) => s.id === section.id);
  const neighbour = ordered[direction === 'up' ? at - 1 : at + 1];
  if (at < 0 || !neighbour) return { postcards: [] };
  return {
    postcards: [
      card(section, ctx, 'section.patch', { position: neighbour.position }),
      card(neighbour, ctx, 'section.patch', { position: section.position }),
    ],
  };
}

/** Move every record from one section into another and remove the first. The catch-all can't go. */
export function mergeSections(from: Section, into: Section, ctx: Ctx): SectionResult {
  if (from.id === into.id) throw new BackendError('A section can’t be merged into itself.');
  if (from.isCatchAll) throw new BackendError('The catch-all section can’t be merged away.');
  if (from.shelfId !== into.shelfId) throw new BackendError('Those sections are on different shelves.');
  return { postcards: [card(from, ctx, 'section.merge', { into: into.id })] };
}

/** Delete = merge into the catch-all. The screen only offers it when the section has no live records. */
export function deleteSection(section: Section, sections: Section[], ctx: Ctx): SectionResult {
  const catchAll = sections.find((s) => s.isCatchAll);
  if (!catchAll) throw new BackendError('This shelf has no catch-all section.');
  return mergeSections(section, catchAll, ctx);
}
