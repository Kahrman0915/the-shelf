import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/data/db';
import { wantFunFact } from '@/data/funFacts';
import type { ShelfRecord } from '@/data/schema';
import { FakeBackend } from '@/test/fakeBackend';
import { BackendProvider } from './BackendContext';
import { CurrentShelfProvider } from './CurrentShelf';
import { SyncContext } from './SyncContext';
import { useFunFacts, useFunFactStatus } from './useFunFacts';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';
const A = '33333333-3333-4333-8333-333333333333';
const FACT = { fact: 'Recorded in two sessions in 1959.', sourceUrl: 'https://example.com/kind-of-blue' };

function record(over: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: A, shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null,
    artist: 'Miles Davis', title: 'Kind of Blue', label: null, catalog: null, year: null, format: null, genre: 'jazz',
    discGrade: null, sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null,
    discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null,
    addedBy: ME, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...over,
  };
}

function Runner() {
  useFunFacts();
  return null;
}

function mount(backend: FakeBackend, runNow = vi.fn()) {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  const sync = { lastSyncedAt: null, problem: null, runNow, retry: async () => {}, discard: async () => {} };
  render(
    <BackendProvider backend={backend}>
      <CurrentShelfProvider value={shelf}>
        <SyncContext.Provider value={sync}>
          <Runner />
        </SyncContext.Provider>
      </CurrentShelfProvider>
    </BackendProvider>,
  );
  return runNow;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  cleanup();
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
});

describe('useFunFactStatus', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;

  it('is idle, then queued, then none once nothing was found', async () => {
    const { result } = renderHook(() => useFunFactStatus(A), { wrapper });
    expect(result.current).toBe('idle');
    await act(() => wantFunFact(db, A));
    await waitFor(() => expect(result.current).toBe('queued'));
    await act(async () => {
      await db.meta.put({ key: 'funFactQueue', value: '[]' });
      await db.meta.put({ key: `funFactNone:${A}`, value: 'true' });
    });
    await waitFor(() => expect(result.current).toBe('none'));
  });
});
