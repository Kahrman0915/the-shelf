import { describe, expect, it } from 'vitest';
import { RATING_WORDS, isDisliked } from './rating';

describe('ratings', () => {
  it('names every rating', () => {
    expect(RATING_WORDS).toEqual(['Unplayed', 'Not for me', "Didn't love it", 'Good', 'Love it', 'Desert island']);
  });
  it("treats 1 and 2 as didn't love it, and unrated as not", () => {
    expect(isDisliked(1)).toBe(true);
    expect(isDisliked(2)).toBe(true);
    expect(isDisliked(3)).toBe(false);
    expect(isDisliked(undefined)).toBe(false);
  });
});
