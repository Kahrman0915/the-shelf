import { describe, expect, it } from 'vitest';
import { PAGE, readAll } from './pages.ts';

function source(total: number) {
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const data = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i);
    return { data, error: null };
  };
  return { page, calls };
}

describe('readAll', () => {
  it('reads one empty page for 0 rows', async () => {
    const { page, calls } = source(0);
    expect(await readAll(page)).toEqual({ data: [], error: null });
    expect(calls).toEqual([[0, 999]]);
  });

  it('asks for a second, empty page after exactly 1000 rows', async () => {
    const { page, calls } = source(1000);
    const r = await readAll(page);
    expect(r.data).toHaveLength(1000);
    expect(calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it('reads 2500 rows in three pages, in order', async () => {
    const { page, calls } = source(2500);
    const r = await readAll(page);
    expect(PAGE).toBe(1000);
    expect(r.data).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(calls).toHaveLength(3);
  });

  it('returns the error of a failing page', async () => {
    const r = await readAll(async () => ({ data: null, error: { code: 'X' } }));
    expect(r).toEqual({ data: null, error: { code: 'X' } });
  });
});
