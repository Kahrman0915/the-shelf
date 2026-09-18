export const RATING_WORDS = ['Unplayed', 'Not for me', "Didn't love it", 'Good', 'Love it', 'Desert island'] as const;

export function isDisliked(value: number | undefined): boolean {
  return value !== undefined && value >= 1 && value <= 2;
}
