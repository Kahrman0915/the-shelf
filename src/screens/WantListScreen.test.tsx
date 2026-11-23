import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { SyncContext } from '@/app/SyncContext';
import { UndoBar, UndoProvider } from '@/app/UndoContext';
import { NOT_ENOUGH_RATINGS, SIGN_IN_AGAIN, SUGGEST_DOWN, BackendError } from '@/data/backend';
import { db, sectionsFromSet, writeSession } from '@/data/db';
import { pullShelf } from '@/data/sync';
import { ratingToRow, recordToRow, sectionToRow, suggestionToRow } from '@/data/rowMapping';
import type { Rating, ShelfRecord, Suggestion } from '@/data/schema';
import { KAHRMANS_NINE, sectionIdFor } from '@/domain/sections';
import { FakeBackend } from '@/test/fakeBackend';
import { WantListScreen } from './WantListScreen';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';
const T = '2026-01-01T00:00:00.000Z';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function record(n: number, artist: string, title: string, p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: id(n), shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null, artist, title, label: null, catalog: null, year: null, format: null,
    sectionId: sectionIdFor(SHELF, 'jazz'), discGrade: null, sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null,
    notes: null, discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: ME,
    createdAt: T, updatedAt: T, deletedAt: null, importKey: null, ...p,
  };
}

const rating = (n: number): Rating => ({ recordId: id(n), userId: ME, value: 4, updatedAt: T });

function suggestion(n: number, artist: string, title: string, p: Partial<Suggestion> = {}): Suggestion {
  return {
    id: id(900 + n), shelfId: SHELF, artist, title, reason: `Because of ${artist}`, discogsReleaseId: null, discogsGenres: ['Jazz'], discogsStyles: [],
    status: 'pending', decidedBy: null, decidedAt: null, roundAt: T, createdAt: T, updatedAt: T, ...p,
  };
}

type Seed = { records?: ShelfRecord[]; ratings?: Rating[]; suggestions?: Suggestion[] };

async function setup(seed: Seed = {}, { followSync = false }: { followSync?: boolean } = {}) {
  const sections = sectionsFromSet(SHELF, KAHRMANS_NINE, T);
  const backend = new FakeBackend({
    users: { 'k@example.com': ME },
    shelfFor: { [ME]: SHELF },
    signedIn: { userId: ME, email: 'k@example.com' },
    records: (seed.records ?? []).map(recordToRow),
    ratings: (seed.ratings ?? []).map(ratingToRow),
    sections: sections.map(sectionToRow),
    suggestions: (seed.suggestions ?? []).map(suggestionToRow),
  });
  await writeSession(db, { userId: ME, email: 'k@example.com', shelfId: SHELF });
  await pullShelf(db, backend, SHELF);
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  const sync = {
    lastSyncedAt: null,
    problem: null,
    runNow: () => {
      if (followSync) void pullShelf(db, backend, SHELF);
    },
    retry: async () => {},
    discard: async () => {},
  };
  render(
    <BackendProvider backend={backend}>
      <CurrentShelfProvider value={shelf}>
        <SyncContext.Provider value={sync}>
          <UndoProvider>
            <MemoryRouter initialEntries={['/want']}>
              <Routes>
                <Route path="/want" element={<WantListScreen />} />
                <Route path="/record/:id" element={<p>Record screen</p>} />
              </Routes>
            </MemoryRouter>
            <UndoBar />
          </UndoProvider>
        </SyncContext.Provider>
      </CurrentShelfProvider>
    </BackendProvider>,
  );
  return backend;
}

const FIVE_RATED = [1, 2, 3, 4, 5];
const fiveRated = (): Seed => ({
  records: FIVE_RATED.map((n) => record(n, `Artist ${n}`, `Title ${n}`)),
  ratings: FIVE_RATED.map(rating),
});

const setOnline = (value: boolean) => Object.defineProperty(navigator, 'onLine', { value, configurable: true });

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => setOnline(true));

