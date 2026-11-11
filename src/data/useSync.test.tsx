import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBackend } from '@/test/fakeBackend';
import { ShelfDB, writeSession } from './db';
import { savePostcards } from './outbox';
import type { ShelfRecord } from './schema';
import { useSync } from './useSync';

const SHELF = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333';
const WHEN = '2026-11-11T10:00:00.000Z';

function record(id: string): ShelfRecord {
  return {
    id, shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null, artist: 'Miles Davis', title: 'Kind of Blue',
    label: null, catalog: null, year: null, format: null, genre: 'jazz', discGrade: null, sleeveGrade: null, pricePaid: null,
    nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null, discogsReleaseId: null, coverPath: null,
    boughtAt: null, addedBy: ME, createdAt: WHEN, updatedAt: WHEN, deletedAt: null, importKey: null,
  };
}

let db: ShelfDB;
let backend: FakeBackend;

beforeEach(async () => {
  db = new ShelfDB(`usesync-${crypto.randomUUID()}`);
  await writeSession(db, { userId: ME, email: 'me@example.com', shelfId: SHELF });
  backend = new FakeBackend({});
});
afterEach(async () => {
  await db.delete();
});

describe('useSync', () => {
  it('syncs on mount', async () => {
    const spy = vi.spyOn(backend, 'recordsSince');
    const { result } = renderHook(() => useSync(backend, SHELF, db));
    await waitFor(() => expect(result.current.lastSyncedAt).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.problem).toBeNull();
  });

  it('syncs again when the phone comes back online', async () => {
    const spy = vi.spyOn(backend, 'recordsSince');
    const { result } = renderHook(() => useSync(backend, SHELF, db));
    await waitFor(() => expect(result.current.lastSyncedAt).not.toBeNull());
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it('runNow sends a waiting postcard', async () => {
    const { result } = renderHook(() => useSync(backend, SHELF, db));
    await waitFor(() => expect(result.current.lastSyncedAt).not.toBeNull());
    await savePostcards(db, [{ kind: 'record.create', shelfId: SHELF, recordId: A, userId: ME, createdAt: WHEN, fields: record(A) }]);
    act(() => result.current.runNow());
    await waitFor(() => expect(backend.recordRow(A)).toBeDefined());
    await waitFor(async () => expect(await db.outbox.count()).toBe(0));
  });

  it('reports no-signal and failures differently', async () => {
    backend.online = false;
    const offline = renderHook(() => useSync(backend, SHELF, db));
    await waitFor(() => expect(offline.result.current.problem).toEqual({ kind: 'no-signal' }));
    offline.unmount();

    backend.online = true;
    vi.spyOn(backend, 'recordsSince').mockResolvedValue([{ id: 'bad' }]);
    const broken = renderHook(() => useSync(backend, SHELF, db));
    await waitFor(() => expect(broken.result.current.problem?.kind).toBe('failed'));
    const p = broken.result.current.problem;
    expect(p && p.kind === 'failed' && p.message.startsWith('The shelf sent something this app can’t read:')).toBe(true);
  });

  it('does not let discard overlap a run in progress', async () => {
    const { result } = renderHook(() => useSync(backend, SHELF, db));
    await waitFor(() => expect(result.current.lastSyncedAt).not.toBeNull());
    await savePostcards(db, [{ kind: 'record.create', shelfId: SHELF, recordId: A, userId: ME, createdAt: WHEN, fields: record(A) }]);
    backend.rejectNext = 'The shelf refused this change. (x)';
    await act(async () => result.current.runNow());
    await waitFor(async () => expect((await db.outbox.toArray())[0]?.state).toBe('rejected'));
    const seq = (await db.outbox.toArray())[0].seq;

    // Make every pull slow and log when each pull starts and finishes.
    const log: string[] = [];
    const real = backend.recordsSince.bind(backend);
    let n = 0;
    vi.spyOn(backend, 'recordsSince').mockImplementation(async (s, since) => {
      const id = ++n;
      log.push(`start ${id}`);
      await new Promise((r) => setTimeout(r, 60));
      const rows = await real(s, since);
      log.push(`end ${id}`);
      return rows;
    });

    let discarded!: Promise<void>;
    act(() => {
      result.current.runNow();
      discarded = result.current.discard(seq);
    });
    await act(async () => {
      await discarded;
    });
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
    expect(await db.outbox.count()).toBe(0);
  });

  it('retry sends a rejected postcard again', async () => {
    const { result } = renderHook(() => useSync(backend, SHELF, db));
    await waitFor(() => expect(result.current.lastSyncedAt).not.toBeNull());
    await savePostcards(db, [{ kind: 'record.create', shelfId: SHELF, recordId: A, userId: ME, createdAt: WHEN, fields: record(A) }]);
    backend.rejectNext = 'The shelf refused this change. (x)';
    act(() => result.current.runNow());
    await waitFor(async () => expect((await db.outbox.toArray())[0]?.state).toBe('rejected'));
    const seq = (await db.outbox.toArray())[0].seq;

    await act(async () => {
      await result.current.retry(seq);
    });
    expect(await db.outbox.count()).toBe(0);
    expect(backend.recordRow(A)).toBeDefined();
  });

  it('turns a retry failure into the problem, not an unhandled rejection', async () => {
    const { result } = renderHook(() => useSync(backend, SHELF, db));
    await waitFor(() => expect(result.current.lastSyncedAt).not.toBeNull());
    vi.spyOn(db.outbox, 'update').mockRejectedValueOnce(new Error('Disk is full'));
    await act(async () => {
      await result.current.retry(1);
    });
    expect(result.current.problem).toEqual({ kind: 'failed', message: 'Disk is full' });
  });
});
