import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError, DISCOGS_MESSAGES, NO_SIGNAL, REJECTED } from './backend';
import { StorageClient } from '@supabase/storage-js';
import { AUTH_STORAGE_KEY } from './supabase';
import { DISCOGS_TIMEOUT_MS, offlineLooking, rejectionReason, supabaseBackend } from './supabaseBackend';

/** A chainable stand-in for a Supabase PostgrestFilterBuilder: every filter/order method returns
 *  the same object, and it resolves (like the real one does when awaited) when range() is called,
 *  pulling the next page off a queue so callers can exercise the range-loop pagination. */
function pagedQuery(pages: Record<string, unknown>[][]) {
  const calls: { method: string; args: unknown[] }[] = [];
  let pageIndex = 0;
  const builder = {
    eq(...args: unknown[]) {
      calls.push({ method: 'eq', args });
      return builder;
    },
    gt(...args: unknown[]) {
      calls.push({ method: 'gt', args });
      return builder;
    },
    order(...args: unknown[]) {
      calls.push({ method: 'order', args });
      return builder;
    },
    range(...args: unknown[]) {
      calls.push({ method: 'range', args });
      const page = pages[pageIndex] ?? [];
      pageIndex += 1;
      return Promise.resolve({ data: page, error: null });
    },
  };
  return { builder, calls };
}

function clientWith(builder: unknown) {
  return { auth: { signOut: vi.fn() }, from: () => ({ select: () => builder }) } as never;
}

describe('supabaseBackend().recordsSince', () => {
  it('pages through more than one page and sorts by updated_at then id', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, updated_at: '2024-01-01' }));
    const page2 = [{ id: 'r1000', updated_at: '2024-01-02' }];
    const { builder, calls } = pagedQuery([page1, page2]);
    const client = clientWith(builder);
    const backend = supabaseBackend(client);

    const rows = await backend.recordsSince('shelf-1', null);

    expect(rows).toHaveLength(1001);
    const orderCalls = calls.filter((c) => c.method === 'order').map((c) => c.args[0]);
    expect(orderCalls).toEqual(['updated_at', 'id', 'updated_at', 'id']);
    const rangeCalls = calls.filter((c) => c.method === 'range');
    expect(rangeCalls).toEqual([
      { method: 'range', args: [0, 999] },
      { method: 'range', args: [1000, 1999] },
    ]);
  });
});

describe('supabaseBackend().ratings', () => {
  it('pages through more than one page and sorts by record_id then user_id', async () => {
    const row = (i: number) => ({ record_id: `r${i}`, user_id: `u${i}`, value: 3, updated_at: '2024-01-01', records: { shelf_id: 'shelf-1' } });
    const page1 = Array.from({ length: 1000 }, (_, i) => row(i));
    const page2 = [row(1000)];
    const { builder, calls } = pagedQuery([page1, page2]);
    const client = clientWith(builder);
    const backend = supabaseBackend(client);

    const rows = await backend.ratings('shelf-1');

    expect(rows).toHaveLength(1001);
    expect(rows[0]).not.toHaveProperty('records');
    const orderCalls = calls.filter((c) => c.method === 'order').map((c) => c.args[0]);
    expect(orderCalls).toEqual(['record_id', 'user_id', 'record_id', 'user_id']);
    const rangeCalls = calls.filter((c) => c.method === 'range');
    expect(rangeCalls).toEqual([
      { method: 'range', args: [0, 999] },
      { method: 'range', args: [1000, 1999] },
    ]);
  });
});

describe('supabaseBackend().signOut', () => {
  beforeEach(() => localStorage.clear());

  it('signs out this phone only, not the person’s other devices', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    await supabaseBackend({ auth: { signOut }, from: vi.fn() } as never).signOut();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('removes the stored login itself and still fails loudly when the server round-trip errors', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, '{"fake":"session"}');
    const client = { auth: { signOut: vi.fn().mockResolvedValue({ error: { message: 'Failed to fetch' } }) }, from: vi.fn() } as never;
    const backend = supabaseBackend(client);

    await expect(backend.signOut()).rejects.toThrow(BackendError);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('does not blow up when localStorage.removeItem itself throws', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, '{"fake":"session"}');
    const client = { auth: { signOut: vi.fn().mockResolvedValue({ error: { message: 'Failed to fetch' } }) }, from: vi.fn() } as never;
    const backend = supabaseBackend(client);
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => {
      throw new Error('blocked');
    };
    try {
      await expect(backend.signOut()).rejects.toThrow(BackendError);
    } finally {
      Storage.prototype.removeItem = original;
    }
  });
});

