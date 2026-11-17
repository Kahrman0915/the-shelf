import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { UndoBar, UndoProvider } from '@/app/UndoContext';
import type { FoundRecord } from '@/data/backend';
import { db } from '@/data/db';
import type { ShelfRecord } from '@/data/schema';
import { FakeBackend } from '@/test/fakeBackend';
import { FindRecord } from './FindRecord';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';

const FORCES: FoundRecord = {
  releaseId: 28843512,
  artist: 'McCoy Tyner',
  title: 'Forces Of Nature (Live At Slugs’)',
  label: 'Blue Note',
  catalog: 'B0039362-01',
  year: 2024,
  format: 'Vinyl, LP, Album',
  country: 'US',
  genres: ['Jazz'],
  styles: ['Post Bop'],
  thumb: 'https://i.discogs.com/forces-thumb.jpg',
};

const SPARSE: FoundRecord = {
  releaseId: 111,
  artist: 'McCoy Tyner',
  title: 'Sahara',
  label: null,
  catalog: null,
  year: null,
  format: 'Vinyl',
  country: null,
  genres: ['Jazz'],
  styles: [],
  thumb: null,
};

function onShelf(p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: '00000000-0000-4000-8000-000000000009', shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null,
    artist: 'McCoy Tyner', title: 'Sahara', label: null, catalog: null, year: null, format: null, genre: 'jazz',
    discGrade: 'NM', sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null,
    discogsReleaseId: null, coverPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: ME,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...p,
  };
}

function setup({ records = [] as ShelfRecord[], onAdded = () => {} } = {}) {
  const backend = new FakeBackend({});
  backend.discogsResults = [FORCES, SPARSE];
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  render(
    <BackendProvider backend={backend}>
      <CurrentShelfProvider value={shelf}>
        <UndoProvider>
          <FindRecord records={records} onAdded={onAdded} />
          <UndoBar />
        </UndoProvider>
      </CurrentShelfProvider>
    </BackendProvider>,
  );
  return backend;
}

const searchBox = () => screen.getByRole('searchbox', { name: 'Find a record' });
const searchButton = () => screen.getByRole('button', { name: /^Search/ });
const card = (name: RegExp) => screen.findByRole('button', { name });

async function search(text: string) {
  await userEvent.clear(searchBox());
  await userEvent.type(searchBox(), text);
  await userEvent.click(searchButton());
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Put back jsdom's own navigator.onLine.
  delete (navigator as unknown as Record<string, unknown>).onLine;
});

