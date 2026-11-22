import { afterEach, describe, expect, it, vi } from 'vitest';
import { askDiscogs, DISCOGS_TIMEOUT_MS, searchDiscogsWith } from './discogs';

const TOKEN = 'secret-token-123';
const entry = { id: 5, title: 'Sade - Diamond Life', label: ['Epic'], genre: ['Funk / Soul'], style: [] };

describe('askDiscogs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const quietLog = () => vi.spyOn(console, 'error').mockImplementation(() => {});
  /** Everything logged, as one string, to check nothing secret slipped in. */
  const logged = (log: ReturnType<typeof quietLog>) => log.mock.calls.flat().map(String).join('\n');

  it('searches vinyl releases with the token and User-Agent, and shapes the answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [entry] }), { status: 200 }));
    const answer = await askDiscogs('sade diamond life', TOKEN, fetchMock);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ results: [{ releaseId: 5, artist: 'Sade', title: 'Diamond Life', label: 'Epic' }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.discogs.com/database/search?q=sade%20diamond%20life&format=Vinyl&type=release&per_page=6');
    expect(init.headers).toEqual({ Authorization: `Discogs token=${TOKEN}`, 'User-Agent': 'TheShelf/1.0 +https://the-shelf-sigma.vercel.app' });
  });

  it('searchDiscogsWith sends the given params with type=release and per_page=6', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [entry] }), { status: 200 }));
    const answer = await searchDiscogsWith({ barcode: '0123' }, TOKEN, fetchMock);
    expect(answer.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.discogs.com/database/search?barcode=0123&type=release&per_page=6');
    expect(url).not.toContain('q=');
    expect(init.headers).toEqual({ Authorization: `Discogs token=${TOKEN}`, 'User-Agent': 'TheShelf/1.0 +https://the-shelf-sigma.vercel.app' });
  });

  it('askDiscogs still searches vinyl by q', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    await askDiscogs('sade', TOKEN, fetchMock);
    expect(fetchMock.mock.calls[0][0]).toContain('q=sade&format=Vinyl');
  });

  it('gives Discogs 15 s, so the function answers before the app’s 20 s limit', async () => {
    expect(DISCOGS_TIMEOUT_MS).toBe(15_000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    await askDiscogs('sade', TOKEN, fetchMock);
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fetchMock.mock.calls[0][1].signal).toBe(timeout.mock.results[0].value);
  });

  it('searchDiscogsWith takes a shorter timeout when it is given one', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    await searchDiscogsWith({ barcode: '0123' }, TOKEN, fetchMock, 4_000);
    expect(timeout).toHaveBeenCalledWith(4_000);
    expect(fetchMock.mock.calls[0][1].signal).toBe(timeout.mock.results[0].value);
  });

  it('carries Discogs’ own count of releases as total, or null without one', async () => {
    const counted = { pagination: { items: 2 }, results: [entry, { id: 6, title: 'no separator' }] };
    const withCount = await searchDiscogsWith({ barcode: '0123' }, TOKEN, vi.fn().mockResolvedValue(new Response(JSON.stringify(counted), { status: 200 })));
    expect(withCount.body).toMatchObject({ total: 2 });
    expect((withCount.body as { results: unknown[] }).results).toHaveLength(1);
    const without = await searchDiscogsWith({ barcode: '0123' }, TOKEN, vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [entry] }), { status: 200 })));
    expect(without.body).toMatchObject({ total: null });
    const odd = { pagination: { items: 'two' }, results: [entry] };
    const oddCount = await searchDiscogsWith({ barcode: '0123' }, TOKEN, vi.fn().mockResolvedValue(new Response(JSON.stringify(odd), { status: 200 })));
    expect(oddCount.body).toMatchObject({ total: null });
  });

  it('passes a 429 on as rate-limited', async () => {
    const answer = await askDiscogs('sade', TOKEN, vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    expect(answer).toEqual({ status: 429, body: { error: 'rate-limited' } });
  });

  it('answers 502 for a Discogs error, logging only the status', async () => {
    const log = quietLog();
    const answer = await askDiscogs('sade', TOKEN, vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    expect(answer).toEqual({ status: 502, body: { error: 'discogs-down' } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(logged(log)).toContain('503');
    expect(logged(log)).not.toMatch(/secret-token|api\.discogs\.com|Authorization|User-Agent/);
  });

  it('answers 502 when the request fails or times out, logging only the error’s name', async () => {
    const log = quietLog();
    const leaky = new TypeError(`error sending request for url (https://api.discogs.com/database/search?q=sade): token=${TOKEN}`);
    expect(await askDiscogs('sade', TOKEN, vi.fn().mockRejectedValue(leaky))).toEqual({ status: 502, body: { error: 'discogs-down' } });
    const timedOut = new DOMException('Signal timed out.', 'TimeoutError');
    expect(await askDiscogs('sade', TOKEN, vi.fn().mockRejectedValue(timedOut))).toEqual({ status: 502, body: { error: 'discogs-down' } });
    expect(log).toHaveBeenCalledTimes(2);
    expect(logged(log)).toContain('TypeError');
    expect(logged(log)).toContain('TimeoutError');
    expect(logged(log)).not.toMatch(/secret-token|api\.discogs\.com|Authorization|User-Agent|timed out/);
  });

  it('answers 502 for unreadable json', async () => {
    const log = quietLog();
    const answer = await askDiscogs('sade', TOKEN, vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    expect(answer).toEqual({ status: 502, body: { error: 'discogs-down' } });
    expect(logged(log)).toContain('SyntaxError');
  });

  it('answers 502 without calling Discogs when the token is missing', async () => {
    const log = quietLog();
    const fetchMock = vi.fn();
    expect(await askDiscogs('sade', undefined, fetchMock)).toEqual({ status: 502, body: { error: 'discogs-down' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
