import { findSleeveCorners } from './findSleeve';
import { centreSquare, scaleQuad, type Quad } from './geometry';
import { loadCv, type Cv } from './loadCv';

export const SQUARE_PX = 1600; // every saved photo is this many pixels square
export const JPEG_QUALITY = 0.85;
export const DETECT_PX = 800; // corners are found on a copy this small: quicker, and enough to be accurate
export const SOURCE_MAX_PX = 3000; // keeps under iOS's canvas limit and keeps OpenCV's memory small

export const CV_WAIT_MS = 20_000; // past this, a slow first OpenCV download doesn't hold the photo up

// Browser only: crops a photo to the record sleeve and flattens it into a square JPEG, as if scanned.
// When no sleeve is found (or OpenCV can't load in time, or fails) it uses the photo's centre square: foundEdges false.
export async function squareUpPhoto(file: Blob): Promise<{ bytes: ArrayBuffer; foundEdges: boolean }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const out = canvas(SQUARE_PX, SQUARE_PX);
  try {
    let cv: Cv | null = null;
    try {
      // A stalled download keeps going in the background, ready for the next photo.
      cv = await within(loadCv(), CV_WAIT_MS);
    } catch {
      // First use with no signal: square it up without OpenCV this time.
    }
    let foundEdges = false;
    if (cv) {
      try {
        foundEdges = warpToSquare(cv, bitmap, out);
      } catch {
        // OpenCV.js throws bare numbers (its C++ exceptions); the centre square is still a usable photo.
        drawCentreSquare(bitmap, out);
      }
    } else drawCentreSquare(bitmap, out);
    return { bytes: await jpegBytes(out), foundEdges };
  } finally {
    bitmap.close();
    release(out);
  }
}

/** Start loading OpenCV now, so it's likely ready by the time a photo comes back. Call it after the camera's
 *  click, never before (iPhone only opens the camera from a tap with nothing in the way). Failures are left for
 *  squareUpPhoto, which tries again. */
export function warmUpSquaring(): void {
  loadCv().catch(() => {});
}

/** The work's answer if it settles within `ms`, else null. A failure after that is ignored. */
export function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Finds the sleeve on a small copy, then warps the full-size photo's quad onto the square canvas.
function warpToSquare(cv: Cv, bitmap: ImageBitmap, out: HTMLCanvasElement): boolean {
  const source = scaledCopy(bitmap, SOURCE_MAX_PX);
  const detect = scaledCopy(source, DETECT_PX);
  const mats: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(m: T): T => (mats.push(m), m);
  try {
    const small = findSleeveCorners(cv, pixels(detect));
    const quad = small ? scaleQuad(small, source.width / detect.width) : centreSquare(source.width, source.height);
    const src = keep(cv.matFromImageData(pixels(source)));
    const from = keep(cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y])));
    const to = keep(cv.matFromArray(4, 1, cv.CV_32FC2, corners(SQUARE_PX).flatMap((p) => [p.x, p.y])));
    const transform = keep(cv.getPerspectiveTransform(from, to));
    const square = keep(new cv.Mat());
    cv.warpPerspective(src, square, transform, new cv.Size(SQUARE_PX, SQUARE_PX), cv.INTER_CUBIC);
    cv.imshow(out, square);
    return small !== null;
  } finally {
    mats.forEach((m) => m.delete());
    release(source);
    release(detect);
  }
}

function drawCentreSquare(bitmap: ImageBitmap, out: HTMLCanvasElement) {
  const [tl, tr] = centreSquare(bitmap.width, bitmap.height);
  const side = tr.x - tl.x;
  const ctx = context(out);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, tl.x, tl.y, side, side, 0, 0, SQUARE_PX, SQUARE_PX);
}

function corners(side: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: side, y: 0 },
    { x: side, y: side },
    { x: 0, y: side },
  ];
}

// A copy whose long edge is at most maxPx (never enlarged).
function scaledCopy(image: ImageBitmap | HTMLCanvasElement, maxPx: number): HTMLCanvasElement {
  const scale = Math.min(1, maxPx / Math.max(image.width, image.height));
  const copy = canvas(Math.round(image.width * scale), Math.round(image.height * scale));
  const ctx = context(copy);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, copy.width, copy.height);
  return copy;
}

function pixels(c: HTMLCanvasElement): ImageData {
  return context(c).getImageData(0, 0, c.width, c.height);
}

async function jpegBytes(c: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Couldn’t make the JPEG');
  return blob.arrayBuffer();
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  return ctx;
}

// iOS Safari holds on to a canvas's memory until it's shrunk, and caps the total across canvases.
function release(c: HTMLCanvasElement) {
  c.width = 0;
  c.height = 0;
}
