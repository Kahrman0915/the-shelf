import type { GenreKey } from './genres';
import { normalise } from './search';

export type PosterRole = 'genre' | 'accent' | 'sky' | 'window';
export type PosterShape =
  | { type: 'circle'; role: PosterRole; cx: number; cy: number; r: number; fill: string }
  | { type: 'rect'; role: PosterRole; x: number; y: number; w: number; h: number; fill: string };
export type PosterPlan = { shapes: PosterShape[]; artist: { text: string; size: number }; title: string };

const SIZE = 300;
const CELL = 50;
const BAND_TOP = 232;
const TEXT_WIDTH = 276;
const GLYPH_WIDTH = 0.43;
const MIN_ARTIST_SIZE = 18;
const MAX_ARTIST_SIZE = 40;
const MAX_ARTIST_CHARS_AT_MIN = 34;
const MAX_TITLE_CHARS = 40;

/** The ink band along the bottom, drawn by the component: the artist and title sit on it. */
export const POSTER_BAND = { x: 0, y: BAND_TOP, w: SIZE, h: SIZE - BAND_TOP } as const;

export function posterSeed(artist: string, title: string): number {
  const text = `${normalise(artist)}|${normalise(title)}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(lo: number, hi: number, n: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function truncate(text: string, keep: number): string {
  return `${text.slice(0, keep)}…`;
}

export function posterPlan(artist: string, title: string, genre: GenreKey): PosterPlan {
  const r = mulberry32(posterSeed(artist, title));
  const shapes: PosterShape[] = [];

  // 1. Accents: two of bourbon / brick / teal, never the one that matches the genre colour.
  const pool = ['bourbon', 'brick', 'teal'].filter(
    (a) => !(genre === 'rock' && a === 'brick') && !(genre === 'popsoul' && a === 'bourbon'),
  );
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const [a1, a2] = pool;

  // 2. Genre circle.
  const gr = CELL * (1.4 + r() * 0.9);
  const gcx = CELL * (1 + Math.floor(r() * 4));
  const gcy = CELL * (1 + Math.floor(r() * 2));
  shapes.push({ type: 'circle', role: 'genre', cx: gcx, cy: gcy, r: gr, fill: `var(--genre-${genre})` });

  // 3. Accent square.
  const side = CELL * (1 + Math.floor(r() * 2));
  const sx = CELL * Math.floor(r() * 5);
  const sy = CELL * Math.floor(r() * 3);
  shapes.push({ type: 'rect', role: 'accent', x: sx, y: sy, w: side, h: side, fill: `var(--${a1})` });

  // 4. Second accent: a circle or a bar.
  if (r() < 0.5) {
    const cx = CELL * (1 + Math.floor(r() * 5));
    const cy = CELL * (1 + Math.floor(r() * 2));
    const cr = CELL * (0.4 + r() * 0.5);
    shapes.push({ type: 'circle', role: 'accent', cx, cy, r: cr, fill: `var(--${a2})` });
  } else {
    const bx = CELL * Math.floor(r() * 5);
    const by = CELL * (1 + Math.floor(r() * 2));
    shapes.push({ type: 'rect', role: 'accent', x: bx, y: by, w: 100, h: 25, fill: `var(--${a2})` });
  }

  // 5. Skyline, with the odd lit window.
  for (let x = 0; x < SIZE; ) {
    const w = 16 + Math.floor(r() * 30);
    const h = 30 + Math.floor(r() * 75);
    shapes.push({ type: 'rect', role: 'sky', x, y: BAND_TOP - h, w, h, fill: 'var(--poster-sky)' });
    if (r() < 0.6) {
      const wy = BAND_TOP - h + 8 + Math.floor(r() * 20);
      shapes.push({ type: 'rect', role: 'window', x: x + 5, y: wy, w: 4, h: 5, fill: 'var(--bourbon)' });
    }
    x += w + 2 + Math.floor(r() * 4);
  }

  // 7. Artist and title lettering (6, the band, is POSTER_BAND).
  let artistText = artist.toUpperCase();
  const size = clamp(MIN_ARTIST_SIZE, MAX_ARTIST_SIZE, TEXT_WIDTH / (artistText.length * GLYPH_WIDTH));
  if (artistText.length * GLYPH_WIDTH * MIN_ARTIST_SIZE > TEXT_WIDTH) {
    artistText = truncate(artistText, MAX_ARTIST_CHARS_AT_MIN);
  }
  const titleText = title.length > MAX_TITLE_CHARS ? truncate(title, MAX_TITLE_CHARS - 1) : title;

  return { shapes, artist: { text: artistText, size }, title: titleText };
}
