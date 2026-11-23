import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { UndoBar, UndoProvider } from '@/app/UndoContext';
import { db, sectionsFromSet } from '@/data/db';
import { readFunFactQueue } from '@/data/funFacts';
import type { ShelfRecord } from '@/data/schema';
import { KAHRMANS_NINE, sectionIdFor } from '@/domain/sections';
import { PriceCheckScreen } from './PriceCheckScreen';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';
const ID = '00000000-0000-4000-8000-000000000009';

function record(p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: ID, shelfId: SHELF, status: 'wanted', wantsUpgrade: false, upgradeNote: null,
    artist: 'John Coltrane', title: 'Ascension', label: null, catalog: null, year: 1966, format: null,
    sectionId: sectionIdFor(SHELF, 'jazz'), discGrade: null, sleeveGrade: null, pricePaid: null, nmEstimateLow: 40, nmEstimateHigh: 60,
    valueNote: null, notes: null, discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: ME,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...p,
  };
}

function renderPrice(search = '') {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  return render(
    <CurrentShelfProvider value={shelf}>
      <UndoProvider>
        <MemoryRouter initialEntries={[`/price/${ID}${search}`]}>
          <Routes>
            <Route path="/price/:id" element={<PriceCheckScreen />} />
          </Routes>
        </MemoryRouter>
        <UndoBar />
      </UndoProvider>
    </CurrentShelfProvider>,
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.sections.bulkPut(sectionsFromSet(SHELF, KAHRMANS_NINE, '2026-01-01T00:00:00.000Z'));
});

describe('PriceCheckScreen', () => {
  it('from=record Back goes back through history: Want list, record, price, Back, Back ends on the Want list', async () => {
    await db.records.put(record());
    const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
    function RecordStub() {
      const navigate = useNavigate();
      return (
        <div>
          <p>record page</p>
          <button onClick={() => navigate(-1)}>record back</button>
          <Link to={`/price/${ID}?from=record`}>Check price</Link>
        </div>
      );
    }
    render(
      <CurrentShelfProvider value={shelf}>
        <UndoProvider>
          <MemoryRouter initialEntries={['/want']}>
            <Routes>
              <Route path="/want" element={<Link to={`/record/${ID}`}>open record</Link>} />
              <Route path="/record/:id" element={<RecordStub />} />
              <Route path="/price/:id" element={<PriceCheckScreen />} />
            </Routes>
          </MemoryRouter>
        </UndoProvider>
      </CurrentShelfProvider>,
    );
    await userEvent.click(await screen.findByRole('link', { name: 'open record' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Check price' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await userEvent.click(await screen.findByRole('button', { name: 'record back' }));
    expect(await screen.findByRole('link', { name: 'open record' })).toBeInTheDocument();
  });

  it('from=record opened directly, Back goes to the record', async () => {
    await db.records.put(record());
    const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
    render(
      <CurrentShelfProvider value={shelf}>
        <UndoProvider>
          <MemoryRouter initialEntries={[`/price/${ID}?from=record`]}>
            <Routes>
              <Route path="/record/:id" element={<p>record page</p>} />
              <Route path="/price/:id" element={<PriceCheckScreen />} />
            </Routes>
          </MemoryRouter>
        </UndoProvider>
      </CurrentShelfProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByText('record page')).toBeInTheDocument();
  });

  it('otherwise Back to search keeps the search', async () => {
    await db.records.put(record());
    renderPrice('?q=trane');
    expect(await screen.findByRole('link', { name: 'Back to search' })).toHaveAttribute('href', '/show?q=trane');
  });

  it('Bought it on a want moves it to New arrivals and queues a fun fact held past the undo window', async () => {
    await db.records.put(record());
    renderPrice();
    const before = Date.now();
    await userEvent.click(await screen.findByRole('button', { name: 'Bought it' }));
    await waitFor(async () => expect((await db.records.get(ID))?.status).toBe('new_arrival'));
    await waitFor(async () => expect(await readFunFactQueue(db)).toHaveLength(1));
    const [queued] = await readFunFactQueue(db);
    expect(queued.recordId).toBe(ID);
    expect(queued.notBefore).toBeGreaterThanOrEqual(before + 9000);
  });

  it('Bought it on an upgrade logs it and queues no fun fact', async () => {
    await db.records.put(record({ status: 'owned', wantsUpgrade: true, upgradeNote: 'Mono', discGrade: 'VG' }));
    renderPrice();
    await userEvent.click(await screen.findByRole('button', { name: 'Bought it' }));
    await waitFor(async () => expect((await db.records.get(ID))?.wantsUpgrade).toBe(false));
    expect((await db.records.get(ID))?.status).toBe('owned');
    expect(await readFunFactQueue(db)).toEqual([]);
  });
});