type Result = { data?: unknown; error?: { code?: string; message: string } | null };

/** A client whose records/ratings tables record each call and answer from a queue per operation. */
function writeClient(answers: { insert?: Result[]; update?: Result[] }) {
  const calls: { op: string; args: unknown[] }[] = [];
  const queue = { insert: [...(answers.insert ?? [])], update: [...(answers.update ?? [])] };
  const next = (op: 'insert' | 'update'): Result => queue[op].shift() ?? { data: [], error: null };
  const client = {
    from: (table: string) => ({
      insert: (...args: unknown[]) => {
        calls.push({ op: `${table}.insert`, args });
        return Promise.resolve(next('insert'));
      },
      update: (...args: unknown[]) => {
        calls.push({ op: `${table}.update`, args });
        const chain = {
          eq(...a: unknown[]) {
            calls.push({ op: `${table}.eq`, args: a });
            return chain;
          },
          select(...a: unknown[]) {
            calls.push({ op: `${table}.select`, args: a });
            return Promise.resolve(next('update'));
          },
        };
        return chain;
      },
    }),
  } as never;
  return { client, calls };
}

const NEW_ROW = { id: 'rec-1' } as never;

describe('supabaseBackend().insertRecord', () => {
  it('resolves inserted', async () => {
    const { client, calls } = writeClient({ insert: [{ error: null }] });
    await expect(supabaseBackend(client).insertRecord(NEW_ROW)).resolves.toBe('inserted');
    expect(calls[0]).toEqual({ op: 'records.insert', args: [NEW_ROW] });
  });

  it('resolves already-there on a duplicate key', async () => {
    const { client } = writeClient({ insert: [{ error: { code: '23505', message: 'duplicate key' } }] });
    await expect(supabaseBackend(client).insertRecord(NEW_ROW)).resolves.toBe('already-there');
  });

  it('throws NO_SIGNAL when the request cannot reach the server', async () => {
    const { client } = writeClient({ insert: [{ error: { message: 'Failed to fetch' } }] });
    await expect(supabaseBackend(client).insertRecord(NEW_ROW)).rejects.toThrow(new BackendError(NO_SIGNAL));
  });

  it('throws the plain-words permission reason when the shelf says no', async () => {
    const { client } = writeClient({ insert: [{ error: { code: '42501', message: 'permission denied for table records' } }] });
    await expect(supabaseBackend(client).insertRecord(NEW_ROW)).rejects.toThrow(new BackendError(REJECTED.permission));
  });
});

describe('supabaseBackend().patchRecord', () => {
  it('updates by id and asks for the id back, so a missing row is noticed', async () => {
    const { client, calls } = writeClient({ update: [{ data: [{ id: 'rec-1' }], error: null }] });
    await expect(supabaseBackend(client).patchRecord('rec-1', { status: 'owned' })).resolves.toBe('patched');
    expect(calls).toEqual([
      { op: 'records.update', args: [{ status: 'owned' }] },
      { op: 'records.eq', args: ['id', 'rec-1'] },
      { op: 'records.select', args: ['id'] },
    ]);
  });

  it('resolves missing when no row matched', async () => {
    const { client } = writeClient({ update: [{ data: [], error: null }] });
    await expect(supabaseBackend(client).patchRecord('rec-1', { status: 'owned' })).resolves.toBe('missing');
  });

  it('throws NO_SIGNAL offline', async () => {
    const { client } = writeClient({ update: [{ error: { message: 'NetworkError' } }] });
    await expect(supabaseBackend(client).patchRecord('rec-1', {})).rejects.toThrow(new BackendError(NO_SIGNAL));
  });
});

