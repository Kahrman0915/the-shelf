import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENING_MS, OpeningSplash, ShelfIntro, makeShelves, spinesPerRow } from './ShelfIntro';

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  localStorage.clear();
  mockReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('makeShelves', () => {
  it('builds the same wall every time from the same seed', () => {
    expect(makeShelves(5, 28)).toEqual(makeShelves(5, 28));
    expect(makeShelves(5, 28).flat()).toHaveLength(140);
  });

  it('makes spines record-thin with level tops, in the shelf palette', () => {
    const spines = makeShelves(5, 90).flat();
    for (const s of spines) {
      expect(s.width).toBeGreaterThanOrEqual(3);
      expect(s.width).toBeLessThanOrEqual(12);
      expect([80, 96, 97]).toContain(s.height);
      expect(s.color).toMatch(/^var\(--(section-(jazz|rock|popsoul|popularpop|misc|country|reggae|soundtracks|christmas)|bourbon|ink|ink-muted|line-strong)\)$/);
    }
    // Records, not books: nearly all are a few pixels of card, and nearly all stand the same height.
    expect(spines.filter((s) => s.width <= 6).length / spines.length).toBeGreaterThan(0.9);
    expect(spines.filter((s) => s.height >= 96).length / spines.length).toBeGreaterThan(0.9);
  });

  it('shows three shelves, a close-up of one section of the wall', () => {
    const { container } = render(<ShelfIntro>form</ShelfIntro>);
    expect(container.querySelectorAll('.shelf-intro__row')).toHaveLength(3);
  });

  it('fills a row on a phone and on a desktop without fattening the spines', () => {
    expect(spinesPerRow(390)).toBe(74);
    expect(spinesPerRow(1440)).toBe(262);
    expect(spinesPerRow(5000)).toBe(640);
  });
});

describe('ShelfIntro', () => {
  it('plays in full the first time, and quickly after that', () => {
    const first = render(<ShelfIntro>form</ShelfIntro>);
    expect(first.container.querySelector('[data-intro]')).toHaveAttribute('data-intro', 'full');
    first.unmount();
    const again = render(<ShelfIntro>form</ShelfIntro>);
    expect(again.container.querySelector('[data-intro]')).toHaveAttribute('data-intro', 'quick');
  });

  it('stays still for people who asked for less motion', () => {
    mockReducedMotion(true);
    const { container } = render(<ShelfIntro>form</ShelfIntro>);
    expect(container.querySelector('[data-intro]')).toHaveAttribute('data-intro', 'still');
  });

  it('keeps the wall out of the accessibility tree and the title and form in it', () => {
    render(<ShelfIntro><button type="button">Send my code</button></ShelfIntro>);
    expect(screen.getByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send my code' })).toBeInTheDocument();
    expect(document.querySelector('.shelf-intro__wall')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the panel inert while it rises in full mode, then usable once it has', () => {
    vi.useFakeTimers();
    try {
      render(<ShelfIntro>form</ShelfIntro>);
      expect(document.querySelector('.shelf-intro__panel')).toHaveAttribute('inert', '');
      act(() => {
        vi.advanceTimersByTime(2600);
      });
      expect(document.querySelector('.shelf-intro__panel')).not.toHaveAttribute('inert');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never makes the panel inert in quick or still mode', () => {
    localStorage.setItem('shelf:intro-played', '1');
    const { unmount } = render(<ShelfIntro>form</ShelfIntro>);
    expect(document.querySelector('.shelf-intro__panel')).not.toHaveAttribute('inert');
    unmount();

    mockReducedMotion(true);
    render(<ShelfIntro>form</ShelfIntro>);
    expect(document.querySelector('.shelf-intro__panel')).not.toHaveAttribute('inert');
  });
});

describe('OpeningSplash', () => {
  it('plays the short opening, holds the title, then says it is done after two seconds', () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      const { container } = render(<OpeningSplash onDone={onDone} />);
      expect(container.querySelector('[data-intro]')).toHaveAttribute('data-intro', 'opening');
      expect(container.querySelectorAll('.shelf-intro__row')).toHaveLength(3);
      expect(OPENING_MS).toBe(2000);
      act(() => {
        vi.advanceTimersByTime(OPENING_MS - 1);
      });
      expect(onDone).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a tap skips it', () => {
    const onDone = vi.fn();
    render(<OpeningSplash onDone={onDone} />);
    fireEvent.pointerDown(screen.getByTestId('opening-splash'));
    expect(onDone).toHaveBeenCalled();
  });

  it('is hidden from screen readers', () => {
    render(<OpeningSplash onDone={() => {}} />);
    expect(screen.getByTestId('opening-splash')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('heading', { name: 'The Shelf' })).toBeNull();
  });

  it('shows nothing for people who asked for less motion', () => {
    mockReducedMotion(true);
    const onDone = vi.fn();
    const { container } = render(<OpeningSplash onDone={onDone} />);
    expect(container.querySelector('[data-intro]')).toBeNull();
    expect(onDone).toHaveBeenCalled();
  });
});
