import { looksLikeSleeve, orderCorners, type Point, type Quad } from './geometry';
import type { Cv } from './loadCv';

type Mat = InstanceType<Cv['Mat']>;
type Image = { data: Uint8ClampedArray; width: number; height: number };

/**
 * Finds the four corners of a record sleeve in an RGBA photo, or null when there's no clear sleeve.
 * Tries edges first (works for most sleeves on most tables), then a light/dark split of the photo.
 */
export function findSleeveCorners(cv: Cv, image: Image): Quad | null {
  const { width, height } = image;
  const mats: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(m: T): T => (mats.push(m), m);
  try {
    const rgba = keep(cv.matFromImageData(image as ImageData));
    const gray = keep(new cv.Mat());
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const blurred = keep(new cv.Mat());
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    const edges = keep(new cv.Mat());
    cv.Canny(blurred, edges, 50, 150);
    const kernel = keep(cv.Mat.ones(3, 3, cv.CV_8U));
    cv.dilate(edges, edges, kernel);
    const fromEdges = largestSleeve(cv, edges, width, height, false);
    if (fromEdges) return fromEdges;

    // A plain split into light and dark, tried both ways round. Here the table usually reaches the
    // photo's border, so a shape touching the border is skipped: it's the table, not the sleeve.
    const split = keep(new cv.Mat());
    cv.threshold(blurred, split, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    const light = largestSleeve(cv, split, width, height, true);
    if (light) return light;
    cv.bitwise_not(split, split);
    return largestSleeve(cv, split, width, height, true);
  } finally {
    mats.forEach((m) => m.delete());
  }
}

// Goes through the outer shapes from largest to smallest and returns the first that is a sleeve.
function largestSleeve(cv: Cv, binary: Mat, width: number, height: number, skipBorder: boolean): Quad | null {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const shapes: Mat[] = [];
  try {
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) shapes.push(contours.get(i));
    const bySize = shapes.map((c) => ({ c, area: cv.contourArea(c) })).sort((a, b) => b.area - a.area);
    for (const { c } of bySize) {
      if (skipBorder && touchesBorder(cv, c, width, height)) continue;
      const corners = fourCorners(cv, c);
      if (!corners) continue;
      const quad = orderCorners(corners);
      if (looksLikeSleeve(quad, width, height)) return quad;
    }
    return null;
  } finally {
    shapes.forEach((c) => c.delete());
    contours.delete();
    hierarchy.delete();
  }
}

// The shape simplified to a polygon (within 2% of its perimeter), if that has four corners and is convex.
function fourCorners(cv: Cv, contour: Mat): Point[] | null {
  const approx = new cv.Mat();
  try {
    cv.approxPolyDP(contour, approx, 0.02 * cv.arcLength(contour, true), true);
    if (approx.rows !== 4 || !cv.isContourConvex(approx)) return null;
    const xy = approx.data32S;
    return [0, 1, 2, 3].map((i) => ({ x: xy[i * 2], y: xy[i * 2 + 1] }));
  } finally {
    approx.delete();
  }
}

function touchesBorder(cv: Cv, contour: Mat, width: number, height: number): boolean {
  const r = cv.boundingRect(contour);
  return r.x <= 0 || r.y <= 0 || r.x + r.width >= width || r.y + r.height >= height;
}
