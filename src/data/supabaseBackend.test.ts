import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from './backend';
import { AUTH_STORAGE_KEY } from './supabase';
import { supabaseBackend } from './supabaseBackend';

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
