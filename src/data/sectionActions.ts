import { SWATCH_KEYS } from '@/domain/sections';
import { BackendError } from './backend';
import type { Ctx } from './actions';
import type { NewPostcard } from './outbox';
import { checkSection, type Section } from './schema';

export type SectionResult = { postcards: NewPostcard[] };

/** What a person can change on a section from the edit screen. */
export type SectionChanges = Partial<Pick<Section, 'name' | 'color' | 'discogsGenres' | 'takesHoliday'>>;

function card(s: Section, ctx: Ctx, kind: 'section.patch', fields: Partial<Section>): NewPostcard;
function card(s: Section, ctx: Ctx, kind: 'section.create', fields: Section): NewPostcard;
function card(s: Section, ctx: Ctx, kind: 'section.merge', fields: { into: string }): NewPostcard;
function card(s: Section, ctx: Ctx, kind: NewPostcard['kind'], fields: unknown): NewPostcard {
  return { kind, shelfId: s.shelfId, recordId: s.id, userId: ctx.me, createdAt: ctx.now, fields } as NewPostcard;
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
 * Change a section: one postcard. Taking holiday or claiming genres clears them from the others on the
 * server (its claim trigger) and on the phone (applyPostcard does the same), so nothing else is sent.
 */
export function editSection(section: Section, changes: SectionChanges, ctx: Ctx): SectionResult {
  const next = checkSection({ ...section, ...changes });
  const fields: Partial<Section> = {};
  if (next.name !== section.name) fields.name = next.name;
  if (next.color !== section.color) fields.color = next.color;
  if (next.takesHoliday !== section.takesHoliday) fields.takesHoliday = next.takesHoliday;
  if (next.discogsGenres.join('\n') !== section.discogsGenres.join('\n')) fields.discogsGenres = next.discogsGenres;

  const postcards: NewPostcard[] = [];
  if (Object.keys(fields).length > 0) postcards.push(card(section, ctx, 'section.patch', fields));

  return { postcards };
}

/** Swap places with the neighbour above or below; at either end there is nothing to do. */
export function moveSection(section: Section, direction: 'up' | 'down', sections: Section[], ctx: Ctx): SectionResult {
  const ordered = [...sections].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const at = ordered.findIndex((s) => s.id === section.id);
  const to = direction === 'up' ? at - 1 : at + 1;
  const neighbour = ordered[to];
  if (at < 0 || !neighbour) return { postcards: [] };
  // Two sections sharing a position can't trade it, so they take their places in the list instead.
  const tied = neighbour.position === section.position;
  return {
    postcards: [
      card(section, ctx, 'section.patch', { position: tied ? to : neighbour.position }),
      card(neighbour, ctx, 'section.patch', { position: tied ? at : section.position }),
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
