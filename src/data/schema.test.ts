import { describe, expect, it } from 'vitest';
import { RecordSchema, type ShelfRecord } from './schema';

function record(over: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    shelfId: '11111111-1111-4111-8111-111111111111',
    status: 'owned',
    wantsUpgrade: false,
    upgradeNote: null,
    artist: 'Miles Davis',
    title: 'Kind of Blue',
    label: null,
    catalog: null,
    year: null,
    format: null,
    genre: 'jazz',
    discGrade: null,
    sleeveGrade: null,
    pricePaid: null,
    nmEstimateLow: null,
    nmEstimateHigh: null,
    valueNote: null,
    notes: null,
    discogsReleaseId: null,
    coverPath: null,
    funFact: null,
    funFactSource: null,
    coverImageUrl: null,
    boughtAt: null,
    addedBy: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    deletedAt: null,
    importKey: null,
    ...over,
  };
}

const fits = (over: Partial<ShelfRecord>) => RecordSchema.safeParse(record(over)).success;

describe('RecordSchema', () => {
  it('keeps money under a million, as numeric(8,2) does', () => {
    expect(fits({ pricePaid: 999999.99 })).toBe(true);
    expect(fits({ pricePaid: 1_000_000 })).toBe(false);
    expect(fits({ nmEstimateLow: 10, nmEstimateHigh: 1_000_000 })).toBe(false);
  });

  it('refuses an empty or blank fun fact; null is how a record has none', () => {
    expect(fits({ funFact: null })).toBe(true);
    expect(fits({ funFact: '' })).toBe(false);
    expect(fits({ funFact: '   ' })).toBe(false);
    expect(fits({ funFact: 'Recorded in two sessions.' })).toBe(true);
  });
});