describe('supabaseBackend().setRating', () => {
  it('updates first, and inserts when there was no rating to update', async () => {
    const { client, calls } = writeClient({ update: [{ data: [], error: null }], insert: [{ error: null }] });
    await supabaseBackend(client).setRating('rec-1', 'user-1', 4);
    expect(calls.map((c) => c.op)).toEqual(['ratings.update', 'ratings.eq', 'ratings.eq', 'ratings.select', 'ratings.insert']);
    expect(calls[0].args).toEqual([{ value: 4 }]);
    expect(calls[4].args).toEqual([{ record_id: 'rec-1', user_id: 'user-1', value: 4 }]);
  });

  it('does not insert when the update found the rating', async () => {
    const { client, calls } = writeClient({ update: [{ data: [{ record_id: 'rec-1' }], error: null }] });
    await supabaseBackend(client).setRating('rec-1', 'user-1', 4);
    expect(calls.some((c) => c.op === 'ratings.insert')).toBe(false);
  });

  it('updates again when the insert loses a race to the same person on another phone', async () => {
    const { client, calls } = writeClient({
      update: [{ data: [], error: null }, { data: [{ record_id: 'rec-1' }], error: null }],
      insert: [{ error: { code: '23505', message: 'duplicate key' } }],
    });
    await supabaseBackend(client).setRating('rec-1', 'user-1', 5);
    expect(calls.filter((c) => c.op === 'ratings.update')).toHaveLength(2);
  });

  it('throws a plain reason when the shelf refuses the value', async () => {
    const { client } = writeClient({ update: [{ error: { code: '23514', message: 'check violation' } }] });
    await expect(supabaseBackend(client).setRating('rec-1', 'user-1', 9)).rejects.toThrow(new BackendError(REJECTED.range));
  });
});

describe('offlineLooking', () => {
  it('reads a request that timed out or was cut off as no signal', () => {
    // How postgrest-js reports a fetch that our timeout aborted.
    expect(offlineLooking({ message: 'TimeoutError: signal timed out' })).toBe(true);
    expect(offlineLooking({ message: 'AbortError: This operation was aborted' })).toBe(true);
    // The DOMException itself, if one ever reaches it directly.
    expect(offlineLooking(new DOMException('signal timed out', 'TimeoutError'))).toBe(true);
    expect(offlineLooking(new DOMException('This operation was aborted', 'AbortError'))).toBe(true);
  });

  it('doesn’t mistake a refusal for no signal', () => {
    expect(offlineLooking({ message: 'new row violates row-level security policy' })).toBe(false);
  });

  it('turns a timed-out write into no signal, so the change waits instead of being rejected', async () => {
    const { client } = writeClient({ insert: [{ error: { code: '', message: 'TimeoutError: signal timed out' } }] });
    await expect(supabaseBackend(client).insertRecord(NEW_ROW)).rejects.toThrow(new BackendError(NO_SIGNAL));
  });
});

describe('rejectionReason', () => {
  it('maps known codes to plain words', () => {
    expect(rejectionReason({ code: '42501', message: 'x' })).toBe(REJECTED.permission);
    expect(rejectionReason({ message: 'new row violates row-level security policy' })).toBe(REJECTED.permission);
    expect(rejectionReason({ code: '23514', message: 'x' })).toBe(REJECTED.range);
    expect(rejectionReason({ code: '22P02', message: 'x' })).toBe(REJECTED.unknownValue);
    expect(rejectionReason({ code: '23503', message: 'x' })).toBe(REJECTED.missing);
  });

  it('falls back to the code', () => {
    expect(rejectionReason({ code: 'XX000', message: 'boom' })).toBe('The shelf refused this change. (XX000)');
    expect(rejectionReason({ message: 'boom' })).toBe('The shelf refused this change. (unknown)');
  });
});

