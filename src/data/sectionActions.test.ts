import { describe, expect, it } from 'vitest';
import { BackendError } from './backend';
import { createSection, deleteSection, editSection, mergeSections, moveSection } from './sectionActions';
import type { Section } from './schema';

const SHELF = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const WHEN = '2026-11-23T10:00:00.000Z';
const ctx = { me: ME, now: WHEN };

function section(n: number, over: Partial<Section> = {}): Section {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    shelfId: SHELF,
    name: `Section ${n}`,
    color: 'jazz',
    position: n,
    discogsGenres: [],
    takesHoliday: false,
    isCatchAll: false,
    legacyGenre: 'misc',
    updatedAt: WHEN,
    ...over,
  };
}

const jazz = section(0, { name: 'Jazz', color: 'jazz', discogsGenres: ['Jazz', 'Blues'] });
const rock = section(1, { name: 'Rock', color: 'rock', discogsGenres: ['Rock'] });
const xmas = section(2, { name: 'Christmas', color: 'christmas', takesHoliday: true });
const rest = section(3, { name: 'Everything else', color: 'misc', isCatchAll: true });
const all = [jazz, rock, xmas, rest];

describe('createSection', () => {
  it('makes a plain new section at the end, in the first unused colour', () => {
    const { postcards } = createSection(SHELF, all, { ...ctx, newId: () => '99999999-9999-4999-8999-999999999999' });
    expect(postcards).toHaveLength(1);
    const [p] = postcards;
    expect(p).toMatchObject({ kind: 'section.create', shelfId: SHELF, recordId: '99999999-9999-4999-8999-999999999999', userId: ME, createdAt: WHEN });
    expect(p.kind === 'section.create' && p.fields).toEqual({
      id: '99999999-9999-4999-8999-999999999999',
      shelfId: SHELF,
      name: 'New section',
      color: 'popsoul',
      position: 4,
      discogsGenres: [],
      takesHoliday: false,
      isCatchAll: false,
      legacyGenre: 'misc',
      updatedAt: WHEN,
    });
  });

  it('numbers the name when New section is taken, and uses slate when every colour is in use', () => {
    const taken = [section(0, { name: 'New section' }), section(1, { name: 'new section 2' })];
    const { postcards } = createSection(SHELF, taken, { ...ctx, newId: () => '99999999-9999-4999-8999-999999999999' });
    expect(postcards[0].fields).toMatchObject({ name: 'New section 3', position: 2 });

    const colours = ['jazz', 'rock', 'popsoul', 'popularpop', 'misc', 'country', 'reggae', 'soundtracks', 'christmas', 'teal', 'slate', 'sand'] as const;
    const full = colours.map((c, i) => section(i % 10, { id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, color: c, position: i }));
    const made = createSection(SHELF, full, { ...ctx, newId: () => '99999999-9999-4999-8999-999999999999' });
    expect(made.postcards[0].fields).toMatchObject({ color: 'slate', position: 12 });
  });

  it('starts at position 0 on an empty shelf', () => {
    const { postcards } = createSection(SHELF, [], { ...ctx, newId: () => '99999999-9999-4999-8999-999999999999' });
    expect(postcards[0].fields).toMatchObject({ position: 0, color: 'jazz' });
  });
});

describe('editSection', () => {
  it('patches only what changed, with the name trimmed', () => {
    const { postcards } = editSection(rock, { name: '  Hard rock ', color: 'rock' }, ctx);
    expect(postcards).toEqual([{ kind: 'section.patch', shelfId: SHELF, recordId: rock.id, userId: ME, createdAt: WHEN, fields: { name: 'Hard rock' } }]);
  });

  it('does nothing when nothing changed', () => {
    expect(editSection(rock, { name: 'Rock', discogsGenres: ['Rock'] }, ctx).postcards).toEqual([]);
  });

  it('refuses a name that is empty or over 40 characters', () => {
    expect(() => editSection(rock, { name: '   ' }, ctx)).toThrow(BackendError);
    expect(() => editSection(rock, { name: 'x'.repeat(41) }, ctx)).toThrow(BackendError);
  });

  it('taking holiday is one postcard; the phone clears the others when it applies it', () => {
    const { postcards } = editSection(rock, { takesHoliday: true }, ctx);
    expect(postcards.map((p) => [p.recordId, p.fields])).toEqual([[rock.id, { takesHoliday: true }]]);
  });

  it('letting go of holiday clears nothing else', () => {
    const { postcards } = editSection(xmas, { takesHoliday: false }, ctx);
    expect(postcards.map((p) => p.recordId)).toEqual([xmas.id]);
  });

  it('claiming a genre is one postcard; the others are left to the apply and the server', () => {
    const { postcards } = editSection(rock, { discogsGenres: ['Rock', 'Blues'] }, ctx);
    expect(postcards.map((p) => [p.recordId, p.fields])).toEqual([[rock.id, { discogsGenres: ['Rock', 'Blues'] }]]);
  });

  it('giving a genre up clears nothing from the others', () => {
    const { postcards } = editSection(jazz, { discogsGenres: ['Jazz'] }, ctx);
    expect(postcards.map((p) => p.recordId)).toEqual([jazz.id]);
  });
});

describe('moveSection', () => {
  it('swaps positions with the neighbour, in two patches', () => {
    const { postcards } = moveSection(rock, 'up', all, ctx);
    expect(postcards.map((p) => [p.kind, p.recordId, p.fields])).toEqual([
      ['section.patch', rock.id, { position: 0 }],
      ['section.patch', jazz.id, { position: 1 }],
    ]);
    expect(moveSection(rock, 'down', all, ctx).postcards.map((p) => [p.recordId, p.fields])).toEqual([
      [rock.id, { position: 2 }],
      [xmas.id, { position: 1 }],
    ]);
  });

  it('can still swap two sections that share a position', () => {
    const a = section(5, { position: 1 });
    const b = section(6, { position: 1 });
    const { postcards } = moveSection(b, 'up', [a, b], ctx);
    expect(postcards.map((p) => [p.recordId, p.fields])).toEqual([
      [b.id, { position: 0 }],
      [a.id, { position: 1 }],
    ]);
  });

  it('does nothing at either end', () => {
    expect(moveSection(jazz, 'up', all, ctx).postcards).toEqual([]);
    expect(moveSection(rest, 'down', all, ctx).postcards).toEqual([]);
  });
});

describe('mergeSections', () => {
  it('sends one merge postcard held under the section being merged away', () => {
    expect(mergeSections(rock, jazz, ctx).postcards).toEqual([
      { kind: 'section.merge', shelfId: SHELF, recordId: rock.id, userId: ME, createdAt: WHEN, fields: { into: jazz.id } },
    ]);
  });

  it('refuses to merge the catch-all away, or a section into itself', () => {
    expect(() => mergeSections(rest, jazz, ctx)).toThrow(BackendError);
    expect(() => mergeSections(rock, rock, ctx)).toThrow(BackendError);
  });
});

describe('deleteSection', () => {
  it('merges into the catch-all', () => {
    expect(deleteSection(rock, all, ctx)).toEqual(mergeSections(rock, rest, ctx));
  });

  it('refuses for the catch-all, and when the shelf has none', () => {
    expect(() => deleteSection(rest, all, ctx)).toThrow(BackendError);
    expect(() => deleteSection(rock, [jazz, rock], ctx)).toThrow(BackendError);
  });
});
