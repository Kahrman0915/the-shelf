import { describe, expect, it } from 'vitest';
import { DISCOGS_GENRE_TO_SECTION, sectionFor } from './discogsGenre';

describe('sectionFor', () => {
  it.each(DISCOGS_GENRE_TO_SECTION)('maps %s to %s', (genre, section) => {
    expect(sectionFor([genre], [])).toBe(section);
  });

  it('lists the table in the spec order', () => {
    expect(DISCOGS_GENRE_TO_SECTION).toEqual([
      ['Jazz', 'jazz'],
      ['Rock', 'rock'],
      ['Funk / Soul', 'popsoul'],
      ['Pop', 'popularpop'],
      ['Folk, World, & Country', 'country'],
      ['Reggae', 'reggae'],
      ['Stage & Screen', 'soundtracks'],
    ]);
  });

  it('sends a holiday or christmas style to christmas, whatever the genre', () => {
    expect(sectionFor(['Pop'], ['Holiday'])).toBe('christmas');
    expect(sectionFor(['Jazz'], ['Vocal', 'Christmas Music'])).toBe('christmas');
  });

  it('takes the first genre in the release order that is in the table', () => {
    expect(sectionFor(['Jazz', 'Funk / Soul'], [])).toBe('jazz');
    expect(sectionFor(['Funk / Soul', 'Jazz'], [])).toBe('popsoul');
    expect(sectionFor(['Electronic', 'Rock'], [])).toBe('rock');
  });

  it('falls back to misc', () => {
    expect(sectionFor(['Electronic'], [])).toBe('misc');
    expect(sectionFor([], [])).toBe('misc');
  });
});
