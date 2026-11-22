import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, writeSession } from '@/data/db';
import { readFunFactQueue, wantFunFact } from '@/data/funFacts';
import type { ShelfRecord } from '@/data/schema';
import { FakeBackend } from '@/test/fakeBackend';
import { BackendProvider } from './BackendContext';
import { CurrentShelfProvider } from './CurrentShelf';
import { SyncContext } from './SyncContext';
import { FUN_FACT_RETRY_MS, useFunFacts, useFunFactStatus } from './useFunFacts';
import { sectionIdFor } from '@/domain/sections';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';
const A = '33333333-3333-4333-8333-333333333333';
const FACT = { fact: 'Recorded in two sessions in 1959.', sourceUrl: 'https://example.com/kind-of-blue' };

function record(over: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: A, shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null,
    artist: 'Miles Davis', title: 'Kind of Blue', label: null, catalog: null, year: null, format: null, sectionId: sectionIdFor(SHELF, 'jazz'),
    discGrade: null, sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null,
    discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null,
    addedBy: ME, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...over,
  };
}

function Runner() {
  useFunFacts();
  return null;
}

const SYNCED = '2026-11-22T09:00:00.000Z';

/** Show the runner again with this session's last sync at another time, as the sync does. */
let resync: (lastSyncedAt: string | null) => void = () => {};

function mount(backend: FakeBackend, runNow = vi.fn(), lastSyncedAt: string | null = SYNCED) {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  const tree = (at: string | null) => (
    <BackendProvider backend={backend}>
      <CurrentShelfProvider value={shelf}>
        <SyncContext.Provider value={{ lastSyncedAt: at, problem: null, runNow, retry: async () => {}, discard: async () => {} }}>
          <Runner />
        </SyncContext.Provider>
      </CurrentShelfProvider>
    </BackendProvider>
  );
  const { rerender } = render(tree(lastSyncedAt));
  resync = (at) => rerender(tree(at));
  return runNow;
}

