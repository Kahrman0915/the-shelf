// A byte-for-byte copy of `normalise` in src/domain/search.ts (Edge Functions can't import from src/).
// normalise.test.ts checks the two agree.
export function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