describe('FindRecord', () => {
  it('the box is a 16px search box with the placeholder', () => {
    setup();
    expect(searchBox()).toHaveAttribute('type', 'search');
    expect(searchBox()).toHaveAttribute('enterkeyhint', 'search');
    expect(searchBox()).toHaveAttribute('placeholder', 'Artist and title, like mccoy tyner forces of nature');
    expect(searchBox().className).toContain('text-base');
  });

  it('Search is disabled for one character', async () => {
    const backend = setup();
    expect(searchButton()).toBeDisabled();
    await userEvent.type(searchBox(), 'a');
    expect(searchButton()).toBeDisabled();
    await userEvent.clear(searchBox());
    await userEvent.type(searchBox(), '   ');
    expect(searchButton()).toBeDisabled();
    await userEvent.type(searchBox(), '{Enter}');
    await userEvent.type(searchBox(), 'b');
    expect(searchButton()).toBeDisabled();
    expect(backend.discogsCalls).toEqual([]);
    await userEvent.type(searchBox(), 'c');
    expect(searchButton()).toBeEnabled();
  });

  it('pressing Enter in the box searches', async () => {
    const backend = setup();
    await userEvent.type(searchBox(), 'mccoy tyner{Enter}');
    expect(await card(/Forces Of Nature/)).toBeInTheDocument();
    expect(backend.discogsCalls).toEqual(['mccoy tyner']);
  });

  it('shows the cards with year · label · catalog', async () => {
    setup();
    await search('mccoy tyner forces of nature');
    const forces = await card(/Forces Of Nature/);
    expect(within(forces).getByText('McCoy Tyner — Forces Of Nature (Live At Slugs’)')).toHaveClass('font-bold');
    expect(within(forces).getByText('2024 · Blue Note · B0039362-01')).toBeInTheDocument();
    expect(within(forces).getByText('Vinyl, LP, Album · US')).toBeInTheDocument();
    const thumb = forces.querySelector('img');
    expect(thumb).toHaveAttribute('src', 'https://i.discogs.com/forces-thumb.jpg');
    expect(thumb).toHaveAttribute('alt', '');

    const sahara = await card(/Sahara/);
    expect(within(sahara).getByText('Vinyl')).toBeInTheDocument();
    expect(sahara.querySelector('img')).toBeNull();
    expect(within(sahara).queryByText(/·/)).toBeNull();

    const credit = screen.getByRole('link', { name: 'Data provided by Discogs' });
    expect(credit).toHaveAttribute('href', 'https://www.discogs.com/search/?q=mccoy%20tyner%20forces%20of%20nature&type=release');
    expect(credit).toHaveAttribute('target', '_blank');
    expect(credit).toHaveAttribute('rel', 'noopener');
  });

  it('shows at most 6 cards', async () => {
    const backend = setup();
    backend.discogsResults = Array.from({ length: 8 }, (_, i) => ({ ...SPARSE, releaseId: i + 1, title: `Album ${i + 1}` }));
    await search('mccoy tyner');
    await card(/Album 1/);
    expect(screen.getAllByRole('button', { name: /Album/ })).toHaveLength(6);
  });

  it('the button reads Searching Discogs… while busy', async () => {
    const backend = setup();
    let release: (r: FoundRecord[]) => void = () => {};
    vi.spyOn(backend, 'searchDiscogs').mockImplementation(() => new Promise((r) => { release = r; }));
    await search('mccoy tyner');
    expect(screen.getByRole('button', { name: 'Searching Discogs…' })).toBeDisabled();
    await act(async () => release([FORCES]));
    expect(await card(/Forces Of Nature/)).toBeInTheDocument();
    expect(searchButton()).toHaveTextContent(/^Search$/);
  });

  it('tapping a card saves an owned record and offers Undo', async () => {
    const onAdded = vi.fn();
    setup({ onAdded });
    await search('mccoy tyner forces of nature');
    await userEvent.click(await card(/Forces Of Nature/));
    expect(await screen.findByText('On the shelf: Forces Of Nature (Live At Slugs’)')).toBeInTheDocument();
    const records = await db.records.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      artist: 'McCoy Tyner',
      title: 'Forces Of Nature (Live At Slugs’)',
      status: 'owned',
      genre: 'jazz',
      discGrade: null,
      discogsReleaseId: 28843512,
    });
    expect((await db.outbox.toArray()).map((p) => p.kind)).toEqual(['record.create']);
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it('the box clears and has focus after saving', async () => {
    setup();
    await search('mccoy tyner forces of nature');
    await userEvent.click(await card(/Forces Of Nature/));
    await waitFor(() => expect(searchBox()).toHaveValue(''));
    expect(searchBox()).toHaveFocus();
    expect(screen.queryByRole('button', { name: /Forces Of Nature/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Data provided by Discogs' })).not.toBeInTheDocument();
  });

  it('a double tap saves one record', async () => {
    setup();
    await search('mccoy tyner forces of nature');
    await userEvent.dblClick(await card(/Forces Of Nature/));
    await screen.findByText('On the shelf: Forces Of Nature (Live At Slugs’)');
    expect(await db.records.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('Undo removes it', async () => {
    setup();
    await search('mccoy tyner forces of nature');
    await userEvent.click(await card(/Forces Of Nature/));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await db.records.toArray())[0].deletedAt).not.toBeNull());
    expect((await db.outbox.toArray()).map((p) => p.kind)).toEqual(['record.create', 'record.patch']);
    await waitFor(() => expect(screen.queryByText(/On the shelf:/)).not.toBeInTheDocument());
  });

  it('marks a record already on the shelf', async () => {
    setup({ records: [onShelf()] });
    await search('mccoy tyner');
    expect(within(await card(/Sahara/)).getByText('Already on the shelf')).toBeInTheDocument();
    expect(within(await card(/Forces Of Nature/)).queryByText('Already on the shelf')).not.toBeInTheDocument();
  });

  it('a deleted record isn’t marked as on the shelf', async () => {
    setup({ records: [onShelf({ deletedAt: '2026-02-01T00:00:00.000Z' })] });
    await search('mccoy tyner');
    expect(within(await card(/Sahara/)).queryByText('Already on the shelf')).not.toBeInTheDocument();
  });

  it('an older search can’t overwrite a newer one', async () => {
    const backend = setup();
    const pending: ((r: FoundRecord[]) => void)[] = [];
    vi.spyOn(backend, 'searchDiscogs').mockImplementation(() => new Promise((r) => { pending.push(r); }));
    await search('forces of nature');
    await search('sahara');
    expect(pending).toHaveLength(2);
    await act(async () => pending[1]([SPARSE]));
    expect(await card(/Sahara/)).toBeInTheDocument();
    await act(async () => pending[0]([FORCES]));
    expect(screen.queryByRole('button', { name: /Forces Of Nature/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sahara/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Data provided by Discogs' })).toHaveAttribute(
      'href',
      'https://www.discogs.com/search/?q=sahara&type=release',
    );
    expect(searchButton()).toHaveTextContent(/^Search$/);
  });

  it('an older search’s failure can’t replace newer results', async () => {
    const backend = setup();
    const pending: { resolve: (r: FoundRecord[]) => void; reject: (e: Error) => void }[] = [];
    vi.spyOn(backend, 'searchDiscogs').mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }); }));
    await search('forces of nature');
    await search('sahara');
    await act(async () => pending[1].resolve([SPARSE]));
    await act(async () => pending[0].reject(new Error('Discogs isn’t responding. Try again, or fill it in by hand.')));
    expect(screen.getByRole('button', { name: /Sahara/ })).toBeInTheDocument();
    expect(screen.queryByText(/isn’t responding/)).not.toBeInTheDocument();
  });

  it('no results', async () => {
    const backend = setup();
    backend.discogsResults = [];
    await search('zzzz qqqq');
    expect(await screen.findByText('Discogs didn’t find that. Try fewer words, or fill it in by hand.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Data provided by Discogs' })).not.toBeInTheDocument();
  });

  it('rate-limited', async () => {
    const backend = setup();
    backend.discogsFails = 'rate-limited';
    await search('mccoy tyner');
    expect(await screen.findByText('Too many searches at once. Wait a minute and try again.')).toBeInTheDocument();
  });

  it('down', async () => {
    const backend = setup();
    backend.discogsFails = 'down';
    await search('mccoy tyner');
    expect(await screen.findByText('Discogs isn’t responding. Try again, or fill it in by hand.')).toBeInTheDocument();
  });

  it('a lost signal during the search says Needs signal', async () => {
    const backend = setup();
    backend.online = false;
    await search('mccoy tyner');
    expect(await screen.findByText('Needs signal')).toBeInTheDocument();
  });

  it('a new search clears the last message', async () => {
    const backend = setup();
    backend.discogsFails = 'down';
    await search('mccoy tyner');
    await screen.findByText(/isn’t responding/);
    backend.discogsFails = null;
    await search('mccoy tyner');
    await card(/Forces Of Nature/);
    expect(screen.queryByText(/isn’t responding/)).not.toBeInTheDocument();
  });

  it('offline shows Needs signal and disables the box, until the signal comes back', async () => {
    setOnline(false);
    setup();
    expect(screen.getByText('Needs signal')).toBeInTheDocument();
    expect(searchBox()).toBeDisabled();
    expect(searchButton()).toBeDisabled();
    act(() => setOnline(true));
    expect(searchBox()).toBeEnabled();
    expect(screen.queryByText('Needs signal')).not.toBeInTheDocument();
    act(() => setOnline(false));
    expect(searchBox()).toBeDisabled();
    expect(screen.getByText('Needs signal')).toBeInTheDocument();
  });

  it('nothing from the search is written to localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setup();
    await search('mccoy tyner forces of nature');
    await userEvent.click(await card(/Forces Of Nature/));
    await screen.findByText(/On the shelf:/);
    expect(setItem).not.toHaveBeenCalled();
  });
});