/** Let any work already started settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

beforeEach(async () => {
  await db.delete();
  await db.open();
  await writeSession(db, { userId: ME, email: 'k@example.com', shelfId: SHELF });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useFunFacts', () => {
  it('a record queued before mount gets its fact, and the courier is started', async () => {
    await db.records.put(record());
    await wantFunFact(db, A);
    const backend = new FakeBackend({});
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    const runNow = mount(backend);
    await waitFor(async () => expect((await db.records.get(A))?.funFact).toBe(FACT.fact));
    expect((await db.outbox.toArray()).map((p) => p.userId)).toEqual([ME]);
    expect(runNow).toHaveBeenCalled();
  });

  it('a record queued after mount gets its fact', async () => {
    await db.records.put(record());
    const backend = new FakeBackend({});
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    mount(backend);
    await act(() => wantFunFact(db, A));
    await waitFor(async () => expect((await db.records.get(A))?.funFact).toBe(FACT.fact));
  });

  it('works the queue again when the signal comes back', async () => {
    await db.records.put(record());
    await wantFunFact(db, A);
    const backend = new FakeBackend({});
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    backend.online = false;
    const ask = vi.spyOn(backend, 'findFunFact');
    mount(backend);
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect((await db.records.get(A))?.funFact).toBeNull();
    backend.online = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(async () => expect((await db.records.get(A))?.funFact).toBe(FACT.fact));
  });

  it('a record queued again after it left the queue (the button) is asked about promptly', async () => {
    await db.records.put(record());
    await wantFunFact(db, A);
    const backend = new FakeBackend({});
    mount(backend);
    await waitFor(async () => expect(await db.meta.get(`funFactNone:${A}`)).toBeDefined());
    await waitFor(async () => expect(await readFunFactQueue(db)).toEqual([]));
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    await act(() => wantFunFact(db, A));
    await waitFor(async () => expect((await db.records.get(A))?.funFact).toBe(FACT.fact));
    expect(backend.funFactCalls).toHaveLength(2);
  });

  it('asks nothing until this session’s first sync has finished, then works the queue once', async () => {
    // A record queued while offline: a fact typed on the other phone may be on its way in that sync.
    await db.records.put(record());
    await wantFunFact(db, A);
    const backend = new FakeBackend({});
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    mount(backend, vi.fn(), null);
    await settle();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await settle();
    expect(backend.funFactCalls).toEqual([]);
    resync(SYNCED);
    await waitFor(async () => expect((await db.records.get(A))?.funFact).toBe(FACT.fact));
    resync('2026-11-22T09:01:00.000Z');
    await settle();
    expect(backend.funFactCalls).toHaveLength(1);
  });

  describe('a record held back while its save can be undone', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    });

    it('is not asked about before its time, and is once that has passed', async () => {
      await db.records.put(record());
      await wantFunFact(db, A, { notBefore: Date.now() + 9_000 });
      const backend = new FakeBackend({});
      backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
      mount(backend);
      await act(() => vi.advanceTimersByTimeAsync(8_000));
      expect(backend.funFactCalls).toEqual([]);
      expect(await readFunFactQueue(db)).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      await waitFor(async () => expect((await db.records.get(A))?.funFact).toBe(FACT.fact));
      expect(backend.funFactCalls).toHaveLength(1);
    });

    it('is never asked about once Undo has taken the record off', async () => {
      await db.records.put(record());
      await wantFunFact(db, A, { notBefore: Date.now() + 9_000 });
      const backend = new FakeBackend({});
      backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
      mount(backend);
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      await act(() => db.records.update(A, { deletedAt: new Date().toISOString() }));
      await act(() => vi.advanceTimersByTimeAsync(8_000));
      await waitFor(async () => expect(await readFunFactQueue(db)).toEqual([]));
      expect(backend.funFactCalls).toEqual([]);
    });
  });

  describe('after a failed try', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    });

    async function failOnce() {
      await db.records.put(record());
      await wantFunFact(db, A);
      const backend = new FakeBackend({});
      backend.claudeFails = 'down';
      mount(backend);
      await waitFor(async () => expect(await readFunFactQueue(db)).toEqual([{ recordId: A, tries: 1 }]));
      return backend;
    }

    it('tries once more a minute later, then leaves it for the button', async () => {
      const backend = await failOnce();
      await act(() => vi.advanceTimersByTimeAsync(FUN_FACT_RETRY_MS - 1000));
      expect(backend.funFactCalls).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      await waitFor(async () => expect(await readFunFactQueue(db)).toEqual([]));
      expect(backend.funFactCalls).toHaveLength(2);
      // Left for the button: no third automatic try.
      await act(() => vi.advanceTimersByTimeAsync(FUN_FACT_RETRY_MS * 2));
      expect(backend.funFactCalls).toHaveLength(2);
    });

    it('the retry a minute later saves the fact once Claude answers', async () => {
      const backend = await failOnce();
      backend.claudeFails = null;
      backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
      await act(() => vi.advanceTimersByTimeAsync(FUN_FACT_RETRY_MS));
      await waitFor(async () => expect((await db.records.get(A))?.funFact).toBe(FACT.fact));
    });
  });
});

describe('useFunFactStatus', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;

  it('is idle, then queued, then none once nothing was found', async () => {
    const { result } = renderHook(() => useFunFactStatus(A), { wrapper });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe('idle'));
    await act(() => wantFunFact(db, A));
    await waitFor(() => expect(result.current).toBe('queued'));
    await act(async () => {
      await db.meta.put({ key: 'funFactQueue', value: '[]' });
      await db.meta.put({ key: `funFactNone:${A}`, value: 'true' });
    });
    await waitFor(() => expect(result.current).toBe('none'));
  });

  it('is failed once both tries couldn’t reach Claude', async () => {
    const { result } = renderHook(() => useFunFactStatus(A), { wrapper });
    await waitFor(() => expect(result.current).toBe('idle'));
    await act(() => db.meta.put({ key: `funFactFailed:${A}`, value: 'true' }));
    await waitFor(() => expect(result.current).toBe('failed'));
    await act(() => wantFunFact(db, A));
    await waitFor(() => expect(result.current).toBe('queued'));
  });
});
