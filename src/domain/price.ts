import { gradeInfo, type Grade } from './grades';

export const PRICE_FLOOR = 3;

export type Range = { low: number; high: number };

export function estimateRange(nm: Range, grade: Grade): Range {
  const { share } = gradeInfo(grade);
  return {
    low: Math.max(PRICE_FLOOR, Math.round(nm.low * share)),
    high: Math.max(PRICE_FLOOR, Math.round(nm.high * share)),
  };
}

export function nmRangeOf(r: { nmEstimateLow: number | null; nmEstimateHigh: number | null }): Range | null {
  if (r.nmEstimateLow === null || r.nmEstimateHigh === null) return null;
  return { low: r.nmEstimateLow, high: r.nmEstimateHigh };
}

export type Verdict = { tone: 'teal' | 'bourbon' | 'brick'; word: string; line: string };

export function verdictFor(asking: number | null, range: Range): Verdict | null {
  if (asking === null || !Number.isFinite(asking) || asking < 0) return null;
  if (asking < range.low) return { tone: 'teal', word: 'Good buy', line: 'Under the fair range. Take it.' };
  if (asking <= range.high) return { tone: 'bourbon', word: 'Fair', line: 'Inside the fair range for this condition.' };
  return { tone: 'brick', word: 'Overpriced', line: 'Above the fair range. Haggle or walk.' };
}

/** `$15` for whole dollars, `$15.50` otherwise. */
export function formatMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** Digits plus at most one `.` or `,`, so "1.2.3" becomes "1.23" instead of a NaN that silently drops the verdict. */
export function sanitizeAsking(raw: string): string {
  const cleaned = raw.replace(/[^0-9.,]/g, '');
  const sep = cleaned.search(/[.,]/);
  if (sep === -1) return cleaned;
  return cleaned.slice(0, sep + 1) + cleaned.slice(sep + 1).replace(/[.,]/g, '');
}

/**
 * What a person typed as a price, in dollars, rounded to cents. A comma followed by exactly three digits at the end
 * is a thousands separator ("1,200" is 1200); any other comma is a decimal point ("15,50" is 15.50).
 */
export function parsePrice(raw: string): number | null {
  let s = raw.replace(/[$\s]/g, '');
  if (s === '') return null;
  s = /,\d{3}$/.test(s) && !s.includes('.') ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
