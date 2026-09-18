export const GENRE_KEYS = ['jazz', 'rock', 'popsoul', 'popularpop', 'misc', 'country', 'reggae', 'soundtracks', 'christmas'] as const;
export type GenreKey = (typeof GENRE_KEYS)[number];

export const GENRE_LABELS: Record<GenreKey, string> = {
  jazz: 'Jazz / big band',
  rock: 'Rock',
  popsoul: 'Pop / soul / contemporary',
  popularpop: 'Popular pop',
  misc: 'Miscellaneous',
  country: 'Country',
  reggae: 'Reggae',
  soundtracks: 'Soundtracks',
  christmas: 'Christmas',
};
