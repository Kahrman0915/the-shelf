import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { CLAUDE_DOWN, type Identified } from '@/data/backend';
import type { Drafts } from '@/data/photos';
import { FakeBackend } from '@/test/fakeBackend';
import { useReadSleeve } from './useReadSleeve';

const ANSWER: Identified = {
  read: { artist: 'Vince Guaraldi Trio', title: 'A Charlie Brown Christmas', barcode: null, catalog: 'F-8431', label: 'Fantasy' },
  match: 'none',
  results: [],
};

const drafts = (n = 1): Drafts => ({
  front: { side: 'front', bytes: new Uint8Array([n]).buffer, foundEdges: true },
  back: { side: 'back', bytes: new Uint8Array([n + 1]).buffer, foundEdges: true },
});

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

type Props = { drafts: Drafts | null; ready: boolean };

function setup(initial: Props, backend = new FakeBackend({})) {
  backend.identified = structuredClone(ANSWER);
  const finish = slowReadingIf(backend);
  const onAnswer = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => <BackendProvider backend={backend}>{children}</BackendProvider>;
  const view = renderHook((p: Props) => useReadSleeve({ ...p, onAnswer }), { wrapper, initialProps: initial });
  return { backend, onAnswer, finish, ...view };
}

let slow = false;
const slowReadingIf = (backend: FakeBackend) => (slow ? slowReading(backend) : async () => {});

/** Holds each identifyRecord answer until the returned function is called, which lets the oldest one through. */
function slowReading(backend: FakeBackend) {
  const waiting: (() => void)[] = [];
  const real = backend.identifyRecord.bind(backend);
  vi.spyOn(backend, 'identifyRecord').mockImplementation(async (front, back) => {
    await new Promise<void>((r) => waiting.push(r));
    return real(front, back);
  });
  return () => act(async () => waiting.shift()?.());
}

afterEach(() => {
  slow = false;
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).onLine;
});

