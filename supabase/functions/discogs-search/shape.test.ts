import { describe, expect, it } from 'vitest';
import fixture from './fixtures/search.json';
import { cleanQuery, shapeResults, splitTitle } from './shape';

describe('cleanQuery', () => {
  it('trims and accepts 2 to 200 characters', () => {
    expect(cleanQuery('ab')).toBe('ab');
    expect(cleanQuery('  mccoy tyner  ')).toBe('mccoy tyner');
    expect(cleanQuery('x'.repeat(200))).toBe('x'.repeat(200));
  });
  it('rejects short, long, blank and non-string input', () => {
    expect(cleanQuery('  a ')).toBeNull();
    expect(cleanQuery('   ')).toBeNull();
    expect(cleanQuery('x'.repeat(201))).toBeNull();
    expect(cleanQuery(42)).toBeNull();
    expect(cleanQuery(undefined)).toBeNull();
  });
});

describe('splitTitle', () => {
  it('splits artist and title', () => {
    expect(splitTitle("McCoy Tyner - Forces Of Nature (Live At Slugs')")).toEqual({
      artist: 'McCoy Tyner',
      title: "Forces Of Nature (Live At Slugs')",
    });
  });
  it('splits on the first separator only', () => {
    expect(splitTitle('Miles Davis - Live - Evil')).toEqual({ artist: 'Miles Davis', title: 'Live - Evil' });
  });
  it('removes a trailing disambiguation number and a trailing asterisk from the artist', () => {
    expect(splitTitle('Ahmad Jamal (2) - At The Pershing').artist).toBe('Ahmad Jamal');
    expect(splitTitle('Sonny Rollins* - Way Out West').artist).toBe('Sonny Rollins');
  });
  it('turns Various into Various Artists', () => {
    expect(splitTitle('Various - Trojan Records')).toEqual({ artist: 'Various Artists', title: 'Trojan Records' });
  });
});

describe('shapeResults', () => {
  const records = shapeResults({ results: fixture.results });

  it('returns at most 6 records, skipping entries without an id or a separator', () => {
    expect(fixture.results.length).toBe(8);
    expect(records).toHaveLength(6);
  });

  it('shapes a full entry', () => {
    expect(records[0]).toEqual({
      releaseId: 1001,
      artist: 'McCoy Tyner',
      title: 'Forces Of Nature (Live At Slugs\')',
      label: 'Blue Note',
      catalog: 'BN-LA459-H2',
      year: 1978,
      format: 'Vinyl, LP, Album',
      country: 'US',
      genres: ['Jazz'],
      styles: ['Post Bop'],
      thumb: 'https://i.discogs.com/thumb-1001.jpg',
    });
  });

  it('nulls catno none, year 0 and an http thumb', () => {
    const none = records.find((r) => r.releaseId === 1002)!;
    expect(none.catalog).toBeNull();
    const zero = records.find((r) => r.releaseId === 1003)!;
    expect(zero.year).toBeNull();
    const http = records.find((r) => r.releaseId === 1004)!;
    expect(http.thumb).toBeNull();
  });

  it('falls back to cover_image for the thumb', () => {
    const r = records.find((r) => r.releaseId === 1005)!;
    expect(r.thumb).toBe('https://i.discogs.com/cover-1005.jpg');
  });

  it('returns an empty list for malformed json', () => {
    expect(shapeResults(null)).toEqual([]);
    expect(shapeResults({})).toEqual([]);
    expect(shapeResults({ results: 'x' })).toEqual([]);
  });

  it('skips an entry whose artist or title is empty', () => {
    const entry = (id: number, title: string) => ({ id, title });
    const shaped = shapeResults({
      results: [entry(1, 'Sade - '), entry(2, ' - Diamond Life'), entry(3, '* - Diamond Life'), entry(4, '   -   '), entry(5, 'Sade - Diamond Life')],
    });
    expect(shaped.map((r) => r.releaseId)).toEqual([5]);
  });

  it('nulls an empty or blank label, and trims one', () => {
    const entry = (id: number, label: unknown) => ({ id, title: 'Sade - Diamond Life', label });
    const shaped = shapeResults({ results: [entry(1, ['']), entry(2, ['   ']), entry(3, ['  Epic ']), entry(4, [42])] });
    expect(shaped.map((r) => r.label)).toEqual([null, null, 'Epic', null]);
  });
});
