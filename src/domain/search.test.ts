import { describe, expect, it } from 'vitest';
import { matchesQuery, normalise } from './search';

const pershing = { artist: 'Ahmad Jamal Trio', title: 'At the Pershing: But Not for Me', label: 'Argo', catalog: 'LP-628' };

describe('search', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalise('Café  Déjà-Vu!')).toBe('cafe deja vu');
  });
  it('matches every word anywhere in artist, title, label or catalog', () => {
    expect(matchesQuery(pershing, 'jamal pershing')).toBe(true);
    expect(matchesQuery(pershing, 'lp-628')).toBe(true);
    expect(matchesQuery(pershing, 'LP628')).toBe(false);
    expect(matchesQuery(pershing, 'argo')).toBe(true);
    expect(matchesQuery(pershing, 'coltrane')).toBe(false);
  });
  it('matches everything for an empty query', () => {
    expect(matchesQuery(pershing, '  ')).toBe(true);
  });
});
