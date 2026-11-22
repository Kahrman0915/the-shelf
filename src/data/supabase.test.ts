import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, FETCH_TIMEOUT_MS, fetchWithTimeout, readConfig, shelfFetch, timeoutFor, UPLOAD_TIMEOUT_MS } from './supabase';

describe('readConfig', () => {
  it('returns the URL and publishable key', () => {
    expect(readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })).toEqual({
      url: 'https://x.supabase.co',
      key: 'sb_publishable_abc',
    });
  });

  it('fails loudly, naming what is missing and where to put it', () => {
    expect(() => readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toThrow(ConfigError);
    expect(() => readConfig({})).toThrow(/VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.*\.env\.local/s);
  });
});

describe('fetchWithTimeout', () => {
  /** A fetch that never answers, only gives up when its signal aborts. */
  const hanging = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
  );

  it('gives up on a request that takes too long, as an AbortError so postgrest-js does not retry it', async () => {
    await expect(fetchWithTimeout(20, hanging)('https://x.supabase.co/rest/v1/records')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('hands a normal response back unchanged', async () => {
    const response = new Response('[]');
    await expect(fetchWithTimeout(60_000, async () => response)('https://x.supabase.co/rest/v1/records')).resolves.toBe(response);
  });

  describe('without AbortSignal.timeout (Safari before 16)', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('still aborts after the timeout, as an AbortError', async () => {
      vi.useFakeTimers();
      const original = AbortSignal.timeout;
      vi.stubGlobal('AbortSignal', Object.assign(function () {}, { any: AbortSignal.any, abort: AbortSignal.abort }));
      expect((AbortSignal as unknown as { timeout?: unknown }).timeout).toBeUndefined();
      expect(original).toBeTypeOf('function');
      const request = fetchWithTimeout(FETCH_TIMEOUT_MS, hanging)('https://x.supabase.co/rest/v1/records');
      const outcome = expect(request).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1);
      let settled = false;
      request.catch(() => {}).finally(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await outcome;
    });

    it('lets a normal response through', async () => {
      vi.stubGlobal('AbortSignal', Object.assign(function () {}, { any: AbortSignal.any }));
      const response = new Response('[]');
      await expect(fetchWithTimeout(FETCH_TIMEOUT_MS, async () => response)('https://x.supabase.co/rest/v1/records')).resolves.toBe(response);
    });
  });

  it('still lets the caller cancel it', async () => {
    const caller = new AbortController();
    const request = fetchWithTimeout(60_000, hanging)('https://x.supabase.co/rest/v1/records', { signal: caller.signal });
    caller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes the request through unchanged otherwise', async () => {
    const answered = vi.fn(async () => new Response('[]'));
    await fetchWithTimeout(60_000, answered)('https://x.supabase.co/rest/v1/records', { method: 'POST', body: '{}' });
    expect(answered).toHaveBeenCalledWith('https://x.supabase.co/rest/v1/records', expect.objectContaining({ method: 'POST', body: '{}', signal: expect.any(AbortSignal) }));
  });

  it('uses 15 seconds by default', () => {
    expect(FETCH_TIMEOUT_MS).toBe(15_000);
  });
});

describe('supabase()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sends every request with a timeout', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_abc');
    const sent = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', sent);
    vi.resetModules();
    const mod = await import('./supabase');
    await mod.supabase().from('records').select('id');
    expect(sent).toHaveBeenCalled();
    expect(sent.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses a fixed, named storage key so a stale login can be found and cleared later', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_abc');
    vi.resetModules();
    const mod = await import('./supabase');
    const client = mod.supabase();
    expect((client.auth as unknown as { storageKey: string }).storageKey).toBe(mod.AUTH_STORAGE_KEY);
    expect(mod.AUTH_STORAGE_KEY).toBeTruthy();
  });
});

describe('timeoutFor', () => {
  const base = 'https://x.supabase.co';

  it('gives a photo upload two minutes, so a weak uplink at a show isn’t mistaken for no signal', () => {
    expect(UPLOAD_TIMEOUT_MS).toBe(120_000);
    expect(timeoutFor(`${base}/storage/v1/object/covers/s/r/front-p.jpg`, { method: 'POST' })).toBe(UPLOAD_TIMEOUT_MS);
    expect(timeoutFor(new URL(`${base}/storage/v1/object/covers/s/r/back-p.jpg`), { method: 'put' })).toBe(UPLOAD_TIMEOUT_MS);
    expect(timeoutFor(new Request(`${base}/storage/v1/object/covers/s/r/front-p.jpg`, { method: 'POST' }))).toBe(UPLOAD_TIMEOUT_MS);
  });

  it('keeps the usual timeout for everything else', () => {
    expect(timeoutFor(`${base}/storage/v1/object/authenticated/covers/s/r/front-p.jpg`)).toBe(FETCH_TIMEOUT_MS);
    expect(timeoutFor(`${base}/storage/v1/object/covers`, { method: 'DELETE' })).toBe(FETCH_TIMEOUT_MS);
    expect(timeoutFor(`${base}/storage/v1/object/sign/covers/s/r/front-p.jpg`, { method: 'POST' })).toBe(FETCH_TIMEOUT_MS);
    expect(timeoutFor(`${base}/storage/v1/object/list/covers`, { method: 'POST' })).toBe(FETCH_TIMEOUT_MS);
    expect(timeoutFor(`${base}/rest/v1/records`, { method: 'POST' })).toBe(FETCH_TIMEOUT_MS);
    expect(timeoutFor(`${base}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' })).toBe(FETCH_TIMEOUT_MS);
  });
});

describe('shelfFetch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A fetch that never answers, only gives up when its signal aborts. */
  const hanging = (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));

  async function settlesAfter(input: string, init: RequestInit): Promise<number> {
    vi.useFakeTimers();
    // Without AbortSignal.timeout the fallback timer is used, which fake timers can move on.
    vi.stubGlobal('AbortSignal', Object.assign(function () {}, { any: AbortSignal.any, abort: AbortSignal.abort }));
    const started = Date.now();
    const request = shelfFetch(hanging)(input, init).catch((e: unknown) => e);
    let done = false;
    void request.then(() => (done = true));
    while (!done && Date.now() - started <= UPLOAD_TIMEOUT_MS) await vi.advanceTimersByTimeAsync(1_000);
    expect(await request).toMatchObject({ name: 'AbortError' });
    return Date.now() - started;
  }

  it('waits for an upload longer than for a read', async () => {
    expect(await settlesAfter('https://x.supabase.co/storage/v1/object/covers/s/r/front-p.jpg', { method: 'POST' })).toBe(UPLOAD_TIMEOUT_MS);
    expect(await settlesAfter('https://x.supabase.co/rest/v1/records', { method: 'GET' })).toBe(FETCH_TIMEOUT_MS);
  });
});
