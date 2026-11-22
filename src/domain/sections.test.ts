import { describe, expect, it } from 'vitest';
import { BackendError, SHELF_LOADING } from '@/data/backend';
import { GENRE_KEYS } from './genres';
import { md5Hex } from './md5';
import {
  KAHRMANS_NINE,
  LEGACY_GENRES,
  STARTER_SET,
  sectionFor,
  sectionIdFor,
  type SectionSeed,
  type SortableSection,
} from './sections';

const SHELF = '11111111-1111-4111-8111-111111111111';

function sortable(set: SectionSeed[]): SortableSection[] {
  return set.map((s, position) => ({
    id: s.legacyGenre,
    position,
    discogsGenres: s.discogsGenres,
    takesHoliday: s.takesHoliday,
    isCatchAll: s.isCatchAll,
  }));
}

describe('LEGACY_GENRES', () => {
  it('is the nine genre keys', () => {
    expect([...LEGACY_GENRES]).toEqual([...GENRE_KEYS]);
  });
});

describe('sectionIdFor', () => {
  it('is the hyphenated md5 of shelf id, colon and genre', () => {
    const h = md5Hex(`${SHELF}:jazz`);
    expect(sectionIdFor(SHELF, 'jazz')).toBe(
      `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
    );
    expect(sectionIdFor(SHELF, 'jazz')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('is stable and differs per genre', () => {
    expect(sectionIdFor(SHELF, 'rock')).toBe(sectionIdFor(SHELF, 'rock'));
    expect(sectionIdFor(SHELF, 'rock')).not.toBe(sectionIdFor(SHELF, 'jazz'));
  });
});

describe.each([
  ['KAHRMANS_NINE', KAHRMANS_NINE, ['Jazz / big band', 'Rock', 'Pop / soul / contemporary', 'Popular pop', 'Miscellaneous', 'Country', 'Reggae', 'Soundtracks', 'Christmas']],
  ['STARTER_SET', STARTER_SET, ['Jazz', 'Rock', 'Soul & Funk', 'Pop', 'Country & Folk', 'Reggae', 'Soundtracks', 'Christmas', 'Everything else']],
])('%s', (_label, set, names) => {
  it('has nine entries with the table names in order', () => {
    expect(set).toHaveLength(9);
    expect(set.map((s) => s.name)).toEqual(names);
  });

  it('has one catch-all and one holiday section', () => {
    expect(set.filter((s) => s.isCatchAll)).toHaveLength(1);
    expect(set.filter((s) => s.takesHoliday)).toHaveLength(1);
  });

  it('covers each legacy genre once, with matching colour', () => {
    expect(set.map((s) => s.legacyGenre).sort()).toEqual([...GENRE_KEYS].sort());
    expect(set.every((s) => s.color === s.legacyGenre)).toBe(true);
  });

  it('claims no Discogs genre twice', () => {
    const all = set.flatMap((s) => s.discogsGenres);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('sectionFor', () => {
  const starter = sortable(STARTER_SET);

  it('sends a holiday style to the holiday section over a Jazz genre', () => {
    expect(sectionFor(['Jazz'], ['Christmas'], starter)).toBe('christmas');
    expect(sectionFor(['Jazz'], ['Holiday Music'], starter)).toBe('christmas');
  });

  it("lets the release's own genre order decide", () => {
    expect(sectionFor(['Funk / Soul', 'Jazz'], [], starter)).toBe('popsoul');
    expect(sectionFor(['Jazz', 'Funk / Soul'], [], starter)).toBe('jazz');
  });

  it('falls to the catch-all for an unclaimed genre', () => {
    expect(sectionFor(['Electronic'], [], starter)).toBe('misc');
    expect(sectionFor([], [], starter)).toBe('misc');
  });

  it('lets the lower position win when two sections claim a genre', () => {
    const sections: SortableSection[] = [
      { id: 'late', position: 5, discogsGenres: ['Rock'], takesHoliday: false, isCatchAll: false },
      { id: 'early', position: 1, discogsGenres: ['Rock'], takesHoliday: false, isCatchAll: false },
      { id: 'rest', position: 9, discogsGenres: [], takesHoliday: false, isCatchAll: true },
    ];
    expect(sectionFor(['Rock'], [], sections)).toBe('early');
  });

  it('falls through to the genres when there is no holiday section', () => {
    const noHoliday = starter.filter((s) => !s.takesHoliday);
    expect(sectionFor(['Jazz'], ['Christmas'], noHoliday)).toBe('jazz');
  });

  it('throws when there is no catch-all', () => {
    const noCatchAll = starter.filter((s) => !s.isCatchAll);
    expect(() => sectionFor(['Electronic'], [], noCatchAll)).toThrow(BackendError);
    expect(() => sectionFor(['Electronic'], [], [])).toThrow(SHELF_LOADING);
    expect(SHELF_LOADING).toBe('Your shelf is still loading. Try again in a moment.');
  });
});
