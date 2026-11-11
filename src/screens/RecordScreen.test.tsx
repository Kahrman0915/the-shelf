import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
          <Route path="/arrivals" element={<p>Arrivals page</p>} />
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
    expect(screen.getByRole('radio', { name: '4 of 5, Love it' })).toHaveAttribute('aria-checked', 'true');
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

  it('rating a new arrival puts it on the shelf', async () => {
    await db.records.put(record({ status: 'new_arrival', genre: 'jazz' }));
    renderRecord();
    await userEvent.click(await screen.findByRole('radio', { name: '4 of 5, Love it' }));
    expect(await screen.findByText('Love it · On the shelf · Jazz / big band')).toBeInTheDocument();
    expect((await db.records.get(ID))?.status).toBe('owned');
    const sent = await db.outbox.toArray();
    expect(sent.filter((p) => p.kind === 'rating.set')).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('changing a rating on a shelved record just confirms the word', async () => {
    await db.records.put(record({ status: 'owned' }));
    renderRecord();
    await userEvent.click(await screen.findByRole('radio', { name: '3 of 5, Good' }));
    expect(await screen.findByText('Good')).toBeInTheDocument();
    expect(screen.queryByText(/On the shelf/)).not.toBeInTheDocument();
  });

  it('a want has no rating control', async () => {
    await db.records.put(record({ status: 'wanted' }));
    renderRecord();
    await screen.findByRole('heading', { name: 'John Coltrane' });
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByText('Your rating')).not.toBeInTheDocument();
  });

  it('Didn’t buy it asks first', async () => {
    await db.records.put(record({ status: 'new_arrival', title: 'Moanin’' }));
    renderRecord();
    await userEvent.click(await screen.findByRole('button', { name: 'Didn’t buy it' }));
    expect(await screen.findByText('Remove Moanin’ from New arrivals?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect((await db.records.get(ID))?.deletedAt).toBeNull();
    expect(await db.outbox.count()).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: 'Didn’t buy it' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove it' }));
    expect(await screen.findByText('Arrivals page')).toBeInTheDocument();
    expect((await db.records.get(ID))?.deletedAt).not.toBeNull();
  });

  it('Didn’t buy it is not offered on shelved records', async () => {
    await db.records.put(record({ status: 'owned' }));
    renderRecord();
    await screen.findByRole('heading', { name: 'John Coltrane' });
    expect(screen.queryByRole('button', { name: 'Didn’t buy it' })).not.toBeInTheDocument();
  });
});
