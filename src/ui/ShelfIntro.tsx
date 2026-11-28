import { useEffect, useMemo, useState, type AnimationEvent, type ReactNode } from 'react';
import { KAHRMANS_NINE } from '@/domain/sections';

/** How long after mount the panel-rise animation (`intro-panel`, 500ms delayed 2000ms) is done. A fallback in case `animationend` never fires. */
const PANEL_RISE_FALLBACK_MS = 2600;

export type Spine = { width: number; height: number; color: string };

const PLAYED_KEY = 'shelf:intro-played';
/** The nine colours the first shelf's sections wear. */
const SECTION_COLORS = KAHRMANS_NINE.map((s) => `var(--section-${s.color})`);
/** Real spines are mostly cream, grey and black card with the odd colour, so the plain tones come up more often. */
const PLAIN_COLORS = [
  ...Array<string>(5).fill('var(--ink)'),
  ...Array<string>(4).fill('var(--ink-muted)'),
  ...Array<string>(3).fill('var(--line-strong)'),
  'var(--bourbon)',
];
const COLORS = [...SECTION_COLORS, ...PLAIN_COLORS];

/** Zoomed in on one section of the wall: three shelves, so each record stands tall. */
const SHELVES = 3;
/** A record spine is a few millimetres of card: 3 to 6 px at this zoom. About one in fifty is a box set. */
const BOX_SET_CHANCE = 0.02;
/** LP sleeves are all the same height, so the tops line up. About one in seventy is a 10-inch. */
const TEN_INCH_CHANCE = 0.015;
/** The average spine plus its gap, for working out how many fill a row. */
const SPINE_PITCH_PX = 5.6;
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
        width: boxSet ? 10 + Math.floor(random() * 3) : 3 + Math.floor(random() * 4),
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

/** The rows of spines behind the title. Each spine waits its turn, so the rows fill left to right, one after another. */
function Wall({ shelves, perRow, rowStaggerMs, rowFillMs }: { shelves: Spine[][]; perRow: number; rowStaggerMs: number; rowFillMs: number }) {
  return (
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
                  animationDelay: `${Math.round(r * rowStaggerMs + (i / perRow) * rowFillMs)}ms`,
                }}
              />
            ))}
          </div>
          <div className="shelf-intro__plank" />
        </div>
      ))}
    </div>
  );
}

/** The opening: record spines fill the shelf, "The Shelf" drops in, then the sign-in panel rises over it. */
export function ShelfIntro({ children }: { children: ReactNode }) {
  const [mode] = useState<'full' | 'quick' | 'still'>(() => (prefersReducedMotion() ? 'still' : playedBefore() ? 'quick' : 'full'));
  // While the panel is still rising off-screen in full mode, it must not be reachable by keyboard or screen reader.
  const [panelInert, setPanelInert] = useState(() => mode === 'full');
  const perRow = useMemo(() => spinesPerRow(window.innerWidth), []);
  const shelves = useMemo(() => makeShelves(SHELVES, perRow), [perRow]);

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
      <Wall shelves={shelves} perRow={perRow} rowStaggerMs={140} rowFillMs={ROW_FILL_MS} />
      <h1 className="shelf-intro__title">The Shelf</h1>
      <div className="shelf-intro__panel" inert={panelInert} onAnimationEnd={onPanelAnimationEnd}>
        {children}
      </div>
    </div>
  );
}

/** How long the opening plays for someone already signed in, fade-out included. */
export const OPENING_MS = 1200;

/**
 * The short opening when the app starts with someone already signed in: the spines fill, "The Shelf" drops in,
 * then it fades away to show the shelf underneath. About a second; a tap skips it. Nothing for people who
 * asked for less motion. Hidden from screen readers, which go straight to the shelf.
 */
export function OpeningSplash({ onDone }: { onDone: () => void }) {
  const perRow = useMemo(() => spinesPerRow(window.innerWidth), []);
  const shelves = useMemo(() => makeShelves(SHELVES, perRow), [perRow]);
  const reduced = useMemo(prefersReducedMotion, []);

  useEffect(() => {
    if (reduced) {
      onDone();
      return;
    }
    const timer = setTimeout(onDone, OPENING_MS);
    return () => clearTimeout(timer);
  }, [reduced, onDone]);

  if (reduced) return null;
  return (
    <div className="shelf-intro" data-intro="opening" aria-hidden="true" data-testid="opening-splash" onPointerDown={onDone}>
      <Wall shelves={shelves} perRow={perRow} rowStaggerMs={60} rowFillMs={300} />
      <div className="shelf-intro__title">The Shelf</div>
    </div>
  );
}