describe('useReadSleeve', () => {
  it('reads once the photos are ready, and only once for the same drafts', async () => {
    const d = drafts();
    const { backend, onAnswer, result, rerender } = setup({ drafts: d, ready: false });
    await new Promise((r) => setTimeout(r, 400));
    expect(backend.identifyCalls).toBe(0);
    rerender({ drafts: d, ready: true });
    expect(result.current.state).toBe('reading');
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(ANSWER));
    expect(result.current.state).toBe('idle');
    rerender({ drafts: d, ready: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(backend.identifyCalls).toBe(1);
  });

  it('sends the front and the back', async () => {
    const d = drafts(5);
    const backend = new FakeBackend({});
    const spy = vi.spyOn(backend, 'identifyRecord');
    setup({ drafts: d, ready: true }, backend);
    await waitFor(() => expect(spy).toHaveBeenCalledOnce());
    expect(spy).toHaveBeenCalledWith(d.front!.bytes, d.back!.bytes);
  });

  it('needs a front photo', async () => {
    const { backend } = setup({ drafts: { back: drafts().back }, ready: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(backend.identifyCalls).toBe(0);
  });

  it('new drafts are read again, and the old reading’s answer is dropped', async () => {
    slow = true;
    const { backend, onAnswer, rerender, finish } = setup({ drafts: drafts(1), ready: true });
    await waitFor(() => expect(backend.identifyRecord).toHaveBeenCalledOnce());
    rerender({ drafts: drafts(2), ready: true });
    await waitFor(() => expect(backend.identifyRecord).toHaveBeenCalledTimes(2));
    await finish();
    await new Promise((r) => setTimeout(r, 50));
    expect(onAnswer).not.toHaveBeenCalled();
    await finish();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledOnce());
  });

  it('drafts that change straight after they’re ready are read once, the latest', async () => {
    const backend = new FakeBackend({});
    const spy = vi.spyOn(backend, 'identifyRecord');
    const { rerender } = setup({ drafts: { front: drafts(1).front }, ready: true }, backend);
    const both = drafts(1);
    rerender({ drafts: both, ready: true });
    await waitFor(() => expect(spy).toHaveBeenCalledOnce());
    await new Promise((r) => setTimeout(r, 400));
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(both.front!.bytes, both.back!.bytes);
  });

  it('a reading is dropped when the photos stop being ready, and starts again when they are', async () => {
    const d = drafts();
    slow = true;
    const { backend, onAnswer, rerender, finish } = setup({ drafts: d, ready: true });
    await waitFor(() => expect(backend.identifyRecord).toHaveBeenCalledOnce());
    rerender({ drafts: d, ready: false });
    await finish();
    await new Promise((r) => setTimeout(r, 50));
    expect(onAnswer).not.toHaveBeenCalled();
    rerender({ drafts: d, ready: true });
    await waitFor(() => expect(backend.identifyRecord).toHaveBeenCalledTimes(2));
    await finish();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledOnce());
  });

  it('offline: says so, and Look it up reads once the signal is back', async () => {
    setOnline(false);
    const { backend, onAnswer, result } = setup({ drafts: drafts(), ready: true });
    await waitFor(() => expect(result.current.state).toBe('offline'));
    expect(backend.identifyCalls).toBe(0);
    setOnline(true);
    act(() => result.current.retry());
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(ANSWER));
    expect(backend.identifyCalls).toBe(1);
    expect(result.current.state).toBe('idle');
  });

  it('a signal lost during the reading counts as offline', async () => {
    const backend = new FakeBackend({});
    backend.online = false;
    const { result } = setup({ drafts: drafts(), ready: true }, backend);
    await waitFor(() => expect(result.current.state).toBe('offline'));
  });

  it('cancel() before the answer: the answer is dropped', async () => {
    slow = true;
    const { backend, onAnswer, result, finish } = setup({ drafts: drafts(), ready: true });
    await waitFor(() => expect(backend.identifyRecord).toHaveBeenCalledOnce());
    act(() => result.current.cancel());
    expect(result.current.state).toBe('idle');
    await finish();
    await new Promise((r) => setTimeout(r, 50));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('cancel() before the reading starts: nothing is sent', async () => {
    const { backend, result } = setup({ drafts: drafts(), ready: true });
    act(() => result.current.cancel());
    await new Promise((r) => setTimeout(r, 400));
    expect(backend.identifyCalls).toBe(0);
  });

  it('an answer after unmount is dropped', async () => {
    slow = true;
    const { backend, onAnswer, unmount, finish } = setup({ drafts: drafts(), ready: true });
    await waitFor(() => expect(backend.identifyRecord).toHaveBeenCalledOnce());
    unmount();
    await finish();
    await new Promise((r) => setTimeout(r, 50));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('skipNext(): the drafts handed back aren’t read, the ones after are', async () => {
    const { backend, result, rerender } = setup({ drafts: null, ready: false });
    act(() => result.current.skipNext(drafts(1)));
    // What comes back is a new object with the same photos.
    rerender({ drafts: drafts(1), ready: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(backend.identifyCalls).toBe(0);
    expect(result.current.state).toBe('idle');
    rerender({ drafts: drafts(2), ready: true });
    await waitFor(() => expect(backend.identifyCalls).toBe(1));
  });

  it('skipNext() doesn’t linger: when the drafts never come back, the next sleeve is read', async () => {
    const { backend, result, rerender } = setup({ drafts: null, ready: false });
    act(() => result.current.skipNext(drafts(1)));
    // Putting the drafts back failed; the next sleeve's photos arrive instead.
    rerender({ drafts: drafts(7), ready: true });
    await waitFor(() => expect(backend.identifyCalls).toBe(1));
    // …and the skip is gone, even for photos like the undone ones.
    rerender({ drafts: null, ready: false });
    rerender({ drafts: drafts(1), ready: true });
    await waitFor(() => expect(backend.identifyCalls).toBe(2));
  });

  it('answered drafts aren’t read again after a moment of not being ready (a retake that failed)', async () => {
    const d = drafts();
    const { backend, onAnswer, rerender } = setup({ drafts: d, ready: true });
    await waitFor(() => expect(onAnswer).toHaveBeenCalledOnce());
    rerender({ drafts: d, ready: false });
    rerender({ drafts: d, ready: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(backend.identifyCalls).toBe(1);
  });

  it('skipped drafts aren’t read after a moment of not being ready either', async () => {
    const { backend, result, rerender } = setup({ drafts: null, ready: false });
    act(() => result.current.skipNext(drafts(1)));
    const back = drafts(1);
    rerender({ drafts: back, ready: true });
    rerender({ drafts: back, ready: false });
    rerender({ drafts: back, ready: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(backend.identifyCalls).toBe(0);
  });

  it('a failure is still shown after a moment of not being ready', async () => {
    const failing = new FakeBackend({});
    failing.claudeFails = 'down';
    const d = drafts();
    const { result, rerender } = setup({ drafts: d, ready: true }, failing);
    await waitFor(() => expect(result.current.state).toBe('failed'));
    rerender({ drafts: d, ready: false });
    expect(result.current.state).toBe('idle');
    rerender({ drafts: d, ready: true });
    expect(result.current.state).toBe('failed');
    expect(failing.identifyCalls).toBe(1);
  });

  it('a failure says Claude couldn’t read it, and Try again reads again', async () => {
    const failing = new FakeBackend({});
    failing.claudeFails = 'down';
    const { backend, onAnswer, result } = setup({ drafts: drafts(), ready: true }, failing);
    await waitFor(() => expect(result.current.state).toBe('failed'));
    expect(result.current.message).toBe(CLAUDE_DOWN);
    backend.claudeFails = null;
    act(() => result.current.retry());
    expect(result.current.state).toBe('reading');
    await waitFor(() => expect(onAnswer).toHaveBeenCalledOnce());
    expect(result.current.message).toBeNull();
    expect(backend.identifyCalls).toBe(2);
  });
});