describe('supabaseBackend().searchDiscogs', () => {
  const found = { releaseId: 1, artist: 'Sade', title: 'Diamond Life', label: null, catalog: null, year: 1984, format: 'LP', country: null, genres: [], styles: [], thumb: null };
  const withSession = (session: { access_token: string } | null) =>
    ({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }) } }) as never;
  const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'pub-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('posts the query with the bearer token and apikey, and returns results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { results: [found] }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await supabaseBackend(withSession({ access_token: 'tok' })).searchDiscogs('  sade diamond life ');
    expect(results).toEqual([found]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.supabase.co/functions/v1/discogs-search');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', apikey: 'pub-key', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ query: 'sade diamond life' });
  });

  it('turns a 429 into the rate-limited message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(429, { error: 'rate-limited' })));
    await expect(supabaseBackend(withSession({ access_token: 't' })).searchDiscogs('sade')).rejects.toThrow(DISCOGS_MESSAGES.rateLimited);
  });

  it('turns any other failure into the down message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(500)));
    await expect(supabaseBackend(withSession({ access_token: 't' })).searchDiscogs('sade')).rejects.toThrow(DISCOGS_MESSAGES.down);
  });

  it('treats a network error as no signal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(supabaseBackend(withSession({ access_token: 't' })).searchDiscogs('sade')).rejects.toThrow(NO_SIGNAL);
  });

  it('treats Safari’s network failure (TypeError: Load failed) as no signal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')));
    await expect(supabaseBackend(withSession({ access_token: 't' })).searchDiscogs('sade')).rejects.toThrow(NO_SIGNAL);
  });

  it('treats a timeout (AbortError) as Discogs not responding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The request timed out.', 'AbortError')));
    await expect(supabaseBackend(withSession({ access_token: 't' })).searchDiscogs('sade')).rejects.toThrow(DISCOGS_MESSAGES.down);
  });

  it('treats any failure as no signal when the phone is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The request timed out.', 'AbortError')));
      await expect(supabaseBackend(withSession({ access_token: 't' })).searchDiscogs('sade')).rejects.toThrow(NO_SIGNAL);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).onLine;
    }
  });

  it('gives the function 20 s, not the shelf’s 15 s', async () => {
    expect(DISCOGS_TIMEOUT_MS).toBe(20_000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, { results: [] })));
    await supabaseBackend(withSession({ access_token: 't' })).searchDiscogs('sade');
    expect(timeout).toHaveBeenCalledWith(20_000);
    timeout.mockRestore();
  });

  it('asks to sign in again when the function answers 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(401, { msg: 'Invalid JWT' })));
    const failure = supabaseBackend(withSession({ access_token: 't' })).searchDiscogs('sade');
    await expect(failure).rejects.toBeInstanceOf(BackendError);
    await expect(failure).rejects.toThrow('Sign in again to search.');
  });

  it('asks to sign in again when there is no session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(supabaseBackend(withSession(null)).searchDiscogs('sade')).rejects.toThrow('Sign in again to search.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls the server for a query under two characters', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const backend = supabaseBackend(withSession({ access_token: 't' }));
    expect(await backend.searchDiscogs(' a ')).toEqual([]);
    expect(await backend.searchDiscogs('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls the server for a query over 200 characters', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const backend = supabaseBackend(withSession({ access_token: 't' }));
    expect(await backend.searchDiscogs(`  ${'x'.repeat(201)}  `)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(reply(200, { results: [found] }));
    expect(await backend.searchDiscogs(`  ${'x'.repeat(200)}  `)).toEqual([found]);
  });
});

