import type { GenreKey } from './genres';

// Discogs genre -> shelf section, in the order they are tried (spec §5).
export const DISCOGS_GENRE_TO_SECTION: ReadonlyArray<readonly [string, GenreKey]> = [
  ['Jazz', 'jazz'],
  ['Rock', 'rock'],
  ['Funk / Soul', 'popsoul'],
  ['Pop', 'popularpop'],
  ['Folk, World, & Country', 'country'],
  ['Reggae', 'reggae'],
  ['Stage & Screen', 'soundtracks'],
];

export function sectionFor(genres: string[], styles: string[]): GenreKey {
  if (styles.some((s) => /holiday|christmas/i.test(s))) return 'christmas';
  for (const genre of genres) {
    const row = DISCOGS_GENRE_TO_SECTION.find(([name]) => name === genre);
    if (row) return row[1];
  }
  return 'misc';
}
