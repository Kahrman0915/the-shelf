import { describe, expect, it } from 'vitest';
import { centreSquare, looksLikeSleeve, orderCorners, scaleQuad, type Point, type Quad } from './geometry';

// A square of side `side` centred at (cx, cy), turned by `deg`, corners in TL, TR, BR, BL order.
function rotatedSquare(cx: number, cy: number, side: number, deg: number): Quad {
  const a = (deg * Math.PI) / 180;
  const h = side / 2;
  const corner = (dx: number, dy: number): Point => ({
    x: cx + dx * Math.cos(a) - dy * Math.sin(a),
    y: cy + dx * Math.sin(a) + dy * Math.cos(a),
  });
  return [corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)];
}

describe('orderCorners', () => {
  it('puts the shuffled corners of a rotated square in TL, TR, BR, BL order', () => {
    const [tl, tr, br, bl] = rotatedSquare(500, 400, 300, 15);
    expect(orderCorners([br, tl, bl, tr])).toEqual([tl, tr, br, bl]);
    expect(orderCorners([bl, br, tr, tl])).toEqual([tl, tr, br, bl]);
  });
});

describe('looksLikeSleeve', () => {
  // 1000 × 1000 image: a square of side √(0.5 × 1,000,000) covers 50% of it.
  const W = 1000;
  const H = 1000;

  it('is true for a 10°-rotated square covering half the image', () => {
    expect(looksLikeSleeve(rotatedSquare(500, 500, Math.sqrt(0.5 * W * H), 10), W, H)).toBe(true);
  });

  it('is false when it covers under 20% of the image', () => {
    expect(looksLikeSleeve(rotatedSquare(500, 500, Math.sqrt(0.19 * W * H), 10), W, H)).toBe(false);
  });

  it('is false when one pair of opposite sides differs by more than 40%', () => {
    // Top side 800 wide, bottom side 400 wide: a steep trapezoid.
    const q: Quad = [
      { x: 100, y: 100 },
      { x: 900, y: 100 },
      { x: 700, y: 900 },
      { x: 300, y: 900 },
    ];
    expect(looksLikeSleeve(q, W, H)).toBe(false);
  });

  it('is false when the width-to-height ratio is outside 0.6–1.6', () => {
    const wide: Quad = [
      { x: 50, y: 300 },
      { x: 950, y: 300 },
      { x: 950, y: 800 },
      { x: 50, y: 800 },
    ]; // 900 × 500 = 1.8
    const tall: Quad = [
      { x: 300, y: 50 },
      { x: 800, y: 50 },
      { x: 800, y: 950 },
      { x: 300, y: 950 },
    ]; // 500 × 900 ≈ 0.56
    expect(looksLikeSleeve(wide, W, H)).toBe(false);
    expect(looksLikeSleeve(tall, W, H)).toBe(false);
  });

  it('is false when the corners make a bow-tie rather than a convex shape', () => {
    const [tl, tr, br, bl] = rotatedSquare(500, 500, 800, 0);
    expect(looksLikeSleeve([tl, tr, bl, br], W, H)).toBe(false);
  });
});

describe('centreSquare', () => {
  it('is the largest square centred in the image', () => {
    expect(centreSquare(4000, 3000)).toEqual([
      { x: 500, y: 0 },
      { x: 3500, y: 0 },
      { x: 3500, y: 3000 },
      { x: 500, y: 3000 },
    ]);
  });
});

describe('scaleQuad', () => {
  it('multiplies every coordinate', () => {
    const q: Quad = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ];
    expect(scaleQuad(q, 2.5)).toEqual([
      { x: 2.5, y: 5 },
      { x: 7.5, y: 10 },
      { x: 12.5, y: 15 },
      { x: 17.5, y: 20 },
    ]);
  });
});
