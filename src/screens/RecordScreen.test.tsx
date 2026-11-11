import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { db } from '@/data/db';
import type { ShelfRecord } from '@/data/schema';
import { RecordScreen } from './RecordScreen';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';
const MEGAN = '22222222-2222-4222-8222-222222222222';
const ID = '00000000-0000-4000-8000-000000000009';

function record(p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: ID, shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null,
    artist: 'John Coltrane', title: 'Ascension', label: 'Impulse!', catalog: null, year: 1966, format: null,
    genre: 'jazz', discGrade: 'Sealed', sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null,
    valueNote: null, notes: null, discogsReleaseId: null, coverPath: null, boughtAt: null, addedBy: ME,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...p,
  };
}

function renderRecord(id = ID) {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  return render(
    <CurrentShelfProvider value={shelf}>
      <MemoryRouter initialEntries={[`/record/${id}`]}>
        <Routes>
          <Route path="/record/:id" element={<RecordScreen />} />
        </Routes>
      </MemoryRouter>
    </CurrentShelfProvider>,
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.members.bulkPut([
    { shelfId: SHELF, userId: ME, role: 'owner', displayName: 'Kahrman' },
    { shelfId: SHELF, userId: MEGAN, role: 'member', displayName: 'Megan' },
  ]);
});

describe('RecordScreen', () => {
  it('shows the poster, artist, title and the meta line', async () => {
    await db.records.put(record());
    renderRecord();
    expect(await screen.findByRole('img', { name: 'Poster for John Coltrane, Ascension' })).toBeInTheDocument();
    expect(screen.getByText('John Coltrane')).toBeInTheDocument();
    expect(screen.getByText('Ascension', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('1966 · Impulse!')).toBeInTheDocument();
  });

  it('shows the grades, with not graded for a missing one', async () => {
    await db.records.put(record());
    renderRecord();
    expect(await screen.findByText('Sealed')).toBeInTheDocument();
    expect(screen.getByText('not graded')).toBeInTheDocument();
    expect(screen.getByText('Disc')).toBeInTheDocument();
    expect(screen.getByText('Sleeve')).toBeInTheDocument();
  });

  it('shows my rating and the other members’ ratings', async () => {
    await db.records.put(record());
    await db.ratings.put({ recordId: ID, userId: ME, value: 4, updatedAt: 'x' });
    renderRecord();
    expect(await screen.findByText('Megan · Unplayed')).toBeInTheDocument();
    expect(screen.getByText('Your rating')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4 of 5, Love it' })).toBeInTheDocument();
    expect(screen.queryByText('Kahrman · Unplayed')).not.toBeInTheDocument();
  });

  it('shows Paid only when the price is known', async () => {
    await db.records.put(record({ pricePaid: 15 }));
    const first = renderRecord();
    expect(await screen.findByText('Paid $15')).toBeInTheDocument();
    first.unmount();
    await db.records.put(record({ pricePaid: null }));
    renderRecord();
    await screen.findByRole('heading', { name: 'John Coltrane' });
    expect(screen.queryByText(/Paid/)).not.toBeInTheDocument();
  });

  it('says so for a record on another shelf or one that was deleted', async () => {
    await db.records.put(record({ shelfId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
    const first = renderRecord();
    expect(await screen.findByText('That record isn’t on this phone.')).toBeInTheDocument();
    first.unmount();
    await db.records.put(record({ deletedAt: '2026-02-01T00:00:00.000Z' }));
    renderRecord();
    expect(await screen.findByText('That record isn’t on this phone.')).toBeInTheDocument();
  });
});
