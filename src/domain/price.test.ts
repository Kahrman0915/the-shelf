import { describe, expect, it } from 'vitest';
import { estimateRange, nmRangeOf, verdictFor } from './price';

const nm = { low: 40, high: 60 };

describe('estimateRange', () => {
  it('scales the NM range by the grade share', () => {
    expect(estimateRange(nm, 'NM')).toEqual({ low: 40, high: 60 });
    expect(estimateRange(nm, 'VG+')).toEqual({ low: 20, high: 30 });
    expect(estimateRange(nm, 'VG')).toEqual({ low: 10, high: 15 });
    expect(estimateRange(nm, 'Sealed')).toEqual({ low: 52, high: 78 });
  });
  it('never drops below the $3 floor', () => {
    expect(estimateRange(nm, 'P')).toEqual({ low: 3, high: 3 });
    expect(estimateRange({ low: 5, high: 18 }, 'G')).toEqual({ low: 3, high: 3 });
  });
});

describe('nmRangeOf', () => {
  it('returns the range when both ends are set', () => {
    expect(nmRangeOf({ nmEstimateLow: 12, nmEstimateHigh: 32 })).toEqual({ low: 12, high: 32 });
  });
  it('returns null when either end is missing', () => {
    expect(nmRangeOf({ nmEstimateLow: null, nmEstimateHigh: 32 })).toBeNull();
    expect(nmRangeOf({ nmEstimateLow: null, nmEstimateHigh: null })).toBeNull();
  });
});

describe('verdictFor', () => {
  const range = { low: 10, high: 15 };
  it('says good buy under the range', () => {
    expect(verdictFor(9, range)?.word).toBe('Good buy');
  });
  it('says fair inside the range, inclusive', () => {
    expect(verdictFor(10, range)?.word).toBe('Fair');
    expect(verdictFor(15, range)?.word).toBe('Fair');
  });
  it('says overpriced above the range', () => {
    expect(verdictFor(16, range)?.word).toBe('Overpriced');
  });
  it('says nothing without a usable asking price', () => {
    expect(verdictFor(null, range)).toBeNull();
    expect(verdictFor(Number.NaN, range)).toBeNull();
    expect(verdictFor(-1, range)).toBeNull();
  });
});
