import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// fake-indexeddb clones with Node's structuredClone, whose ArrayBuffers belong to another realm than the
// test's own ArrayBuffer (jsdom's). Dexie's live-query cache only recognises its realm's ArrayBuffer and
// copies anything else as an empty object, so a photo draft put back and read again would come back with
// no bytes. In a browser there is one realm; hand back this realm's buffers, as a browser would.
{
  const nodeClone = globalThis.structuredClone;
  const isForeignBuffer = (v: object) => !(v instanceof ArrayBuffer) && Object.prototype.toString.call(v) === '[object ArrayBuffer]';
  const ours = (v: unknown): unknown => {
    if (!v || typeof v !== 'object') return v;
    if (isForeignBuffer(v)) {
      const view = new Uint8Array(v as ArrayBuffer);
      const copy = new ArrayBuffer(view.length);
      new Uint8Array(copy).set(view);
      return copy;
    }
    if (Array.isArray(v)) return v.map(ours);
    if (Object.getPrototypeOf(v) === Object.prototype) {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = ours(o[k]);
    }
    return v;
  };
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => ours(nodeClone(value, options))) as typeof structuredClone;
}

// Radix Select (and Dialog focus handling) call browser APIs that jsdom lacks.
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
