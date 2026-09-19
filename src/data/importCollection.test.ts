import { describe, expect, it } from 'vitest';
import collection from '../../collection.json';
import { ImportError, importCollection } from './importCollection';

let n = 0;
const ctx = { shelfId: 'shelf-1', userId: 'user-k', newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };

function byKey(key: string) {
  const { records } = importCollection(collection, ctx);
  const r = records.find((x) => x.importKey === key);
  if (!r) throw new Error(`missing ${key}`);
  return r;
}

describe('importCollection with the real collection.json', () => {
  it('imports all 11 records as owned', () => {
    const { records } = importCollection(collection, ctx);
    expect(records).toHaveLength(11);
    expect(records.every((r) => r.status === 'owned' && r.shelfId === 'shelf-1' && r.addedBy === 'user-k')).toBe(true);
  });

  it('turns price 0 into unknown and keeps real prices', () => {
    expect(byKey('coltrane-ballads').pricePaid).toBeNull();
    expect(byKey('coltrane-both-directions').pricePaid).toBe(26);
  });

  it('turns empty strings into null and years into numbers', () => {
    const ballads = byKey('coltrane-ballads');
    expect(ballads.year).toBeNull();
    expect(ballads.discGrade).toBeNull();
    expect(byKey('coltrane-ascension').year).toBe(1966);
    expect(byKey('mcguffey-lane-christmas').label).toBeNull();
  });

  it('keeps value ranges as Near Mint estimates', () => {
    const pershing = byKey('ahmad-jamal-pershing');
    expect([pershing.nmEstimateLow, pershing.nmEstimateHigh]).toEqual([12, 32]);
    expect(pershing.discGrade).toBe('G');
  });

  it('creates a rating only for records rated above 0', () => {
    const { records, ratings } = importCollection(collection, ctx);
    expect(ratings).toHaveLength(6);
    const ballads = records.find((r) => r.importKey === 'coltrane-ballads')!;
    expect(ratings.find((x) => x.recordId === ballads.id)).toMatchObject({ userId: 'user-k', value: 5 });
    const ascension = records.find((r) => r.importKey === 'coltrane-ascension')!;
    expect(ratings.find((x) => x.recordId === ascension.id)).toBeUndefined();
  });
});

describe('importCollection with bad data', () => {
  it('stops, saves nothing and names each record and field', () => {
    const bad = JSON.parse(JSON.stringify(collection)) as { records: Record<string, unknown>[] };
    bad.records[0].genre = 'polka';
    bad.records[2].grade = 'Very Good';
    let error: unknown;
    try {
      importCollection(bad, ctx);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ImportError);
    const problems = (error as ImportError).problems.join('\n');
    expect(problems).toContain('coltrane-both-directions: genre');
    expect(problems).toContain('coltrane-ballads: grade');
  });

  it('refuses a file that is not a collection', () => {
    expect(() => importCollection({ hello: 'world' }, ctx)).toThrow(ImportError);
  });
});
