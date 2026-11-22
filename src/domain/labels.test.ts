import { describe, expect, it } from 'vitest';
import { labelKey, spineColor } from './labels';

describe('labelKey', () => {
  it('recognises the three jazz labels however they are typed', () => {
    expect(labelKey('Impulse!')).toBe('impulse');
    expect(labelKey('impulse!/ABC')).toBe('impulse');
    expect(labelKey('Blue Note')).toBe('bluenote');
    expect(labelKey('BLUE  NOTE')).toBe('bluenote');
    expect(labelKey('Argo')).toBe('argo');
  });
  it('sends everything else to other', () => {
    expect(labelKey('Island / Tuff Gong')).toBe('other');
    expect(labelKey('Cargo')).toBe('other');
    expect(labelKey(null)).toBe('other');
  });
});

describe('spineColor', () => {
  const sections = [
    { id: 'j', color: 'jazz' as const, discogsGenres: ['Jazz'], isCatchAll: false },
    { id: 'r', color: 'reggae' as const, discogsGenres: ['Reggae'], isCatchAll: false },
    { id: 'm', color: 'misc' as const, discogsGenres: [], isCatchAll: true },
    // A section someone made later and gave Jazz to.
    { id: 'b', color: 'teal' as const, discogsGenres: ['Blues', 'Jazz'], isCatchAll: false },
  ];
  const byId = new Map(sections.map((s) => [s.id, s]));
  const ballads = { sectionId: 'j', label: 'Impulse!' };
  const legend = { sectionId: 'r', label: 'Island / Tuff Gong' };
  it('uses the section colour when viewing all sections', () => {
    expect(spineColor(ballads, byId, 'all')).toBe('var(--section-jazz)');
    expect(spineColor(legend, byId, 'all')).toBe('var(--section-reggae)');
  });
  it('switches to the label colour when filtered to a section that takes Jazz', () => {
    expect(spineColor(ballads, byId, 'j')).toBe('var(--label-impulse)');
    expect(spineColor({ sectionId: 'b', label: 'Blue Note' }, byId, 'b')).toBe('var(--label-bluenote)');
  });
  it('keeps the section colour for other section filters', () => {
    expect(spineColor(legend, byId, 'r')).toBe('var(--section-reggae)');
    expect(spineColor(ballads, byId, 'm')).toBe('var(--section-jazz)');
  });
  it('a record whose section isn’t on the phone yet takes the catch-all’s colour', () => {
    expect(spineColor({ sectionId: 'gone', label: null }, byId, 'all')).toBe('var(--section-misc)');
    expect(spineColor({ sectionId: 'gone', label: null }, new Map([['m', { ...sections[2], color: 'sand' as const }]]), 'all')).toBe('var(--section-sand)');
  });
});
