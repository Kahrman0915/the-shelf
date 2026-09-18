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
