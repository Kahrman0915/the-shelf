import { afterEach, describe, expect, it, vi } from 'vitest';
import { askDiscogs, DISCOGS_TIMEOUT_MS } from './discogs';

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
    expect(url).toBe('https://api.discogs.com/database/search?q=sade%20diamond%20life&type=release&format=Vinyl&per_page=6');
    expect(init.headers).toEqual({ Authorization: `Discogs token=${TOKEN}`, 'User-Agent': 'TheShelf/1.0 +https://the-shelf-sigma.vercel.app' });
  });

  it('gives Discogs 15 s, so the function answers before the app’s 20 s limit', async () => {
    expect(DISCOGS_TIMEOUT_MS).toBe(15_000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    await askDiscogs('sade', TOKEN, fetchMock);
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fetchMock.mock.calls[0][1].signal).toBe(timeout.mock.results[0].value);
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
