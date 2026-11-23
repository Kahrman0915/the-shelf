import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { db, sectionsFromSet } from '@/data/db';
import { applyPostcard } from '@/data/outbox';
import type { ShelfRecord } from '@/data/schema';
import { KAHRMANS_NINE, sectionIdFor } from '@/domain/sections';
import { holdTable } from '@/test/holdTable';
import { ShelfScreen } from './ShelfScreen';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';

function record(id: string, artist: string, genre: 'jazz' | 'reggae' | 'rock', p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id, shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null, artist, title: 'T', label: null, catalog: null, year: null, format: null,
    sectionId: sectionIdFor(SHELF, genre), discGrade: null, sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null,
    notes: null, discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: ME,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...p,
  };
}

function renderShelf() {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  return render(
    <CurrentShelfProvider value={shelf}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ShelfScreen />} />
        </Routes>
      </MemoryRouter>
    </CurrentShelfProvider>,
  );
}

const spine = (artist: string) => (screen.getByRole('button', { name: new RegExp(`^${artist}, `) }).querySelector('[aria-hidden]') as HTMLElement).style.background;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.records.bulkPut([
    record('00000000-0000-4000-8000-000000000001', 'Art Blakey', 'jazz'),
    record('00000000-0000-4000-8000-000000000002', 'Bob Marley', 'reggae'),
    record('00000000-0000-4000-8000-000000000003', 'Toots', 'reggae', { status: 'new_arrival', boughtAt: '2026-02-01T00:00:00.000Z' }),
  ]);
});

describe('ShelfScreen', () => {
  it('draws no spines until the sections are in, then each in its section’s colour', async () => {
    await db.sections.bulkPut(sectionsFromSet(SHELF, KAHRMANS_NINE, '2026-01-01T00:00:00.000Z'));
    const release = holdTable(db, db.sections);
    renderShelf();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole('button', { name: /^Art Blakey, / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^New arrivals/ })).toBeNull();
    await release();
    expect(await screen.findByRole('button', { name: /^Art Blakey, / })).toBeInTheDocument();
    expect(spine('Art Blakey')).toBe('var(--section-jazz)');
    expect(spine('Bob Marley')).toBe('var(--section-reggae)');
    expect(screen.getByRole('button', { name: 'New arrivals, 1 waiting' })).toBeInTheDocument();
  });

  it('goes back to All sections when the section it was filtered to is merged away', async () => {
    await db.sections.bulkPut(sectionsFromSet(SHELF, KAHRMANS_NINE, '2026-01-01T00:00:00.000Z'));
    renderShelf();
    await screen.findByRole('button', { name: /^Art Blakey, / });
    await userEvent.click(screen.getByRole('combobox', { name: 'Section' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Reggae' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Art Blakey, / })).toBeNull());

    const reggae = sectionIdFor(SHELF, 'reggae');
    const misc = sectionIdFor(SHELF, 'misc');
    await db.transaction('rw', [db.records, db.ratings, db.sections], () =>
      applyPostcard(db, { kind: 'section.merge', shelfId: SHELF, recordId: reggae, userId: ME, createdAt: '2026-03-01T00:00:00.000Z', fields: { into: misc } }),
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Section' })).toHaveTextContent('All sections'));
    expect(await screen.findByRole('button', { name: /^Art Blakey, / })).toBeInTheDocument();
    expect(spine('Bob Marley')).toBe('var(--section-misc)');
  });

  it('links to the Want list, and wanted records are not on the shelf', async () => {
    await db.records.put(record('00000000-0000-4000-8000-000000000009', 'Wanted Artist', 'jazz', { status: 'wanted' }));
    renderShelf();
    expect(await screen.findByRole('link', { name: 'Want list' })).toHaveAttribute('href', '/want');
    expect(await screen.findByRole('button', { name: /^Art Blakey, / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Wanted Artist, / })).toBeNull();
  });
});
