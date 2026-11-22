// Plain geometry for squaring up a photo of a record sleeve. Image coordinates: x right, y down.

export type Point = { x: number; y: number };
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

const MIN_COVER = 0.2; // the sleeve fills at least a fifth of the photo
const MAX_SIDE_DIFFERENCE = 0.4; // opposite sides within 40% of each other (not too skewed)
const MIN_ASPECT = 0.6;
const MAX_ASPECT = 1.6;

/** Sorts four corners into top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(points: Point[]): Quad {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  // Going round the centre by angle visits them clockwise on screen (y points down).
  const round = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // Start at the top-left: the corner nearest the image origin.
  const start = round.reduce((best, p, i) => (p.x + p.y < round[best].x + round[best].y ? i : best), 0);
  return [0, 1, 2, 3].map((i) => round[(start + i) % 4]) as Quad;
}

/** Whether an ordered quad is a plausible sleeve: convex, big enough, not too skewed, roughly square. */
export function looksLikeSleeve(q: Quad, width: number, height: number): boolean {
  if (!isConvex(q)) return false;
  if (area(q) < MIN_COVER * width * height) return false;
  const [tl, tr, br, bl] = q;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  if (differ(top, bottom) > MAX_SIDE_DIFFERENCE || differ(left, right) > MAX_SIDE_DIFFERENCE) return false;
  const aspect = (top + bottom) / (left + right);
  return aspect >= MIN_ASPECT && aspect <= MAX_ASPECT;
}

/** The largest square in the middle of the image: the fallback when no sleeve is found. */
export function centreSquare(width: number, height: number): Quad {
  const side = Math.min(width, height);
  const x = (width - side) / 2;
  const y = (height - side) / 2;
  return [
    { x, y },
    { x: x + side, y },
    { x: x + side, y: y + side },
    { x, y: y + side },
  ];
}

export function scaleQuad(q: Quad, factor: number): Quad {
  return q.map((p) => ({ x: p.x * factor, y: p.y * factor })) as Quad;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function differ(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b);
}

function area(q: Quad): number {
  let twice = 0;
  q.forEach((p, i) => {
    const n = q[(i + 1) % 4];
    twice += p.x * n.y - n.x * p.y;
  });
  return Math.abs(twice) / 2;
}

// Convex when every turn going round the corners bends the same way.
function isConvex(q: Quad): boolean {
  const turns = q.map((p, i) => {
    const a = q[(i + 1) % 4];
    const b = q[(i + 2) % 4];
    return (a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x);
  });
  return turns.every((t) => t > 0) || turns.every((t) => t < 0);
}
