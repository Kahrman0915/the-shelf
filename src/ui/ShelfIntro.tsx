import { useEffect, useMemo, useState, type AnimationEvent, type ReactNode } from 'react';
import { GENRE_KEYS } from '@/domain/genres';

/** How long after mount the panel-rise animation (`intro-panel`, 500ms delayed 2000ms) is done. A fallback in case `animationend` never fires. */
const PANEL_RISE_FALLBACK_MS = 2600;

export type Spine = { width: number; height: number; color: string };

const PLAYED_KEY = 'shelf:intro-played';
const GENRE_COLORS = GENRE_KEYS.map((k) => `var(--genre-${k})`);
/** Real spines are mostly cream, grey and black card with the odd colour, so the plain tones come up more often. */
const PLAIN_COLORS = [
  ...Array<string>(5).fill('var(--ink)'),
  ...Array<string>(4).fill('var(--ink-muted)'),
  ...Array<string>(3).fill('var(--line-strong)'),
  'var(--bourbon)',
];
const COLORS = [...GENRE_COLORS, ...PLAIN_COLORS];

/** A record spine is a few millimetres of card: 2 to 4 px here. About one in fifty is a box set. */
const BOX_SET_CHANCE = 0.02;
/** LP sleeves are all the same height, so the tops line up. About one in seventy is a 10-inch. */
const TEN_INCH_CHANCE = 0.015;
/** The average spine plus its gap, for working out how many fill a row. */
const SPINE_PITCH_PX = 4.1;
const MAX_PER_ROW = 640;
/** How long one row takes to fill, however many spines it holds. */
const ROW_FILL_MS = 620;

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
    Array.from({ length: perRow }, () => {
      const boxSet = random() < BOX_SET_CHANCE;
      const tenInch = random() < TEN_INCH_CHANCE;
      return {
        width: boxSet ? 7 + Math.floor(random() * 2) : 2 + Math.floor(random() * 3),
        height: tenInch ? 80 : 96 + Math.floor(random() * 2),
        color: COLORS[Math.floor(random() * COLORS.length)],
      };
    }),
  );
}

/** Enough spines to fill a row of this screen, so they stay record-thin on a phone and on a desktop. */
export function spinesPerRow(screenWidth: number): number {
  return Math.min(MAX_PER_ROW, Math.ceil(screenWidth / SPINE_PITCH_PX) + 4);
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
  // While the panel is still rising off-screen in full mode, it must not be reachable by keyboard or screen reader.
  const [panelInert, setPanelInert] = useState(() => mode === 'full');
  const perRow = useMemo(() => spinesPerRow(window.innerWidth), []);
  const shelves = useMemo(() => makeShelves(5, perRow), [perRow]);

  useEffect(() => {
    try {
      localStorage.setItem(PLAYED_KEY, '1');
    } catch {
      // Private browsing: it just plays in full again next time.
    }
  }, []);

  useEffect(() => {
    if (mode !== 'full') return;
    const timer = setTimeout(() => setPanelInert(false), PANEL_RISE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [mode]);

  function onPanelAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && event.animationName === 'intro-panel') {
      setPanelInert(false);
    }
  }

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
                  style={{
                    width: s.width,
                    height: `${s.height}%`,
                    background: s.color,
                    animationDelay: `${Math.round(r * 140 + (i / perRow) * ROW_FILL_MS)}ms`,
                  }}
                />
              ))}
            </div>
            <div className="shelf-intro__plank" />
          </div>
        ))}
      </div>
      <h1 className="shelf-intro__title">The Shelf</h1>
      <div className="shelf-intro__panel" inert={panelInert} onAnimationEnd={onPanelAnimationEnd}>
        {children}
      </div>
    </div>
  );
}
