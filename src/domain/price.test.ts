import { describe, expect, it } from 'vitest';
import { estimateRange, formatMoney, nmRangeOf, parsePrice, sanitizeAsking, verdictFor } from './price';

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

describe('formatMoney', () => {
  it('drops the cents on whole dollars', () => {
    expect(formatMoney(15)).toBe('$15');
    expect(formatMoney(15.5)).toBe('$15.50');
  });
});

describe('parsePrice', () => {
  it('reads plain, dollar-signed and decimal prices', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('15')).toBe(15);
    expect(parsePrice('$15')).toBe(15);
    expect(parsePrice('15.5')).toBe(15.5);
  });
  it('reads a comma as a decimal point, or as a thousands separator before exactly three digits', () => {
    expect(parsePrice('15,50')).toBe(15.5);
    expect(parsePrice('1,200')).toBe(1200);
  });
  it('rounds to cents and refuses what is not a number', () => {
    expect(parsePrice('15.555')).toBe(15.56);
    expect(parsePrice('.')).toBeNull();
    expect(parsePrice('abc')).toBeNull();
  });
});

describe('sanitizeAsking', () => {
  it('keeps digits and at most one dot or comma', () => {
    expect(sanitizeAsking('15,5,0')).toBe('15,50');
    expect(sanitizeAsking('$1.2.3')).toBe('1.23');
    expect(sanitizeAsking('12')).toBe('12');
  });
});
