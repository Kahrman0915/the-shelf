export type SearchableRecord = { artist: string; title: string; label: string | null; catalog: string | null };

export function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchesQuery(r: SearchableRecord, query: string): boolean {
  const words = normalise(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalise([r.artist, r.title, r.label ?? '', r.catalog ?? ''].join(' '));
  return words.every((w) => haystack.includes(w));
}
