import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GENRE_KEYS } from '@/domain/genres';

export type Spine = { width: number; height: number; color: string; band: boolean };

const PLAYED_KEY = 'shelf:intro-played';
const COLORS = [...GENRE_KEYS.map((k) => `var(--genre-${k})`), 'var(--bourbon)', 'var(--ink-muted)'];

/** Small seeded random numbers, so the wall is the same on every visit and in every test. */
function seeded(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeShelves(rows: number, perRow: number, seed = 7): Spine[][] {
  const random = seeded(seed);
  return Array.from({ length: rows }, () =>
    Array.from({ length: perRow }, () => ({
      width: 10 + Math.floor(random() * 17),
      height: 70 + Math.floor(random() * 27),
      color: COLORS[Math.floor(random() * COLORS.length)],
      band: random() < 0.33,
    })),
  );
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playedBefore(): boolean {
  try {
    return localStorage.getItem(PLAYED_KEY) === '1';
  } catch {
    return false;
  }
}

/** The opening: record spines fill the shelf, "The Shelf" drops in, then the sign-in panel rises over it. */
export function ShelfIntro({ children }: { children: ReactNode }) {
  const [mode] = useState<'full' | 'quick' | 'still'>(() => (prefersReducedMotion() ? 'still' : playedBefore() ? 'quick' : 'full'));
  const shelves = useMemo(() => makeShelves(5, 28), []);

  useEffect(() => {
    try {
      localStorage.setItem(PLAYED_KEY, '1');
    } catch {
      // Private browsing: it just plays in full again next time.
    }
  }, []);

  return (
    <div className="shelf-intro" data-intro={mode}>
      <div className="shelf-intro__wall" aria-hidden="true">
        {shelves.map((row, r) => (
          <div key={r} className="shelf-intro__row">
            <div className="shelf-intro__spines">
              {row.map((s, i) => (
                <span
                  key={i}
                  className="shelf-intro__spine"
                  style={{ width: s.width, height: `${s.height}%`, background: s.color, animationDelay: `${r * 140 + i * 22}ms` }}
                >
                  {s.band && <span className="shelf-intro__band" />}
                </span>
              ))}
            </div>
            <div className="shelf-intro__plank" />
          </div>
        ))}
      </div>
      <h1 className="shelf-intro__title">The Shelf</h1>
      <div className="shelf-intro__panel">{children}</div>
    </div>
  );
}
