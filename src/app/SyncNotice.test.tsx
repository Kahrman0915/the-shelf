import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/data/db';
import { savePostcards } from '@/data/outbox';
import type { ShelfRecord } from '@/data/schema';
import { SyncContext, SyncNotice } from './SyncContext';

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

const create = { kind: 'record.create' as const, shelfId: SHELF, recordId: A, userId: ME, createdAt: WHEN, fields: record(A) };

function value(over: Partial<React.ContextType<typeof SyncContext>> = {}) {
  return { lastSyncedAt: null, problem: null, runNow: vi.fn(), retry: vi.fn(async () => {}), discard: vi.fn(async () => {}), ...over };
}

function show(v: ReturnType<typeof value>) {
  render(
    <SyncContext.Provider value={v}>
      <SyncNotice />
    </SyncContext.Provider>,
  );
}

beforeEach(async () => {
  await db.outbox.clear();
  await db.records.clear();
});
afterEach(async () => {
  await db.outbox.clear();
  await db.records.clear();
});

describe('SyncNotice', () => {
  it('says how many changes are waiting to send', async () => {
    await savePostcards(db, [create]);
    show(value());
    expect(await screen.findByText('Saved on this phone · 1 waiting to send')).toBeInTheDocument();
  });

  it('shows the oldest rejection with Try again and Discard', async () => {
    await savePostcards(db, [create]);
    const [card] = await db.outbox.toArray();
    await db.outbox.update(card.seq, { state: 'rejected', reason: 'That record is no longer on your shelf.' });
    const v = value();
    show(v);
    expect(await screen.findByText('1 change couldn’t be saved: That record is no longer on your shelf.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(v.retry).toHaveBeenCalledWith(card.seq);
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(v.discard).toHaveBeenCalledWith(card.seq);
  });

  it('says so when the shelf cannot be reached and nothing is waiting', () => {
    show(value({ problem: { kind: 'no-signal' } }));
    expect(screen.getByText('Couldn’t reach the shelf. Showing what’s on this phone.')).toBeInTheDocument();
  });
});
