import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchDiscogsWith, type Answer } from '../_shared/discogs.ts';
import type { FoundRecord } from '../_shared/shape.ts';
import { findMatch } from './match.ts';
import type { Read } from './read.ts';

const NONE: Read = { artist: null, title: null, barcode: null, catalog: null, label: null };
const rec = (n: number) => ({ discogsId: n }) as unknown as FoundRecord;
const ok = (n: number, total: number | null = n): Answer => ({
  status: 200,
  body: { results: Array.from({ length: n }, (_, i) => rec(i + 1)), total },
});

describe('findMatch', () => {
  it('is exact when the barcode finds one, with a single call', async () => {
    const search = vi.fn(async () => ok(1));
    const out = await findMatch({ ...NONE, barcode: '025218843123', catalog: 'C 1', artist: 'A', title: 'T' }, search);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ match: 'exact' });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ barcode: '025218843123', format: 'Vinyl' }, 15_000);
  });

  it('is not exact when Discogs counts more releases than came back usable', async () => {
    const out = await findMatch({ ...NONE, barcode: '025218843123' }, async () => ok(1, 2));
    expect(out.body).toMatchObject({ match: 'several' });
  });

  it('is exact when Discogs gives no count and one release came back', async () => {
    const out = await findMatch({ ...NONE, barcode: '025218843123' }, async () => ok(1, null));
    expect(out.body).toMatchObject({ match: 'exact' });
  });

  describe('with Discogs itself', () => {
    afterEach(() => vi.restoreAllMocks());

    it('two raw results, one malformed, are not exact', async () => {
      const raw = {
        pagination: { items: 2 },
        results: [{ id: 5, title: 'Sade - Diamond Life' }, { id: 6, title: 'no separator' }],
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(raw), { status: 200 }));
      const out = await findMatch({ ...NONE, barcode: '025218843123' }, (p, ms) => searchDiscogsWith(p, 't', fetchMock, ms));
      expect(out.body).toMatchObject({ match: 'several' });
      expect((out.body as { results: unknown[] }).results).toHaveLength(1);
    });
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
    expect(search.mock.calls[0][0]).toEqual({ barcode: '025218843123', format: 'Vinyl' });
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
    expect(search).toHaveBeenCalledWith({ q: 'Miles Davis Kind of Blue', format: 'Vinyl' }, 15_000);
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

  describe('within the budget', () => {
    const READ: Read = { ...NONE, barcode: '025218843123', catalog: 'CS 9000', artist: 'A', title: 'T' };

    it('gives each search 15 s, or what is left less a second', async () => {
      const lefts = [26_000, 9_000, 4_000];
      const search = vi.fn(async () => ok(0));
      await findMatch(READ, search, () => lefts[search.mock.calls.length] ?? 0);
      expect(search.mock.calls.map((c) => (c as unknown[])[1])).toEqual([15_000, 8_000, 3_000]);
    });

    it('answers what was read, with no match, when the time runs out before a search', async () => {
      let left = 10_000;
      const search = vi.fn(async () => {
        left = 900;
        return ok(0);
      });
      const out = await findMatch(READ, search, () => left);
      expect(search).toHaveBeenCalledTimes(1);
      expect(out).toEqual({ status: 200, body: { read: READ, match: 'none', results: [] } });
    });

    it('answers what was read, with no match, when a search was cut short by the budget', async () => {
      let left = 5_000;
      const search = vi.fn(async (): Promise<Answer> => {
        left = 1_000;
        return { status: 502, body: { error: 'discogs-down' } };
      });
      const out = await findMatch(READ, search, () => left);
      expect(out).toEqual({ status: 200, body: { read: READ, match: 'none', results: [] } });
    });

    it('still answers down when Discogs fails with time to spare', async () => {
      const out = await findMatch(READ, async () => ({ status: 502, body: { error: 'discogs-down' } }), () => 20_000);
      expect(out).toEqual({ status: 502, body: { error: 'down' } });
    });

    it('asks nothing when no time is left at all', async () => {
      const search = vi.fn(async () => ok(1));
      const out = await findMatch(READ, search, () => 500);
      expect(search).not.toHaveBeenCalled();
      expect(out).toEqual({ status: 200, body: { read: READ, match: 'none', results: [] } });
    });
  });
});