describe('WantListScreen', () => {
  it('shows the three groups in order, with counts', async () => {
    await setup({
      records: [record(1, 'Bill Evans', 'Waltz for Debby', { status: 'wanted' }), record(2, 'Coltrane', 'Ascension', { wantsUpgrade: true })],
      suggestions: [suggestion(1, 'Ahmad Jamal', 'The Awakening')],
    });
    await screen.findByRole('heading', { name: 'Suggested for you (1)' });
    await screen.findByRole('heading', { name: 'Wanted (1)' });
    await screen.findByRole('heading', { name: 'Upgrades (1)' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Wanted (1)', 'Upgrades (1)', 'Suggested for you (1)']);
  });

  it('lists wanted records by artist then title, and a tap opens the record', async () => {
    await setup({
      records: [
        record(1, 'Zoot Sims', 'Quartet', { status: 'wanted' }),
        record(2, 'Bill Evans', 'Waltz for Debby', { status: 'wanted' }),
        record(3, 'Bill Evans', 'Explorations', { status: 'wanted' }),
        record(4, 'Owned One', 'On the shelf'),
      ],
    });
    await screen.findByText('Zoot Sims');
    const links = screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/record/'));
    expect(links.map((l) => l.textContent)).toEqual(['Bill EvansExplorations', 'Bill EvansWaltz for Debby', 'Zoot SimsQuartet']);
    expect(screen.queryByText('Owned One')).toBeNull();
    expect(links[0]).toHaveClass('min-h-12');
    await userEvent.click(links[0]!);
    expect(await screen.findByText('Record screen')).toBeInTheDocument();
  });

  it('shows an upgrade’s note and links to it', async () => {
    await setup({ records: [record(1, 'John Coltrane', 'Ascension', { wantsUpgrade: true, upgradeNote: 'want an original Impulse!' })] });
    const link = await screen.findByRole('link', { name: /Ascension/ });
    expect(link).toHaveAttribute('href', `/record/${id(1)}`);
    expect(within(link).getByText('want an original Impulse!')).toBeInTheDocument();
  });

  it('shows both empty states', async () => {
    await setup();
    expect(await screen.findByText('Nothing on your want list yet.')).toBeInTheDocument();
    expect(screen.getByText('Tap Suggest more for records you might like.')).toBeInTheDocument();
  });

  it('does not list added or dismissed suggestions, newest round first', async () => {
    await setup({
      suggestions: [
        suggestion(1, 'Old Round', 'A', { roundAt: '2026-01-01T00:00:00.000Z' }),
        suggestion(2, 'New Round', 'B', { roundAt: '2026-02-01T00:00:00.000Z' }),
        suggestion(3, 'Gone Added', 'C', { status: 'added' }),
        suggestion(4, 'Gone Dismissed', 'D', { status: 'dismissed' }),
      ],
    });
    await screen.findByText('New Round');
    expect(screen.queryByText('Gone Added')).toBeNull();
    expect(screen.queryByText('Gone Dismissed')).toBeNull();
    const cards = screen.getAllByRole('listitem').filter((li) => within(li).queryByRole('button', { name: 'Add to want list' }));
    expect(cards.map((c) => within(c).getByText(/^(Old|New) Round$/).textContent)).toEqual(['New Round', 'Old Round']);
  });

  it('Add to want list makes a wanted record, hides the card, and Undo brings it back', async () => {
    await setup({ suggestions: [suggestion(1, 'Ahmad Jamal', 'The Awakening')] });
    await userEvent.click(await screen.findByRole('button', { name: 'Add to want list' }));
    expect(await screen.findByRole('heading', { name: 'Wanted (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to want list' })).toBeNull();
    expect(screen.getByText('On your want list: The Awakening')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('button', { name: 'Add to want list' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Wanted (0)' })).toBeInTheDocument();
  });

  it('Not for me hides the card and offers no Undo', async () => {
    await setup({ suggestions: [suggestion(1, 'Ahmad Jamal', 'The Awakening')] });
    await userEvent.click(await screen.findByRole('button', { name: 'Not for me' }));
    await waitFor(() => expect(screen.queryByText('Ahmad Jamal')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(await screen.findByText('Tap Suggest more for records you might like.')).toBeInTheDocument();
  });

  describe('Suggest more', () => {
    it('is disabled with fewer than 5 rated records, with the 5-ratings line', async () => {
      await setup({ records: [1, 2, 3, 4].map((n) => record(n, `A${n}`, 'T')), ratings: [1, 2, 3, 4].map(rating) });
      expect(await screen.findByText(NOT_ENOUGH_RATINGS)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Suggest more' })).toBeDisabled();
    });

    it('does not count wanted records or repeat ratings of one record', async () => {
      const records = [1, 2, 3, 4].map((n) => record(n, `A${n}`, 'T'));
      records.push(record(5, 'W', 'T', { status: 'wanted' }));
      await setup({ records, ratings: [...[1, 2, 3, 4, 5].map(rating), { ...rating(1), userId: '22222222-2222-4222-8222-222222222222' }] });
      expect(await screen.findByText(NOT_ENOUGH_RATINGS)).toBeInTheDocument();
    });

    it('says Needs signal and is disabled when offline', async () => {
      setOnline(false);
      await setup(fiveRated());
      const button = await screen.findByRole('button', { name: 'Needs signal' });
      expect(button).toBeDisabled();
    });

    it('is disabled with the running label while Claude works', async () => {
      const backend = await setup(fiveRated());
      let release = () => {};
      backend.suggestGate = new Promise<void>((r) => (release = r));
      const button = await screen.findByRole('button', { name: 'Suggest more' });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      const running = await screen.findByRole('button', { name: 'Finding records you’d like…' });
      expect(running).toBeDisabled();
      release();
      expect(await screen.findByRole('button', { name: 'Suggest more' })).toBeEnabled();
    });

    it('shows the new cards on success', async () => {
      const backend = await setup(fiveRated(), { followSync: true });
      backend.suggested = [{ artist: 'Ahmad Jamal', title: 'The Awakening', reason: 'You rated At the Top 4' }];
      const button = await screen.findByRole('button', { name: 'Suggest more' });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      expect(await screen.findByText('The Awakening')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Suggested for you (1)' })).toBeInTheDocument();
    });

    it('shows the new cards and no error when the reply was lost', async () => {
      const backend = await setup(fiveRated());
      backend.suggested = [{ artist: 'Ahmad Jamal', title: 'The Awakening', reason: 'r' }];
      backend.suggestFails = 'lost-reply';
      const button = await screen.findByRole('button', { name: 'Suggest more' });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      expect(await screen.findByText('The Awakening')).toBeInTheDocument();
      expect(screen.queryByText(SUGGEST_DOWN)).toBeNull();
    });

    it('shows the down message when nothing arrived', async () => {
      const backend = await setup(fiveRated());
      backend.suggestFails = 'down';
      const button = await screen.findByRole('button', { name: 'Suggest more' });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      expect(await screen.findByText(SUGGEST_DOWN)).toBeInTheDocument();
    });

    it('shows the server’s not-enough-ratings answer as it is, without pulling', async () => {
      const backend = await setup(fiveRated());
      backend.suggestFails = 'not-enough-ratings';
      backend.suggested = [{ artist: 'Hidden', title: 'Not pulled', reason: 'r' }];
      const button = await screen.findByRole('button', { name: 'Suggest more' });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      expect(await screen.findByText(NOT_ENOUGH_RATINGS)).toBeInTheDocument();
    });

    it('shows the sign-in-again message as it is', async () => {
      const backend = await setup(fiveRated());
      backend.suggestRecords = async () => {
        throw new BackendError(SIGN_IN_AGAIN);
      };
      const button = await screen.findByRole('button', { name: 'Suggest more' });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      expect(await screen.findByText(SIGN_IN_AGAIN)).toBeInTheDocument();
    });

    it('says so when nothing new was added', async () => {
      await setup(fiveRated());
      const button = await screen.findByRole('button', { name: 'Suggest more' });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      expect(await screen.findByText('No new suggestions this time.')).toBeInTheDocument();
    });
  });
});
