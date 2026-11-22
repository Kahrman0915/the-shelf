import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { UNDO_WINDOW_MS, UndoBar, UndoProvider } from '@/app/UndoContext';
import * as actions from '@/data/actions';
import type { FoundRecord, Identified } from '@/data/backend';
import { db, sectionsFromSet } from '@/data/db';
import type { Drafts } from '@/data/photos';
import type { ShelfRecord } from '@/data/schema';
import { KAHRMANS_NINE, STARTER_SET, sectionIdFor } from '@/domain/sections';
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
    artist: 'McCoy Tyner', title: 'Sahara', label: null, catalog: null, year: null, format: null, sectionId: sectionIdFor(SHELF, 'jazz'),
    discGrade: 'NM', sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null,
    discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: ME,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...p,
  };
}

type PhotosProp = { drafts: Drafts; ready: boolean; onUsed: () => void; onBack: (drafts: Drafts | null) => void };

/** Show FindRecord again with other photos waiting, as the Add screen does when the drafts change. */
let rerenderPhotos: (photos: PhotosProp | undefined) => void = () => {};

function setup({ records = [] as ShelfRecord[], onAdded = () => {}, photos = undefined as PhotosProp | undefined, prepare = (_b: FakeBackend) => {} } = {}) {
  const backend = new FakeBackend({});
  backend.discogsResults = [FORCES, SPARSE];
  prepare(backend);
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  const tree = (p: PhotosProp | undefined) => (
    <BackendProvider backend={backend}>
      <CurrentShelfProvider value={shelf}>
        <UndoProvider>
          <FindRecord records={records} onAdded={onAdded} photos={p} />
          <UndoBar />
        </UndoProvider>
      </CurrentShelfProvider>
    </BackendProvider>
  );
  const { rerender } = render(tree(photos));
  rerenderPhotos = (p) => rerender(tree(p));
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
  await db.sections.bulkPut(sectionsFromSet(SHELF, KAHRMANS_NINE, '2026-01-01T00:00:00.000Z'));
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
    expect(searchBox()).toHaveAttribute('maxlength', '200');
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
      sectionId: sectionIdFor(SHELF, 'jazz'),
      discGrade: null,
      discogsReleaseId: 28843512,
    });
    expect((await db.outbox.toArray()).map((p) => p.kind)).toEqual(['record.create']);
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it('tapping a card queues the new record for a fun fact', async () => {
    setup();
    await search('mccoy tyner forces of nature');
    await userEvent.click(await card(/Forces Of Nature/));
    await screen.findByText(/On the shelf:/);
    const [record] = await db.records.toArray();
    await waitFor(async () =>
      expect(JSON.parse((await db.meta.get('funFactQueue'))?.value ?? '[]')).toEqual([{ recordId: record.id, tries: 0, notBefore: expect.any(Number) }]),
    );
  });

  it('the fun fact waits until the Undo has gone, so an Undo costs no call', async () => {
    setup();
    await search('mccoy tyner forces of nature');
    const before = Date.now();
    await userEvent.click(await card(/Forces Of Nature/));
    await screen.findByText(/On the shelf:/);
    const after = Date.now();
    const queued = async () => JSON.parse((await db.meta.get('funFactQueue'))?.value ?? '[]') as { notBefore?: number }[];
    await waitFor(async () => expect(await queued()).toHaveLength(1));
    const [{ notBefore }] = await queued();
    expect(notBefore).toBeGreaterThanOrEqual(before + UNDO_WINDOW_MS + 1_000);
    expect(notBefore).toBeLessThanOrEqual(after + UNDO_WINDOW_MS + 1_000);
    // Undo inside the window: the record is gone by the time it's due, so the runner drops it unasked.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await db.records.toArray())[0].deletedAt).not.toBeNull());
    expect(Date.now()).toBeLessThan(notBefore!);
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

  /** Holds every notebook write until the returned function is called, so a save stays running. */
  function slowSaves() {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => { open = r; });
    const transaction = db.transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => gate.then(() => transaction(...args))) as never);
    return () => act(async () => open());
  }

  it('focus moves to the box the moment a card is tapped, before the save finishes', async () => {
    setup();
    await search('mccoy tyner forces of nature');
    const finishSave = slowSaves();
    await userEvent.click(await card(/Forces Of Nature/));
    expect(searchBox()).toHaveFocus();
    expect(await db.records.count()).toBe(0);
    await finishSave();
    await waitFor(() => expect(searchBox()).toHaveValue(''));
    expect(searchBox()).toHaveFocus();
  });

  it('a search started while a save runs keeps its words and results', async () => {
    setup();
    await search('mccoy tyner forces of nature');
    const finishSave = slowSaves();
    await userEvent.click(await card(/Forces Of Nature/));
    await search('sahara');
    expect(await card(/Sahara/)).toBeInTheDocument();
    await finishSave();
    await screen.findByText('On the shelf: Forces Of Nature (Live At Slugs’)');
    expect(searchBox()).toHaveValue('sahara');
    expect(screen.getByRole('button', { name: /Sahara/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Data provided by Discogs' })).toHaveAttribute(
      'href',
      'https://www.discogs.com/search/?q=sahara&type=release',
    );
  });

  it('a search landing mid-save doesn’t let a second tap start another save', async () => {
    setup();
    await search('mccoy tyner forces of nature');
    const finishSave = slowSaves();
    await userEvent.click(await card(/Forces Of Nature/));
    await search('sahara');
    await userEvent.click(await card(/Sahara/));
    await finishSave();
    await screen.findByText('On the shelf: Forces Of Nature (Live At Slugs’)');
    expect(await db.records.count()).toBe(1);
    // One save's transaction; queueing its fun fact is a transaction over meta alone.
    expect(vi.mocked(db.transaction).mock.calls.filter((args) => (args as unknown[])[1] !== db.meta)).toHaveLength(1);
    // Once the first save is done, the newer cards can be saved.
    await userEvent.click(screen.getByRole('button', { name: /Sahara/ }));
    await screen.findByText('On the shelf: Sahara');
    expect(await db.records.count()).toBe(2);
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

  describe('the confirmation under the box', () => {
    const FORCES_TEXT = 'On the shelf: Forces Of Nature (Live At Slugs’)';
    const undoButton = () => screen.getByRole('button', { name: 'Undo' });

    async function saveForces() {
      await search('mccoy tyner forces of nature');
      await userEvent.click(await card(/Forces Of Nature/));
      return screen.findByText(FORCES_TEXT);
    }

    it('after saving, the confirmation shows under the box with Undo', async () => {
      setup();
      const text = await saveForces();
      // Shown once, inline in the form's section: not also in the app-wide bottom bar.
      expect(screen.getAllByText(/On the shelf:/)).toHaveLength(1);
      const section = searchBox().closest('section') as HTMLElement;
      expect(section).toContainElement(text);
      expect(section).toContainElement(undoButton());
      expect(searchBox().closest('form')).not.toContainElement(text);
      // A single row, in a live region that was already mounted.
      expect(text.closest('[role="status"]')).toContainElement(undoButton());
      expect(undoButton().className).toContain('h-12');
      expect(undoButton().closest('.fixed')).toBeNull();
    });

    it('the confirmation goes after 8 seconds', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      try {
        setup();
        await saveForces();
        act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS - 100));
        expect(screen.getByText(FORCES_TEXT)).toBeInTheDocument();
        act(() => void vi.advanceTimersByTime(1000));
        expect(screen.queryByText(/On the shelf:/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a second save replaces the confirmation with a fresh 8 seconds', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      try {
        setup();
        await saveForces();
        act(() => void vi.advanceTimersByTime(5000));
        await search('sahara');
        await userEvent.click(await card(/Sahara/));
        await screen.findByText('On the shelf: Sahara');
        expect(screen.queryByText(FORCES_TEXT)).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
        act(() => void vi.advanceTimersByTime(5000));
        expect(screen.getByText('On the shelf: Sahara')).toBeInTheDocument();
        act(() => void vi.advanceTimersByTime(4000));
        expect(screen.queryByText(/On the shelf:/)).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('starting a new search leaves the confirmation up', async () => {
      setup();
      await saveForces();
      await search('sahara');
      await card(/Sahara/);
      expect(screen.getByText(FORCES_TEXT)).toBeInTheDocument();
    });

    it('Undo takes the record off the shelf and returns focus to the box', async () => {
      setup();
      await saveForces();
      await userEvent.click(undoButton());
      await waitFor(async () => expect((await db.records.toArray())[0].deletedAt).not.toBeNull());
      expect((await db.outbox.toArray()).map((p) => p.kind)).toEqual(['record.create', 'record.patch']);
      await waitFor(() => expect(screen.queryByText(/On the shelf:/)).not.toBeInTheDocument());
      expect(searchBox()).toHaveFocus();
    });

    it('Undo runs once on a double tap', async () => {
      setup();
      await saveForces();
      let finish: () => void = () => {};
      const perform = vi.spyOn(actions, 'perform').mockImplementation(() => new Promise<void>((r) => { finish = r; }));
      await userEvent.dblClick(undoButton());
      expect(perform).toHaveBeenCalledTimes(1);
      await act(async () => finish());
      await waitFor(() => expect(screen.queryByText(/On the shelf:/)).not.toBeInTheDocument());
      expect(perform).toHaveBeenCalledTimes(1);
    });

    it('a failed undo shows its message', async () => {
      setup();
      await saveForces();
      vi.spyOn(actions, 'perform').mockRejectedValueOnce(new Error('The shelf is full'));
      await userEvent.click(undoButton());
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The shelf is full');
      expect(searchBox().closest('section')).toContainElement(alert);
      expect((await db.records.toArray())[0].deletedAt).toBeNull();
    });

    it('the status region is mounted before it has any text', async () => {
      setup();
      const regions = screen.getAllByRole('status');
      expect(regions.some((r) => r.textContent === '' && r.getAttribute('aria-live') !== 'off')).toBe(true);
    });
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

  describe('coming back to the app', () => {
    const HOUR = 60 * 60 * 1000;
    function comeBack() {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    afterEach(() => {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    });

    it('clears results more than an hour old', async () => {
      setup();
      const searchedAt = Date.now();
      await search('mccoy tyner');
      await card(/Forces Of Nature/);
      vi.spyOn(Date, 'now').mockReturnValue(searchedAt + HOUR + 60_000);
      comeBack();
      expect(screen.queryByRole('button', { name: /Forces Of Nature/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Data provided by Discogs' })).not.toBeInTheDocument();
      expect(searchBox()).toHaveValue('mccoy tyner');
    });

    it('keeps results less than an hour old', async () => {
      setup();
      const searchedAt = Date.now();
      await search('mccoy tyner');
      await card(/Forces Of Nature/);
      vi.spyOn(Date, 'now').mockReturnValue(searchedAt + HOUR - 60_000);
      comeBack();
      expect(screen.getByRole('button', { name: /Forces Of Nature/ })).toBeInTheDocument();
    });
  });

  it('nothing from the search is written to localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setup();
    await search('mccoy tyner forces of nature');
    await userEvent.click(await card(/Forces Of Nature/));
    await screen.findByText(/On the shelf:/);
    expect(setItem).not.toHaveBeenCalled();
  });

  describe('with photos waiting', () => {
    const SAHARA_ID = '00000000-0000-4000-8000-000000000009';
    const drafts = (): Drafts => ({
      front: { side: 'front', bytes: new Uint8Array([1]).buffer, foundEdges: true },
      back: { side: 'back', bytes: new Uint8Array([2]).buffer, foundEdges: true },
    });
    const kinds = async () => (await db.outbox.toArray()).map((p) => p.kind);
    const deletes = async () => (await db.outbox.toArray()).filter((p) => p.kind === 'photo.delete').map((p) => (p.fields as { path: string }).path);

    function withPhotos(records: ShelfRecord[] = []) {
      const photos = { drafts: drafts(), ready: false, onUsed: vi.fn(), onBack: vi.fn() };
      setup({ records, photos });
      return photos;
    }

    async function pickSahara() {
      await search('sahara');
      await userEvent.click(await card(/Sahara/));
    }

    it('saving puts the photos on the new record', async () => {
      const photos = withPhotos();
      await search('mccoy tyner forces of nature');
      await userEvent.click(await card(/Forces Of Nature/));
      expect(await screen.findByText('On the shelf: Forces Of Nature (Live At Slugs’)')).toBeInTheDocument();
      const [record] = await db.records.toArray();
      const paths = (await db.photos.toArray()).map((p) => p.path).sort();
      expect(paths).toHaveLength(2);
      for (const path of paths) expect(path.startsWith(`${SHELF}/${record.id}/`)).toBe(true);
      expect(record.coverPath).toMatch(new RegExp(`^${SHELF}/${record.id}/front-.+\\.jpg$`));
      expect(record.backPath).toMatch(new RegExp(`^${SHELF}/${record.id}/back-.+\\.jpg$`));
      expect([record.coverPath, record.backPath].sort()).toEqual(paths);
      expect(await kinds()).toEqual(['record.create', 'photo.upload', 'photo.upload', 'record.patch']);
      expect(photos.onUsed).toHaveBeenCalledOnce();
    });

    it('Undo takes the record off, hands the photos back and deletes the new files', async () => {
      const photos = withPhotos();
      await search('mccoy tyner forces of nature');
      await userEvent.click(await card(/Forces Of Nature/));
      await screen.findByText(/On the shelf:/);
      const [saved] = await db.records.toArray();
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(photos.onBack).toHaveBeenCalledOnce());
      expect(photos.onBack).toHaveBeenCalledWith(photos.drafts);
      expect((await db.records.toArray())[0].deletedAt).not.toBeNull();
      expect((await deletes()).sort()).toEqual([saved.coverPath, saved.backPath].sort());
      expect(searchBox()).toHaveFocus();
    });

    it('a double tap saves one record with its two photos', async () => {
      withPhotos();
      await search('mccoy tyner forces of nature');
      await userEvent.dblClick(await card(/Forces Of Nature/));
      await screen.findByText(/On the shelf:/);
      expect(await db.records.count()).toBe(1);
      expect((await kinds()).filter((k) => k === 'photo.upload')).toHaveLength(2);
    });

    it('photos already used by a save don’t go on a second record saved before they’re cleared', async () => {
      const photos = withPhotos();
      await search('mccoy tyner forces of nature');
      const finishSave = slowSaves();
      await userEvent.click(await card(/Forces Of Nature/));
      await search('sahara');
      await finishSave();
      await screen.findByText('On the shelf: Forces Of Nature (Live At Slugs’)');
      // The drafts are still showing (clearing them hasn't landed yet); the new card is fair game.
      await userEvent.click(screen.getByRole('button', { name: /Sahara/ }));
      await screen.findByText('On the shelf: Sahara');
      const sahara = (await db.records.toArray()).find((r) => r.title === 'Sahara')!;
      expect(sahara).toMatchObject({ coverPath: null, backPath: null });
      expect((await kinds()).filter((k) => k === 'photo.upload')).toHaveLength(2);
      expect(photos.onUsed).toHaveBeenCalledOnce();
    });

    it('new photos taken after a save go on the next record', async () => {
      withPhotos();
      await search('mccoy tyner forces of nature');
      await userEvent.click(await card(/Forces Of Nature/));
      await screen.findByText(/On the shelf:/);
      rerenderPhotos({ drafts: drafts(), ready: false, onUsed: vi.fn(), onBack: vi.fn() });
      await pickSahara();
      await screen.findByText('On the shelf: Sahara');
      const sahara = (await db.records.toArray()).find((r) => r.title === 'Sahara')!;
      expect(sahara.coverPath).not.toBeNull();
      expect((await kinds()).filter((k) => k === 'photo.upload')).toHaveLength(4);
    });

    describe('a record already on the shelf', () => {
      async function shelved(p: Partial<ShelfRecord> = {}) {
        const record = onShelf(p);
        await db.records.put(record);
        return record;
      }

      it('asks whether to add the photos to it', async () => {
        withPhotos([await shelved()]);
        await pickSahara();
        expect(await screen.findByRole('dialog', { name: 'Add these photos to the one on your shelf?' })).toBeInTheDocument();
        expect(await db.outbox.count()).toBe(0);
      });

      it('Add to that one puts the photos on it, with no new record', async () => {
        const photos = withPhotos([await shelved()]);
        await pickSahara();
        await userEvent.click(await screen.findByRole('button', { name: 'Add to that one' }));
        expect(await screen.findByText('Photos added: Sahara')).toBeInTheDocument();
        const records = await db.records.toArray();
        expect(records).toHaveLength(1);
        expect(records[0].coverPath).toMatch(new RegExp(`^${SHELF}/${SAHARA_ID}/front-`));
        expect(records[0].backPath).toMatch(new RegExp(`^${SHELF}/${SAHARA_ID}/back-`));
        expect(await kinds()).toEqual(['photo.upload', 'photo.upload', 'record.patch']);
        expect(photos.onUsed).toHaveBeenCalledOnce();
      });

      it('Add to that one queues no fun fact', async () => {
        withPhotos([await shelved()]);
        await pickSahara();
        await userEvent.click(await screen.findByRole('button', { name: 'Add to that one' }));
        await screen.findByText('Photos added: Sahara');
        expect(await db.meta.get('funFactQueue')).toBeUndefined();
      });

      it('Undo after Add to that one puts its old paths back and hands the photos back', async () => {
        const photos = withPhotos([await shelved()]);
        await pickSahara();
        await userEvent.click(await screen.findByRole('button', { name: 'Add to that one' }));
        await screen.findByText('Photos added: Sahara');
        await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(photos.onBack).toHaveBeenCalledWith(photos.drafts));
        expect(await db.records.get(SAHARA_ID)).toMatchObject({ coverPath: null, backPath: null, deletedAt: null });
        expect(await deletes()).toHaveLength(2);
      });

      it('Save a second copy saves a new record with the photos', async () => {
        const photos = withPhotos([await shelved()]);
        await pickSahara();
        await userEvent.click(await screen.findByRole('button', { name: 'Save a second copy' }));
        expect(await screen.findByText('On the shelf: Sahara')).toBeInTheDocument();
        const records = await db.records.toArray();
        expect(records).toHaveLength(2);
        const copy = records.find((r) => r.id !== SAHARA_ID) as ShelfRecord;
        expect(copy.coverPath).toMatch(new RegExp(`^${SHELF}/${copy.id}/front-`));
        expect(copy.backPath).toMatch(new RegExp(`^${SHELF}/${copy.id}/back-`));
        expect(await db.records.get(SAHARA_ID)).toMatchObject({ coverPath: null, backPath: null });
        expect(photos.onUsed).toHaveBeenCalledOnce();
      });

      it('Escape saves nothing and keeps the photos', async () => {
        const photos = withPhotos([await shelved()]);
        await pickSahara();
        await screen.findByRole('dialog');
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(await db.records.count()).toBe(1);
        expect(await db.outbox.count()).toBe(0);
        expect(await db.photos.count()).toBe(0);
        expect(photos.onUsed).not.toHaveBeenCalled();
        // The card can still be tapped.
        await userEvent.click(screen.getByRole('button', { name: /Sahara/ }));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
      });

      it('with no photos waiting, a duplicate saves a second copy straight away', async () => {
        setup({ records: [await shelved()] });
        await pickSahara();
        expect(await screen.findByText('On the shelf: Sahara')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(await db.records.count()).toBe(2);
      });

      describe('that already has a front photo', () => {
        const OLD = `${SHELF}/${SAHARA_ID}/front-old.jpg`;

        async function replace() {
          await pickSahara();
          expect(await screen.findByRole('dialog', { name: 'Replace the photos on the one on your shelf?' })).toBeInTheDocument();
          await userEvent.click(screen.getByRole('button', { name: 'Replace them' }));
          await screen.findByText('Photos added: Sahara');
        }

        it('deletes the old front only once Undo has gone', async () => {
          vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
          try {
            withPhotos([await shelved({ coverPath: OLD })]);
            await replace();
            expect((await db.records.get(SAHARA_ID))?.coverPath).not.toBe(OLD);
            act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS - 100));
            expect(await deletes()).toEqual([]);
            act(() => void vi.advanceTimersByTime(1000));
            await waitFor(async () => expect(await deletes()).toEqual([OLD]));
          } finally {
            vi.useRealTimers();
          }
        });

        it('never deletes the old front after Undo', async () => {
          vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
          try {
            withPhotos([await shelved({ coverPath: OLD })]);
            await replace();
            await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
            await waitFor(async () => expect((await db.records.get(SAHARA_ID))?.coverPath).toBe(OLD));
            act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS * 2));
            await new Promise((r) => setTimeout(r, 50));
            expect(await deletes()).not.toContain(OLD);
          } finally {
            vi.useRealTimers();
          }
        });

        it('deletes the old front at once when a newer save replaces the offer', async () => {
          withPhotos([await shelved({ coverPath: OLD })]);
          await replace();
          await search('mccoy tyner forces of nature');
          await userEvent.click(await card(/Forces Of Nature/));
          await screen.findByText('On the shelf: Forces Of Nature (Live At Slugs’)');
          await waitFor(async () => expect(await deletes()).toContain(OLD));
        });

        it('deletes the old front when the screen goes before Undo', async () => {
          withPhotos([await shelved({ coverPath: OLD })]);
          await replace();
          cleanup();
          await waitFor(async () => expect(await deletes()).toEqual([OLD]));
        });
      });
    });
  });

  describe('Claude reads the sleeve', () => {
    const CHARLIE: FoundRecord = {
      releaseId: 501, artist: 'Vince Guaraldi Trio', title: 'A Charlie Brown Christmas', label: 'Fantasy', catalog: 'F-8431', year: 1988,
      format: 'Vinyl, LP, Album, Reissue', country: 'US', genres: ['Jazz'], styles: ['Cool Jazz'], thumb: null,
    };
    const CHARLIE_1965: FoundRecord = { ...CHARLIE, releaseId: 502, year: 1965, catalog: 'FANTASY 3381', format: 'Vinyl, LP, Album, Mono' };
    const READ = { artist: 'Vince Guaraldi Trio', title: 'A Charlie Brown Christmas', barcode: null, catalog: 'F-8431', label: 'Fantasy' };
    const WORDS = 'vince guaraldi trio a charlie brown christmas';
    const HINT = 'Now find it below, and these photos go with it.';
    const drafts = (): Drafts => ({
      front: { side: 'front', bytes: new Uint8Array([1]).buffer, foundEdges: true },
      back: { side: 'back', bytes: new Uint8Array([2]).buffer, foundEdges: true },
    });

    function reading(answer: Identified | null, { records = [] as ShelfRecord[], ready = true, prepare = (_b: FakeBackend) => {} } = {}) {
      const photos = { drafts: drafts(), ready, onUsed: vi.fn(), onBack: vi.fn() };
      const backend = setup({
        records,
        photos,
        prepare: (b) => {
          if (answer) b.identified = answer;
          b.discogsResults = [CHARLIE, CHARLIE_1965];
          prepare(b);
        },
      });
      return { backend, photos };
    }

    /** Holds identifyRecord's answer until the returned function is called. */
    function slowReading(b: FakeBackend) {
      let release: () => void = () => {};
      const real = b.identifyRecord.bind(b);
      vi.spyOn(b, 'identifyRecord').mockImplementation(async (front, back) => {
        await new Promise<void>((r) => (release = r));
        return real(front, back);
      });
      return () => act(async () => release());
    }

    it('says it’s looking it up', async () => {
      reading({ read: READ, match: 'exact', results: [CHARLIE] }, { prepare: (b) => void slowReading(b) });
      expect(await screen.findByText('Looking it up…')).toBeInTheDocument();
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    });

    it('an exact match saves the record with both photos and names the pressing', async () => {
      const { backend, photos } = reading({ read: READ, match: 'exact', results: [CHARLIE] });
      expect(await screen.findByText('On the shelf: A Charlie Brown Christmas')).toBeInTheDocument();
      expect(screen.getByText('1988 · Fantasy · F-8431')).toBeInTheDocument();
      const [record] = await db.records.toArray();
      expect(record).toMatchObject({ artist: 'Vince Guaraldi Trio', title: 'A Charlie Brown Christmas', discogsReleaseId: 501, status: 'owned' });
      expect(record.coverPath).toMatch(new RegExp(`^${SHELF}/${record.id}/front-`));
      expect(record.backPath).toMatch(new RegExp(`^${SHELF}/${record.id}/back-`));
      expect(photos.onUsed).toHaveBeenCalledOnce();
      expect(backend.identifyCalls).toBe(1);
      expect(backend.discogsCalls).toEqual([]);
      await waitFor(async () =>
        expect(JSON.parse((await db.meta.get('funFactQueue'))?.value ?? '[]')).toEqual([{ recordId: record.id, tries: 0, notBefore: expect.any(Number) }]),
      );
    });

    it('the pressing line leaves out what Discogs doesn’t know', async () => {
      reading({ read: READ, match: 'exact', results: [{ ...CHARLIE, label: null, catalog: null }] });
      await screen.findByText('On the shelf: A Charlie Brown Christmas');
      expect(screen.getByText('1988')).toBeInTheDocument();
    });

    it('an exact match already on the shelf asks where the photos go', async () => {
      const existing = onShelf({ artist: 'Vince Guaraldi Trio', title: 'A Charlie Brown Christmas' });
      await db.records.put(existing);
      const { photos } = reading({ read: READ, match: 'exact', results: [CHARLIE] }, { records: [existing] });
      expect(await screen.findByRole('dialog', { name: 'Add these photos to the one on your shelf?' })).toBeInTheDocument();
      expect(await db.records.count()).toBe(1);
      expect(photos.onUsed).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Add to that one' }));
      expect(await screen.findByText('Photos added: A Charlie Brown Christmas')).toBeInTheDocument();
      expect(photos.onUsed).toHaveBeenCalledOnce();
    });

    it('several pressings: asks which, and the one tapped saves with the photos', async () => {
      const { backend, photos } = reading({ read: READ, match: 'several', results: [CHARLIE, CHARLIE_1965] });
      expect(await screen.findByText('Which pressing is yours?')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /1988 · Fantasy · F-8431/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Data provided by Discogs' })).toHaveAttribute('href', `https://www.discogs.com/search/?q=${encodeURIComponent(WORDS)}&type=release`);
      expect(await db.records.count()).toBe(0);
      expect(backend.discogsCalls).toEqual([]);
      await userEvent.click(screen.getByRole('button', { name: /1965 · Fantasy · FANTASY 3381/ }));
      expect(await screen.findByText('On the shelf: A Charlie Brown Christmas')).toBeInTheDocument();
      const [record] = await db.records.toArray();
      expect(record).toMatchObject({ discogsReleaseId: 502, year: 1965 });
      expect(record.coverPath).not.toBeNull();
      expect(photos.onUsed).toHaveBeenCalledOnce();
    });

    it('several pressings: one already on the shelf is tagged', async () => {
      const existing = onShelf({ artist: 'Vince Guaraldi Trio', title: 'A Charlie Brown Christmas' });
      reading({ read: READ, match: 'several', results: [CHARLIE, CHARLIE_1965] }, { records: [existing] });
      await screen.findByText('Which pressing is yours?');
      expect(screen.getAllByText('Already on the shelf')).toHaveLength(2);
    });

    it('a search of your own replaces the question', async () => {
      reading({ read: READ, match: 'several', results: [CHARLIE, CHARLIE_1965] });
      await screen.findByText('Which pressing is yours?');
      await search('sahara');
      await waitFor(() => expect(screen.queryByText('Which pressing is yours?')).not.toBeInTheDocument());
    });

    it('no match: fills the box with what was read and searches it', async () => {
      const { backend } = reading({ read: READ, match: 'none', results: [] });
      expect(await screen.findByText('Couldn’t pin it down. Check the search below.')).toBeInTheDocument();
      expect(searchBox()).toHaveValue(WORDS);
      await waitFor(() => expect(backend.discogsCalls).toEqual([WORDS]));
      expect(await card(/1988 · Fantasy · F-8431/)).toBeInTheDocument();
      expect(screen.queryByText('Which pressing is yours?')).not.toBeInTheDocument();
      expect(await db.records.count()).toBe(0);
    });

    it('no match with nothing read: says so, and searches nothing', async () => {
      const nothing = { artist: null, title: null, barcode: null, catalog: null, label: null };
      const { backend } = reading({ read: nothing, match: 'none', results: [] });
      expect(await screen.findByText('Couldn’t pin it down. Check the search below.')).toBeInTheDocument();
      expect(searchBox()).toHaveValue('');
      expect(backend.discogsCalls).toEqual([]);
    });

    it('Undo after an exact save doesn’t read again: it searches what was read', async () => {
      const { backend, photos } = reading({ read: READ, match: 'exact', results: [CHARLIE] });
      await screen.findByText('On the shelf: A Charlie Brown Christmas');
      // The Add screen clears the drafts once a save has used them.
      rerenderPhotos(undefined);
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(photos.onBack).toHaveBeenCalledWith(photos.drafts));
      // …and puts them back, as a new drafts object.
      rerenderPhotos({ ...photos, drafts: drafts() });
      expect(searchBox()).toHaveValue(WORDS);
      await waitFor(() => expect(backend.discogsCalls).toEqual([WORDS]));
      expect(await card(/1965 · Fantasy · FANTASY 3381/)).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 400));
      expect(backend.identifyCalls).toBe(1);
      expect(screen.queryByText('Looking it up…')).not.toBeInTheDocument();
      expect((await db.records.toArray())[0].deletedAt).not.toBeNull();
    });

    it('the photos taken after that are read as usual', async () => {
      const { backend, photos } = reading({ read: READ, match: 'exact', results: [CHARLIE] });
      await screen.findByText('On the shelf: A Charlie Brown Christmas');
      rerenderPhotos(undefined);
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(photos.onBack).toHaveBeenCalled());
      rerenderPhotos({ ...photos, drafts: drafts() });
      await new Promise((r) => setTimeout(r, 400));
      rerenderPhotos({ ...photos, drafts: drafts() });
      await waitFor(() => expect(backend.identifyCalls).toBe(2));
    });

    it('typing while it reads: the reading’s answer is ignored', async () => {
      let finish: () => Promise<void> = async () => {};
      const { backend, photos } = reading({ read: READ, match: 'exact', results: [CHARLIE] }, { prepare: (b) => void (finish = slowReading(b)) });
      await waitFor(() => expect(backend.identifyRecord).toHaveBeenCalledOnce());
      await userEvent.type(searchBox(), 'sa');
      expect(screen.queryByText('Looking it up…')).not.toBeInTheDocument();
      await finish();
      await new Promise((r) => setTimeout(r, 50));
      expect(await db.records.count()).toBe(0);
      expect(photos.onUsed).not.toHaveBeenCalled();
      expect(screen.queryByText(/On the shelf:/)).not.toBeInTheDocument();
      expect(searchBox()).toHaveValue('sa');
    });

    it('offline: says the photos are kept, and Look it up reads once the signal is back', async () => {
      setOnline(false);
      const { backend } = reading({ read: READ, match: 'exact', results: [CHARLIE] });
      expect(await screen.findByText('Needs signal to look it up. Your photos are kept.')).toBeInTheDocument();
      expect(backend.identifyCalls).toBe(0);
      const lookUp = screen.getByRole('button', { name: 'Look it up' });
      expect(lookUp.className).toContain('h-12');
      act(() => setOnline(true));
      await userEvent.click(lookUp);
      expect(await screen.findByText('On the shelf: A Charlie Brown Christmas')).toBeInTheDocument();
      expect(backend.identifyCalls).toBe(1);
    });

    it('a failure says so, and Try again reads again', async () => {
      const { backend } = reading({ read: READ, match: 'exact', results: [CHARLIE] }, { prepare: (b) => void (b.claudeFails = 'down') });
      expect(await screen.findByText('Couldn’t read the sleeve. Try again, or search below.')).toBeInTheDocument();
      backend.claudeFails = null;
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('On the shelf: A Charlie Brown Christmas')).toBeInTheDocument();
      expect(backend.identifyCalls).toBe(2);
    });

    it('two sleeves in a row, each recognised exactly with no search made: both are saved with their photos', async () => {
      const { backend, photos } = reading({ read: READ, match: 'exact', results: [CHARLIE] });
      await screen.findByText('1988 · Fantasy · F-8431');
      // The Add screen clears the used drafts; the next sleeve's photos arrive.
      rerenderPhotos(undefined);
      backend.identified = { read: READ, match: 'exact', results: [CHARLIE_1965] };
      const next = { ...photos, drafts: { front: { side: 'front' as const, bytes: new Uint8Array([3]).buffer, foundEdges: true } }, onUsed: vi.fn() };
      rerenderPhotos(next);
      await waitFor(() => expect(backend.identifyCalls).toBe(2));
      expect(await screen.findByText('1965 · Fantasy · FANTASY 3381')).toBeInTheDocument();
      const records = await db.records.toArray();
      expect(records.map((r) => r.discogsReleaseId).sort()).toEqual([501, 502]);
      for (const r of records) expect(r.coverPath).not.toBeNull();
      expect(next.onUsed).toHaveBeenCalledOnce();
    });

    it('the no-match line goes once a record is saved, and doesn’t come back for the next sleeve', async () => {
      const { backend, photos } = reading({ read: READ, match: 'none', results: [] });
      await screen.findByText('Couldn’t pin it down. Check the search below.');
      await userEvent.click(await card(/1965 · Fantasy · FANTASY 3381/));
      await screen.findByText('On the shelf: A Charlie Brown Christmas');
      expect(screen.queryByText('Couldn’t pin it down. Check the search below.')).not.toBeInTheDocument();
      // The next sleeve, recognised.
      rerenderPhotos(undefined);
      backend.identified = { read: READ, match: 'exact', results: [CHARLIE] };
      rerenderPhotos({ ...photos, drafts: drafts() });
      await waitFor(async () => expect(await db.records.count()).toBe(2));
      await screen.findByText('1988 · Fantasy · F-8431');
      expect(screen.queryByText('Couldn’t pin it down. Check the search below.')).not.toBeInTheDocument();
    });

    /** Cards from a search made before the photos were done, then the photos ready with the reading held. */
    async function cardsThenReading(records: ShelfRecord[] = []) {
      let finish: () => Promise<void> = async () => {};
      const { backend, photos } = reading({ read: READ, match: 'exact', results: [CHARLIE] }, { records, ready: false, prepare: (b) => void (finish = slowReading(b)) });
      await search('charlie brown christmas');
      await card(/1965 · Fantasy · FANTASY 3381/);
      rerenderPhotos({ ...photos, ready: true });
      await waitFor(() => expect(backend.identifyRecord).toHaveBeenCalledOnce());
      return { backend, photos, finish: () => finish() };
    }

    it('tapping a card while it reads: that card is saved, and the reading’s answer is dropped', async () => {
      const { finish } = await cardsThenReading();
      await userEvent.click(screen.getByRole('button', { name: /1965 · Fantasy · FANTASY 3381/ }));
      await screen.findByText('On the shelf: A Charlie Brown Christmas');
      await finish();
      await new Promise((r) => setTimeout(r, 50));
      const records = await db.records.toArray();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ discogsReleaseId: 502 });
      expect(records[0].coverPath).not.toBeNull();
    });

    it('tapping a card already on the shelf while it reads: the answer doesn’t replace the cards under the question', async () => {
      const existing = onShelf({ artist: 'Vince Guaraldi Trio', title: 'A Charlie Brown Christmas' });
      await db.records.put(existing);
      const { finish } = await cardsThenReading([existing]);
      await userEvent.click(screen.getByRole('button', { name: /1965 · Fantasy · FANTASY 3381/ }));
      await screen.findByRole('dialog', { name: 'Add these photos to the one on your shelf?' });
      await finish();
      await new Promise((r) => setTimeout(r, 50));
      await userEvent.click(screen.getByRole('button', { name: 'Add to that one' }));
      await screen.findByText('Photos added: A Charlie Brown Christmas');
      expect(screen.queryByText('Which pressing is yours?')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await db.records.count()).toBe(1);
    });

    it('the photos line doesn’t repeat itself above the pressings question', async () => {
      reading({ read: READ, match: 'several', results: [CHARLIE, CHARLIE_1965] });
      await screen.findByText('Which pressing is yours?');
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    });

    it('offline with photos waiting: only the reading’s line says it needs signal', async () => {
      setOnline(false);
      reading({ read: READ, match: 'exact', results: [CHARLIE] });
      await screen.findByText('Needs signal to look it up. Your photos are kept.');
      expect(screen.queryByText('Needs signal')).not.toBeInTheDocument();
    });

    it('Look it up and Try again sit outside the announced line', async () => {
      setOnline(false);
      reading({ read: READ, match: 'exact', results: [CHARLIE] });
      await screen.findByText('Needs signal to look it up. Your photos are kept.');
      expect(screen.getByRole('button', { name: 'Look it up' }).closest('[role="status"]')).toBeNull();
      expect(screen.getByText('Needs signal to look it up. Your photos are kept.').closest('[role="status"]')).not.toBeNull();
    });

    describe('the line saying what happens next', () => {
      it('isn’t there without photos', () => {
        setup();
        expect(screen.queryByText(HINT)).not.toBeInTheDocument();
      });

      it('isn’t there while the photos aren’t done (asking for the back, or squaring one up)', async () => {
        const { backend } = reading(null, { ready: false });
        await new Promise((r) => setTimeout(r, 400));
        expect(screen.queryByText(HINT)).not.toBeInTheDocument();
        expect(backend.identifyCalls).toBe(0);
      });

      it('shows once the photos are done and nothing is being looked up', async () => {
        let finish: () => Promise<void> = async () => {};
        reading({ read: READ, match: 'exact', results: [CHARLIE] }, { prepare: (b) => void (finish = slowReading(b)) });
        await screen.findByText('Looking it up…');
        await userEvent.type(searchBox(), 'sa');
        expect(await screen.findByText(HINT)).toBeInTheDocument();
        await finish();
      });
    });
  });
});

