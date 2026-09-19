import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShelfIntro, makeShelves } from './ShelfIntro';

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

  it('keeps spines within believable sizes and paints them in the shelf palette', () => {
    for (const s of makeShelves(5, 28).flat()) {
      expect(s.width).toBeGreaterThanOrEqual(10);
      expect(s.width).toBeLessThanOrEqual(26);
      expect(s.height).toBeGreaterThanOrEqual(70);
      expect(s.height).toBeLessThanOrEqual(96);
      expect(s.color).toMatch(/^var\(--(genre-[a-z]+|bourbon|ink-muted)\)$/);
    }
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
});
