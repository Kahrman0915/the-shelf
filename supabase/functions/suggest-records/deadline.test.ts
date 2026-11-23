import { describe, expect, it } from 'vitest';
import { CLAUDE_TIMEOUT_MS, claudeTimeoutMs, discogsTimeoutMs, startBudget, SUGGEST_BUDGET_MS } from './deadline.ts';

describe('the suggest-records budget', () => {
  it('is 50 s from the request arriving, short of the app’s 60 s', () => {
    expect(SUGGEST_BUDGET_MS).toBe(50_000);
    let now = 1_000;
    const left = startBudget(() => now);
    expect(left()).toBe(50_000);
    now += 4_500;
    expect(left()).toBe(45_500);
    now += 50_000;
    expect(left()).toBe(-4_500);
  });

  it('gives Claude 35 s, or what is left if that is less', () => {
    expect(CLAUDE_TIMEOUT_MS).toBe(35_000);
    expect(claudeTimeoutMs(50_000)).toBe(35_000);
    expect(claudeTimeoutMs(12_000)).toBe(12_000);
    expect(claudeTimeoutMs(-5)).toBeLessThanOrEqual(0);
  });

  it('gives each Discogs search 15 s, or what is left less a second for the answer', () => {
    expect(discogsTimeoutMs(50_000)).toBe(15_000);
    expect(discogsTimeoutMs(16_000)).toBe(15_000);
    expect(discogsTimeoutMs(6_000)).toBe(5_000);
    expect(discogsTimeoutMs(1_000)).toBeLessThanOrEqual(0);
    expect(discogsTimeoutMs(900)).toBeLessThanOrEqual(0);
  });
});
