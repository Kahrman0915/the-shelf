import { describe, expect, it } from 'vitest';
import collection from '../../collection.json';
import { ImportError, importCollection } from './importCollection';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = '11111111-1111-4111-8111-111111111111';

let n = 0;
const ctx = { shelfId: SHELF, userId: USER, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };

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
    expect(records.every((r) => r.status === 'owned' && r.shelfId === SHELF && r.addedBy === USER)).toBe(true);
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
    expect(ratings.find((x) => x.recordId === ballads.id)).toMatchObject({ userId: USER, value: 5 });
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

  it('flags a second record with an id already seen and saves nothing', () => {
    const bad = JSON.parse(JSON.stringify(collection)) as { records: Record<string, unknown>[] };
    const dupId = bad.records[0].id as string;
    bad.records[1].id = dupId;
    let error: unknown;
    try {
      importCollection(bad, ctx);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).problems).toContain(`${dupId}: id appears more than once`);
  });

  it('maps a 0/0 value range to no estimate rather than a $0 estimate', () => {
    const withZeroRange = JSON.parse(JSON.stringify(collection)) as { records: Record<string, unknown>[] };
    withZeroRange.records[0].valueLow = 0;
    withZeroRange.records[0].valueHigh = 0;
    const { records } = importCollection(withZeroRange, ctx);
    const r = records.find((x) => x.importKey === 'coltrane-both-directions')!;
    expect(r.nmEstimateLow).toBeNull();
    expect(r.nmEstimateHigh).toBeNull();
  });
});
