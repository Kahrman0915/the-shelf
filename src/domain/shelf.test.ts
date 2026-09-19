import { describe, expect, it } from 'vitest';
import { collectionTag, shelfRows, shelfTag, showResults, type ShelfLike } from './shelf';

function rec(p: Partial<ShelfLike> & { artist: string }): ShelfLike {
  return { title: 'T', label: null, catalog: null, genre: 'jazz', status: 'owned', wantsUpgrade: false, ...p };
}

const items = [
  { record: rec({ artist: 'McCoy Tyner', title: 'The Real McCoy' }), myRating: 4 },
  { record: rec({ artist: 'Ahmad Jamal', title: 'At the Top' }), myRating: 2 },
  { record: rec({ artist: 'Bob Marley', genre: 'reggae' }), myRating: undefined },
  { record: rec({ artist: 'Kenny Burrell', status: 'wanted' }), myRating: undefined },
  { record: rec({ artist: 'Art Blakey', status: 'new_arrival' }), myRating: undefined },
];

describe('shelfRows', () => {
  it('shows owned records only, by artist, with didn\'t-love-it last', () => {
    expect(shelfRows(items, { genre: 'all', query: '' }).map((i) => i.record.artist)).toEqual(['Bob Marley', 'McCoy Tyner', 'Ahmad Jamal']);
  });
  it('filters by genre and query', () => {
    expect(shelfRows(items, { genre: 'reggae', query: '' }).map((i) => i.record.artist)).toEqual(['Bob Marley']);
    expect(shelfRows(items, { genre: 'all', query: 'mccoy' }).map((i) => i.record.artist)).toEqual(['McCoy Tyner']);
  });
});

describe('tags', () => {
  it('shelf rows show upgrade first, then didn\'t love it, else nothing', () => {
    expect(shelfTag({ record: rec({ artist: 'A', wantsUpgrade: true }), myRating: 1 })).toBe('upgrade');
    expect(shelfTag({ record: rec({ artist: 'A' }), myRating: 2 })).toBe('disliked');
    expect(shelfTag({ record: rec({ artist: 'A' }), myRating: 5 })).toBeNull();
  });
  it('show-mode results say where the record stands', () => {
    expect(collectionTag(rec({ artist: 'A' }))).toBe('own');
    expect(collectionTag(rec({ artist: 'A', wantsUpgrade: true }))).toBe('upgrade');
    expect(collectionTag(rec({ artist: 'A', status: 'wanted' }))).toBe('want');
    expect(collectionTag(rec({ artist: 'A', status: 'new_arrival' }))).toBe('new');
  });
});

describe('showResults', () => {
  it('searches every status and returns nothing for an empty query', () => {
    expect(showResults(items, '')).toEqual([]);
    expect(showResults(items, 'burrell').map((i) => i.record.artist)).toEqual(['Kenny Burrell']);
    expect(showResults(items, 'art').map((i) => i.record.artist)).toEqual(['Art Blakey']);
  });
});
