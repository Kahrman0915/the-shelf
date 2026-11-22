import { describe, expect, it, vi } from 'vitest';
import type { Answer } from '../_shared/discogs.ts';
import type { FoundRecord } from '../_shared/shape.ts';
import { findMatch } from './match.ts';
import type { Read } from './read.ts';

const NONE: Read = { artist: null, title: null, barcode: null, catalog: null, label: null };
const rec = (n: number) => ({ discogsId: n }) as unknown as FoundRecord;
const ok = (n: number): Answer => ({ status: 200, body: { results: Array.from({ length: n }, (_, i) => rec(i + 1)) } });

describe('findMatch', () => {
  it('is exact when the barcode finds one, with a single call', async () => {
    const search = vi.fn(async () => ok(1));
    const out = await findMatch({ ...NONE, barcode: '025218843123', catalog: 'C 1', artist: 'A', title: 'T' }, search);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ match: 'exact' });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ barcode: '025218843123' });
  });

  it('is several when the barcode finds three', async () => {
    const out = await findMatch({ ...NONE, barcode: '025218843123' }, async () => ok(3));
    expect(out.body).toMatchObject({ match: 'several' });
    expect((out.body as { results: unknown[] }).results).toHaveLength(3);
  });

  it('falls through to catalog when the barcode finds nothing', async () => {
    const search = vi.fn(async (p: Record<string, string>) => (p.barcode ? ok(0) : ok(1)));
    const out = await findMatch({ ...NONE, barcode: '025218843123', catalog: 'CS 9000', artist: 'A' }, search);
    expect(out.body).toMatchObject({ match: 'exact' });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][0]).toEqual({ catno: 'CS 9000', artist: 'A', format: 'Vinyl' });
  });

  it('skips the catalog step when there is no artist', async () => {
    const search = vi.fn(async () => ok(0));
    const out = await findMatch({ ...NONE, catalog: 'CS 9000' }, search);
    expect(search).not.toHaveBeenCalled();
    expect(out.body).toEqual({ read: { ...NONE, catalog: 'CS 9000' }, match: 'none', results: [] });
  });

  it('never calls one result from artist and title exact', async () => {
    const search = vi.fn(async () => ok(1));
    const out = await findMatch({ ...NONE, artist: 'Miles Davis', title: 'Kind of Blue' }, search);
    expect(search).toHaveBeenCalledWith({ q: 'Miles Davis Kind of Blue', format: 'Vinyl' });
    expect(out.body).toMatchObject({ match: 'several' });
  });

  it('is none with no calls when nothing is readable', async () => {
    const search = vi.fn(async () => ok(1));
    const out = await findMatch(NONE, search);
    expect(search).not.toHaveBeenCalled();
    expect(out).toEqual({ status: 200, body: { read: NONE, match: 'none', results: [] } });
  });

  it('is none when every step comes back empty', async () => {
    const out = await findMatch({ ...NONE, artist: 'A', title: 'T' }, async () => ok(0));
    expect(out.body).toMatchObject({ match: 'none', results: [] });
  });

  it('passes a 429 through', async () => {
    const out = await findMatch({ ...NONE, barcode: '025218843123' }, async () => ({
      status: 429,
      body: { error: 'rate-limited' },
    }));
    expect(out).toEqual({ status: 429, body: { error: 'rate-limited' } });
  });

  it('turns any other failure into 502 down', async () => {
    const out = await findMatch({ ...NONE, barcode: '025218843123' }, async () => ({
      status: 502,
      body: { error: 'x' },
    }));
    expect(out).toEqual({ status: 502, body: { error: 'down' } });
  });

  it('turns a 200 without a results array into 502 down', async () => {
    const search = vi.fn(async (): Promise<Answer> => ({ status: 200, body: { error: 'odd' } }));
    const out = await findMatch({ ...NONE, barcode: '025218843123', artist: 'A', title: 'T' }, search);
    expect(out).toEqual({ status: 502, body: { error: 'down' } });
    expect(search).toHaveBeenCalledTimes(1);
  });
});
