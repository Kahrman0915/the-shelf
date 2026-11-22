import { BackendError, SHELF_LOADING } from '@/data/backend';
import { GENRE_KEYS } from './genres';
import { md5Hex } from './md5';

export const SWATCH_KEYS = [
  'jazz', 'rock', 'popsoul', 'popularpop', 'misc', 'country', 'reggae', 'soundtracks', 'christmas',
  'teal', 'slate', 'sand',
] as const;
export type SwatchKey = (typeof SWATCH_KEYS)[number];

export const DISCOGS_GENRES = [
  'Blues', 'Brass & Military', "Children's", 'Classical', 'Electronic', 'Folk, World, & Country',
  'Funk / Soul', 'Hip Hop', 'Jazz', 'Latin', 'Non-Music', 'Pop', 'Reggae', 'Rock', 'Stage & Screen',
] as const;
export type DiscogsGenre = (typeof DISCOGS_GENRES)[number];

export const LEGACY_GENRES = GENRE_KEYS;
export type LegacyGenre = (typeof LEGACY_GENRES)[number];

export type SectionSeed = {
  legacyGenre: LegacyGenre;
  name: string;
  color: SwatchKey;
  discogsGenres: DiscogsGenre[];
  takesHoliday: boolean;
  isCatchAll: boolean;
};

function seed(
  legacyGenre: LegacyGenre,
  name: string,
  discogsGenres: DiscogsGenre[] = [],
  flags: { takesHoliday?: boolean; isCatchAll?: boolean } = {},
): SectionSeed {
  return {
    legacyGenre,
    name,
    color: legacyGenre,
    discogsGenres,
    takesHoliday: flags.takesHoliday ?? false,
    isCatchAll: flags.isCatchAll ?? false,
  };
}

export const KAHRMANS_NINE: SectionSeed[] = [
  seed('jazz', 'Jazz / big band', ['Jazz']),
  seed('rock', 'Rock', ['Rock']),
  seed('popsoul', 'Pop / soul / contemporary', ['Funk / Soul']),
  seed('popularpop', 'Popular pop', ['Pop']),
  seed('misc', 'Miscellaneous', [], { isCatchAll: true }),
  seed('country', 'Country', ['Folk, World, & Country']),
  seed('reggae', 'Reggae', ['Reggae']),
  seed('soundtracks', 'Soundtracks', ['Stage & Screen']),
  seed('christmas', 'Christmas', [], { takesHoliday: true }),
];

export const STARTER_SET: SectionSeed[] = [
  seed('jazz', 'Jazz', ['Jazz']),
  seed('rock', 'Rock', ['Rock']),
  seed('popsoul', 'Soul & Funk', ['Funk / Soul']),
  seed('popularpop', 'Pop', ['Pop']),
  seed('country', 'Country & Folk', ['Folk, World, & Country']),
  seed('reggae', 'Reggae', ['Reggae']),
  seed('soundtracks', 'Soundtracks', ['Stage & Screen']),
  seed('christmas', 'Christmas', [], { takesHoliday: true }),
  seed('misc', 'Everything else', [], { isCatchAll: true }),
];

// Same value Postgres gives for md5(shelf_id::text || ':' || legacy_genre)::uuid.
export function sectionIdFor(shelfId: string, legacyGenre: LegacyGenre): string {
  const h = md5Hex(`${shelfId}:${legacyGenre}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type SortableSection = {
  id: string;
  position: number;
  discogsGenres: string[];
  takesHoliday: boolean;
  isCatchAll: boolean;
};

export function sectionFor(genres: string[], styles: string[], sections: SortableSection[]): string {
  const ordered = [...sections].sort((a, b) => a.position - b.position);
  if (styles.some((s) => /holiday|christmas/i.test(s))) {
    const holiday = ordered.find((s) => s.takesHoliday);
    if (holiday) return holiday.id;
  }
  for (const genre of genres) {
    const claim = ordered.find((s) => s.discogsGenres.includes(genre));
    if (claim) return claim.id;
  }
  const catchAll = ordered.find((s) => s.isCatchAll);
  // Every shelf has a catch-all; with none, the phone just doesn't have the shelf's sections yet.
  if (!catchAll) throw new BackendError(SHELF_LOADING);
  return catchAll.id;
}
