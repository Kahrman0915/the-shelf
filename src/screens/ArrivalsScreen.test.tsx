import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { db } from '@/data/db';
import type { ShelfRecord } from '@/data/schema';
import { ArrivalsScreen } from './ArrivalsScreen';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';

function record(n: number, p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`, shelfId: SHELF, status: 'new_arrival', wantsUpgrade: false, upgradeNote: null,
    artist: `Artist ${n}`, title: `Title ${n}`, label: null, catalog: null, year: null, format: null,
    genre: 'jazz', discGrade: null, sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null,
    valueNote: null, notes: null, discogsReleaseId: null, coverPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: ME,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...p,
  };
}

function renderArrivals() {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  return render(
    <CurrentShelfProvider value={shelf}>
      <MemoryRouter initialEntries={['/arrivals']}>
        <Routes>
          <Route path="/arrivals" element={<ArrivalsScreen />} />
          <Route path="/record/:id" element={<p>Record page</p>} />
          <Route path="/" element={<p>Shelf page</p>} />
        </Routes>
      </MemoryRouter>
    </CurrentShelfProvider>,
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('ArrivalsScreen', () => {
  it('lists new arrivals, newest first, and leaves out shelved records', async () => {
    await db.records.bulkPut([
      record(1, { boughtAt: '2026-01-01T00:00:00.000Z' }),
      record(2, { boughtAt: '2026-03-01T00:00:00.000Z' }),
      record(3, { status: 'owned', boughtAt: '2026-05-01T00:00:00.000Z' }),
    ]);
    renderArrivals();
    expect(await screen.findByRole('heading', { name: 'New arrivals' })).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Artist 2, Title 2' });
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')).filter((n) => n?.startsWith('Artist'));
    expect(names).toEqual(['Artist 2, Title 2', 'Artist 1, Title 1']);
  });

  it('says so when nothing is waiting', async () => {
    renderArrivals();
    expect(await screen.findByText('Nothing waiting. Records you buy at a show land here.')).toBeInTheDocument();
  });

  it('opens a row’s Record screen, and has a way back', async () => {
    await db.records.put(record(1));
    renderArrivals();
    await userEvent.click(await screen.findByRole('button', { name: 'Artist 1, Title 1' }));
    expect(await screen.findByText('Record page')).toBeInTheDocument();
  });

  it('links back to the shelf', async () => {
    renderArrivals();
    await userEvent.click(await screen.findByRole('link', { name: 'Back' }));
    expect(await screen.findByText('Shelf page')).toBeInTheDocument();
  });
});