describe('FindRecord: the shelf’s own sections', () => {
  const SOUL: FoundRecord = { ...SPARSE, releaseId: 222, artist: 'Al Green', title: 'Let’s Stay Together', genres: ['Funk / Soul'], styles: ['Soul'] };
  const sectionNameOfSaved = async () => {
    const [saved] = await db.records.toArray();
    return (await db.sections.get(saved.sectionId))?.name;
  };

  it('a Funk / Soul result lands in Pop / soul / contemporary on Kahrman’s shelf', async () => {
    setup({ prepare: (b) => (b.discogsResults = [SOUL]) });
    await search('al green');
    await userEvent.click(await card(/Let’s Stay Together/));
    expect(await screen.findByText('On the shelf: Let’s Stay Together')).toBeInTheDocument();
    expect(await sectionNameOfSaved()).toBe('Pop / soul / contemporary');
  });

  it('and in Soul & Funk on a starter shelf', async () => {
    await db.sections.clear();
    await db.sections.bulkPut(sectionsFromSet(SHELF, STARTER_SET, '2026-01-01T00:00:00.000Z'));
    setup({ prepare: (b) => (b.discogsResults = [SOUL]) });
    await search('al green');
    await userEvent.click(await card(/Let’s Stay Together/));
    expect(await screen.findByText('On the shelf: Let’s Stay Together')).toBeInTheDocument();
    expect(await sectionNameOfSaved()).toBe('Soul & Funk');
  });
});
