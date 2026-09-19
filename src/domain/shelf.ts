import type { GenreKey } from './genres';
import type { GenreFilter } from './labels';
import { isDisliked } from './rating';
import { matchesQuery, normalise, type SearchableRecord } from './search';

export type TagKind = 'own' | 'want' | 'upgrade' | 'new' | 'disliked';

export type ShelfLike = SearchableRecord & {
  genre: GenreKey;
  status: 'wanted' | 'new_arrival' | 'owned';
  wantsUpgrade: boolean;
};

type Item = { record: ShelfLike; myRating: number | undefined };

function byArtistThenTitle(a: { record: ShelfLike }, b: { record: ShelfLike }): number {
  return normalise(a.record.artist).localeCompare(normalise(b.record.artist)) || normalise(a.record.title).localeCompare(normalise(b.record.title));
}

export function shelfRows<T extends Item>(items: T[], opts: { genre: GenreFilter; query: string }): T[] {
  return items
    .filter((i) => i.record.status === 'owned')
    .filter((i) => opts.genre === 'all' || i.record.genre === opts.genre)
    .filter((i) => matchesQuery(i.record, opts.query))
    .sort((a, b) => Number(isDisliked(a.myRating)) - Number(isDisliked(b.myRating)) || byArtistThenTitle(a, b));
}

export function shelfTag(item: Item): TagKind | null {
  if (item.record.wantsUpgrade) return 'upgrade';
  if (isDisliked(item.myRating)) return 'disliked';
  return null;
}

export function collectionTag(r: ShelfLike): TagKind {
  if (r.status === 'wanted') return 'want';
  if (r.status === 'new_arrival') return 'new';
  return r.wantsUpgrade ? 'upgrade' : 'own';
}

export function showResults<T extends { record: ShelfLike }>(items: T[], query: string): T[] {
  if (normalise(query) === '') return [];
  return items.filter((i) => matchesQuery(i.record, query)).sort(byArtistThenTitle);
}
