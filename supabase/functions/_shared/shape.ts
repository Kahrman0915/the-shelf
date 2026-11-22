// Pure helpers for the discogs-search Edge Function. No Deno APIs and no imports from src/,
// so the same file runs under Deno and under Vitest.

export type FoundRecord = {
  releaseId: number;
  artist: string;
  title: string;
  label: string | null;
  catalog: string | null;
  year: number | null;
  format: string | null;
  country: string | null;
  genres: string[];
  styles: string[];
  thumb: string | null;
};

const MAX_RESULTS = 6;

export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim();
  return q.length >= 2 && q.length <= 200 ? q : null;
}

export function splitTitle(discogsTitle: string): { artist: string; title: string } {
  const at = discogsTitle.indexOf(' - ');
  const rawArtist = at === -1 ? discogsTitle : discogsTitle.slice(0, at);
  const title = at === -1 ? '' : discogsTitle.slice(at + 3);
  const artist = rawArtist.replace(/\*$/, '').replace(/ \(\d+\)$/, '').trim();
  return { artist: artist === 'Various' ? 'Various Artists' : artist, title: title.trim() };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const httpsOnly = (v: unknown): string | null => (typeof v === 'string' && v.startsWith('https://') ? v : null);

function shapeOne(entry: unknown): FoundRecord | null {
  if (!isObject(entry)) return null;
  const releaseId = entry.id;
  if (typeof releaseId !== 'number' || !Number.isInteger(releaseId)) return null;
  if (typeof entry.title !== 'string' || !entry.title.includes(' - ')) return null;
  const { artist, title } = splitTitle(entry.title);
  // `Sade - `, ` - Diamond Life` or `* - Diamond Life` would save a record with no artist or title.
  if (artist === '' || title === '') return null;

  const catno = text(entry.catno);
  const year = Number.parseInt(String(entry.year), 10);
  const format = strings(entry.format).join(', ');
  return {
    releaseId,
    artist,
    title,
    label: text(strings(entry.label)[0]),
    catalog: catno && catno.toLowerCase() !== 'none' ? catno : null,
    year: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
    format: format === '' ? null : format,
    country: text(entry.country),
    genres: strings(entry.genre),
    styles: strings(entry.style),
    thumb: httpsOnly(entry.thumb) ?? httpsOnly(entry.cover_image),
  };
}

export function shapeResults(json: unknown): FoundRecord[] {
  if (!isObject(json) || !Array.isArray(json.results)) return [];
  const out: FoundRecord[] = [];
  for (const entry of json.results) {
    const record = shapeOne(entry);
    if (record) out.push(record);
    if (out.length === MAX_RESULTS) break;
  }
  return out;
}
