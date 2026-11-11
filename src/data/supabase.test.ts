import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, FETCH_TIMEOUT_MS, fetchWithTimeout, readConfig } from './supabase';

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

  it('gives up on a request that takes too long, with a TimeoutError', async () => {
    await expect(fetchWithTimeout(20, hanging)('https://x.supabase.co/rest/v1/records')).rejects.toMatchObject({ name: 'TimeoutError' });
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
