import { describe, expect, it } from 'vitest';
import type { ShelfRecord } from './schema';
import { RowError, ratingFromRow, ratingToRow, recordFromRow, recordToRow } from './rowMapping';

const record: ShelfRecord = {
  id: '00000000-0000-4000-8000-000000000001', shelfId: '00000000-0000-4000-8000-0000000000aa', status: 'owned',
  wantsUpgrade: false, upgradeNote: null, artist: 'Ahmad Jamal Trio', title: 'At the Pershing', label: 'Argo',
  catalog: 'LP-628', year: 1958, format: 'Mono', genre: 'jazz', discGrade: 'G', sleeveGrade: null, pricePaid: null,
  nmEstimateLow: 12, nmEstimateHigh: 32, valueNote: null, notes: null, discogsReleaseId: null, coverPath: null,
  boughtAt: null, addedBy: '00000000-0000-4000-8000-0000000000bb', createdAt: '2025-09-17T00:00:00.000Z',
  updatedAt: '2025-09-17T00:00:00.000Z', deletedAt: null, importKey: 'ahmad-jamal-pershing',
};

describe('record rows', () => {
  it('round-trips through snake_case', () => {
    const row = recordToRow(record);
    expect(row).toMatchObject({ shelf_id: record.shelfId, nm_estimate_low: 12, import_key: 'ahmad-jamal-pershing', added_by: record.addedBy });
    expect(recordFromRow(row)).toEqual(record);
  });

  it('accepts numbers that arrive as strings', () => {
    const row = { ...recordToRow(record), nm_estimate_low: '12.00', nm_estimate_high: '32', price_paid: null };
    expect(recordFromRow(row).nmEstimateLow).toBe(12);
  });

  it('fails loudly on a row it does not understand, naming the record and field', () => {
    const row = { ...recordToRow(record), genre: 'polka' };
    expect(() => recordFromRow(row)).toThrow(RowError);
    expect(() => recordFromRow(row)).toThrow(/00000000-0000-4000-8000-000000000001: genre/);
  });
});

describe('rating rows', () => {
  it('round-trips', () => {
    const rating = { recordId: record.id, userId: record.addedBy, value: 4, updatedAt: '2025-09-17T00:00:00.000Z' };
    expect(ratingToRow(rating)).toEqual({ record_id: record.id, user_id: record.addedBy, value: 4, updated_at: rating.updatedAt });
    expect(ratingFromRow(ratingToRow(rating))).toEqual(rating);
  });
});
