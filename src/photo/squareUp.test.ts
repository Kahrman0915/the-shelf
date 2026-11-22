import { afterEach, describe, expect, it, vi } from 'vitest';
import { CV_WAIT_MS, within } from './squareUp';

afterEach(() => vi.useRealTimers());

describe('within', () => {
  it('waits 20 seconds for OpenCV before squaring a photo without it', () => {
    expect(CV_WAIT_MS).toBe(20_000);
  });

  it('gives the answer when it comes in time', async () => {
    await expect(within(Promise.resolve('cv'), 1_000)).resolves.toBe('cv');
  });

  it('gives null once the time is up, without waiting any longer', async () => {
    vi.useFakeTimers();
    const outcome = within(new Promise<string>(() => {}), 1_000);
    let settled: string | null | undefined;
    void outcome.then((v) => (settled = v));
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeNull();
  });

  it('passes a failure on when it comes in time', async () => {
    await expect(within(Promise.reject(new Error('no signal')), 1_000)).rejects.toThrow('no signal');
  });

  it('ignores a failure that comes after the time is up, so it is never left unhandled', async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    const outcome = within(new Promise<string>((_resolve, reject) => (fail = reject)), 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(outcome).resolves.toBeNull();
    fail(new Error('late'));
    await vi.advanceTimersByTimeAsync(0);
  });
});
