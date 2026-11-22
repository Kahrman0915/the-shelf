import { describe, expect, it } from 'vitest';
import { CLAUDE_TIMEOUT_MS, claudeTimeoutMs, discogsTimeoutMs, IDENTIFY_BUDGET_MS, startBudget } from './deadline.ts';

describe('the identify-record budget', () => {
  it('is 26 s from the request arriving, short of the app’s 30 s that also covers sending the photos', () => {
    expect(IDENTIFY_BUDGET_MS).toBe(26_000);
    let now = 1_000;
    const left = startBudget(() => now);
    expect(left()).toBe(26_000);
    now += 4_500;
    expect(left()).toBe(21_500);
    now += 30_000;
    expect(left()).toBe(-8_500);
  });

  it('gives Claude 20 s, or what is left if that is less', () => {
    expect(CLAUDE_TIMEOUT_MS).toBe(20_000);
    expect(claudeTimeoutMs(26_000)).toBe(20_000);
    expect(claudeTimeoutMs(12_000)).toBe(12_000);
    expect(claudeTimeoutMs(-5)).toBeLessThanOrEqual(0);
  });

  it('gives each Discogs search 15 s, or what is left less a second for the answer', () => {
    expect(discogsTimeoutMs(26_000)).toBe(15_000);
    expect(discogsTimeoutMs(16_000)).toBe(15_000);
    expect(discogsTimeoutMs(6_000)).toBe(5_000);
    expect(discogsTimeoutMs(1_000)).toBeLessThanOrEqual(0);
    expect(discogsTimeoutMs(Infinity)).toBe(15_000);
  });
});
