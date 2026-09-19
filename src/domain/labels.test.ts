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
  const ballads = { genre: 'jazz' as const, label: 'Impulse!' };
  const legend = { genre: 'reggae' as const, label: 'Island / Tuff Gong' };
  it('uses the genre colour when viewing all genres', () => {
    expect(spineColor(ballads, 'all')).toBe('var(--genre-jazz)');
    expect(spineColor(legend, 'all')).toBe('var(--genre-reggae)');
  });
  it('switches to the label colour when filtered to jazz', () => {
    expect(spineColor(ballads, 'jazz')).toBe('var(--label-impulse)');
  });
  it('keeps the genre colour for other genre filters', () => {
    expect(spineColor(legend, 'reggae')).toBe('var(--genre-reggae)');
  });
});
