// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { findSleeveCorners } from './findSleeve';
import type { Point, Quad } from './geometry';
import { loadCv, type Cv } from './loadCv';

let cv: Cv;
beforeAll(async () => {
  cv = await loadCv();
}, 30_000);

// Small seeded generator (mulberry32), so the noise is the same on every run.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inside(p: Point, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

// RGBA photo: grey `sleeve` inside the quad, grey `table` outside, each pixel ±8 of noise.
function paint(width: number, height: number, quad: Quad | null, sleeve: number, table: number) {
  const random = seeded(42);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const grey = quad && inside({ x: x + 0.5, y: y + 0.5 }, quad) ? sleeve : table;
      const v = grey + Math.round((random() * 2 - 1) * 8);
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

function expectNear(found: Quad | null, want: Quad, width: number) {
  expect(found).not.toBeNull();
  const tolerance = width * 0.02;
  found!.forEach((p, i) => {
    expect(Math.abs(p.x - want[i].x), `corner ${i} x`).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(p.y - want[i].y), `corner ${i} y`).toBeLessThanOrEqual(tolerance);
  });
}

const W = 800;
const H = 600;
// 150 px in from the left and right edges, made square: 500 × 500, centred (52% of the image).
const STRAIGHT: Quad = [
  { x: 150, y: 50 },
  { x: 650, y: 50 },
  { x: 650, y: 550 },
  { x: 150, y: 550 },
];
const ANGLED: Quad = [
  { x: 120, y: 90 },
  { x: 690, y: 130 },
  { x: 650, y: 560 },
  { x: 160, y: 520 },
];

describe('findSleeveCorners', () => {
  it('finds a dark sleeve on a light table, straight on', () => {
    expectNear(findSleeveCorners(cv, paint(W, H, STRAIGHT, 50, 200)), STRAIGHT, W);
  });

  it('finds a sleeve shot at an angle', () => {
    expectNear(findSleeveCorners(cv, paint(W, H, ANGLED, 50, 200)), ANGLED, W);
  });

  it('finds a light sleeve on a dark table', () => {
    expectNear(findSleeveCorners(cv, paint(W, H, STRAIGHT, 200, 50)), STRAIGHT, W);
  });

  it('gives up on a plain image', () => {
    expect(findSleeveCorners(cv, paint(W, H, null, 128, 128))).toBeNull();
  });

  it('gives up on a sleeve that’s too small', () => {
    const side = Math.sqrt(0.1 * W * H);
    const small: Quad = [
      { x: 400 - side / 2, y: 300 - side / 2 },
      { x: 400 + side / 2, y: 300 - side / 2 },
      { x: 400 + side / 2, y: 300 + side / 2 },
      { x: 400 - side / 2, y: 300 + side / 2 },
    ];
    expect(findSleeveCorners(cv, paint(W, H, small, 50, 200))).toBeNull();
  });
});