describe('supabaseBackend() photos', () => {
  const PATH = 'shelf-1/rec-1/front-abc.jpg';
  function storageClient() {
    const bucket = { upload: vi.fn(), download: vi.fn(), remove: vi.fn() };
    const from = vi.fn(() => bucket);
    return { bucket, from, backend: supabaseBackend({ storage: { from } } as never) };
  }

  it('uploadPhoto sends a JPEG to the covers bucket, overwriting', async () => {
    const { bucket, from, backend } = storageClient();
    bucket.upload.mockResolvedValue({ data: {}, error: null });
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    await backend.uploadPhoto(PATH, bytes);
    expect(from).toHaveBeenCalledWith('covers');
    expect(bucket.upload).toHaveBeenCalledWith(PATH, bytes, { contentType: 'image/jpeg', upsert: true });
  });

  it('uploadPhoto: offline → NO_SIGNAL', async () => {
    const { bucket, backend } = storageClient();
    bucket.upload.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    await expect(backend.uploadPhoto(PATH, new ArrayBuffer(1))).rejects.toThrow(new BackendError(NO_SIGNAL));
  });

  it('uploadPhoto: refused by the rules → REJECTED.permission', async () => {
    const { bucket, backend } = storageClient();
    bucket.upload.mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } });
    await expect(backend.uploadPhoto(PATH, new ArrayBuffer(1))).rejects.toThrow(new BackendError(REJECTED.permission));
  });

  it('uploadPhoto: too large → REJECTED.photoTooBig', async () => {
    const { bucket, backend } = storageClient();
    bucket.upload.mockResolvedValue({ data: null, error: { statusCode: '413', message: 'Payload too large' } });
    await expect(backend.uploadPhoto(PATH, new ArrayBuffer(1))).rejects.toThrow(new BackendError(REJECTED.photoTooBig));
  });

  it('uploadPhoto: anything else → REJECTED.other with the status', async () => {
    const { bucket, backend } = storageClient();
    bucket.upload.mockResolvedValue({ data: null, error: { statusCode: '500', message: 'Boom' } });
    await expect(backend.uploadPhoto(PATH, new ArrayBuffer(1))).rejects.toThrow(new BackendError(REJECTED.other('photo 500')));
  });

  it('downloadPhoto returns the bytes', async () => {
    const { bucket, from, backend } = storageClient();
    bucket.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2])]), error: null });
    const got = await backend.downloadPhoto(PATH);
    expect(from).toHaveBeenCalledWith('covers');
    expect(bucket.download).toHaveBeenCalledWith(PATH);
    expect(got).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(got!)]).toEqual([1, 2]);
  });

  it('downloadPhoto: not there yet → null', async () => {
    const { bucket, backend } = storageClient();
    bucket.download.mockResolvedValue({ data: null, error: { message: 'Object not found', statusCode: '404' } });
    expect(await backend.downloadPhoto(PATH)).toBeNull();
    bucket.download.mockResolvedValue({ data: null, error: { message: 'Object not found', statusCode: '400' } });
    expect(await backend.downloadPhoto(PATH)).toBeNull();
  });

  it('downloadPhoto: offline → NO_SIGNAL', async () => {
    const { bucket, backend } = storageClient();
    bucket.download.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    await expect(backend.downloadPhoto(PATH)).rejects.toThrow(new BackendError(NO_SIGNAL));
  });

  it('deletePhoto removes that one path', async () => {
    const { bucket, from, backend } = storageClient();
    bucket.remove.mockResolvedValue({ data: [], error: null });
    await backend.deletePhoto(PATH);
    expect(from).toHaveBeenCalledWith('covers');
    expect(bucket.remove).toHaveBeenCalledWith([PATH]);
  });

  it('deletePhoto: offline → NO_SIGNAL', async () => {
    const { bucket, backend } = storageClient();
    bucket.remove.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    await expect(backend.deletePhoto(PATH)).rejects.toThrow(new BackendError(NO_SIGNAL));
  });
  it.each([
    ['a timeout', 'The request timed out.'],
    ['a Safari network failure', 'Load failed'],
  ])('%s from storage-js is NO_SIGNAL for upload, download and delete', async (_label, message) => {
    const { bucket, backend } = storageClient();
    const error = { name: 'StorageUnknownError', message };
    bucket.upload.mockResolvedValue({ data: null, error });
    bucket.download.mockResolvedValue({ data: null, error });
    bucket.remove.mockResolvedValue({ data: null, error });
    await expect(backend.uploadPhoto(PATH, new ArrayBuffer(1))).rejects.toThrow(new BackendError(NO_SIGNAL));
    await expect(backend.downloadPhoto(PATH)).rejects.toThrow(new BackendError(NO_SIGNAL));
    await expect(backend.deletePhoto(PATH)).rejects.toThrow(new BackendError(NO_SIGNAL));
  });

  it('a real StorageClient whose fetch rejects gives NO_SIGNAL', async () => {
    for (const reason of [new TypeError('Load failed'), new DOMException('The request timed out.', 'AbortError')]) {
      const storage = new StorageClient('http://localhost/storage/v1', {}, (() => Promise.reject(reason)) as typeof fetch);
      const backend = supabaseBackend({ storage } as never);
      await expect(backend.uploadPhoto(PATH, new ArrayBuffer(1))).rejects.toThrow(new BackendError(NO_SIGNAL));
      await expect(backend.downloadPhoto(PATH)).rejects.toThrow(new BackendError(NO_SIGNAL));
      await expect(backend.deletePhoto(PATH)).rejects.toThrow(new BackendError(NO_SIGNAL));
    }
  });
});
