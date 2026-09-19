export type SearchableRecord = { artist: string; title: string; label: string | null; catalog: string | null };

export function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchesQuery(r: SearchableRecord, query: string): boolean {
  const words = normalise(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalise([r.artist, r.title, r.label ?? '', r.catalog ?? ''].join(' '));
  return words.every((w) => haystack.includes(w));
}
