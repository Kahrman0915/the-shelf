import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import type { FoundRecord } from '@/data/backend';
import { db, sectionsFromSet } from '@/data/db';
import { saveDraft } from '@/data/photoDrafts';
import { squareUpPhoto } from '@/photo/squareUp';
import { FakeBackend } from '@/test/fakeBackend';
import { AddScreen } from './AddScreen';
import { RecordScreen } from './RecordScreen';
import { ShelfScreen } from './ShelfScreen';
import { KAHRMANS_NINE, sectionIdFor } from '@/domain/sections';

vi.mock('@/photo/squareUp');

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';

function renderAdd(path = '/', backend = new FakeBackend({})) {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  return render(
    <BackendProvider backend={backend}>
      <CurrentShelfProvider value={shelf}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<ShelfScreen />} />
            <Route path="/add" element={<AddScreen />} />
            <Route path="/record/:id" element={<RecordScreen />} />
          </Routes>
        </MemoryRouter>
      </CurrentShelfProvider>
    </BackendProvider>,
  );
}

const HAND = 'Not here? Fill it in by hand';

const FOUND: FoundRecord = {
  releaseId: 1, artist: 'John Coltrane', title: 'Ascension', label: 'Impulse!', catalog: 'A-95', year: 1966,
  format: 'Vinyl, LP', country: 'US', genres: ['Jazz'], styles: [], thumb: null,
};

async function openHandForm() {
  await userEvent.click(screen.getByRole('button', { name: HAND }));
}

const box = (name: string) => screen.getByRole('textbox', { name });

async function chooseSection(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Section' }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

async function fillRequired(artist = 'John Coltrane', title = 'Ascension') {
  await userEvent.type(box('Artist'), artist);
  await userEvent.type(box('Title'), title);
  await chooseSection('Jazz');
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.sections.bulkPut(sectionsFromSet(SHELF, KAHRMANS_NINE, '2026-01-01T00:00:00.000Z'));
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AddScreen', () => {
  it('Take photos comes before Find a record', () => {
    renderAdd('/add');
    const take = screen.getByRole('button', { name: 'Take photos' });
    const find = screen.getByRole('searchbox', { name: 'Find a record' });
    expect(take.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Add a record' }).compareDocumentPosition(take) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('saving by hand puts the waiting photos on the new record and clears them', async () => {
    await saveDraft({ side: 'front', bytes: new Uint8Array([1]).buffer, foundEdges: true });
    await saveDraft({ side: 'back', bytes: new Uint8Array([2]).buffer, foundEdges: true });
    renderAdd('/add');
    expect(await screen.findByAltText('Front photo')).toBeInTheDocument();
    await openHandForm();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'The Shelf' });
    await waitFor(async () => expect(await db.photoDrafts.count()).toBe(0));
    const [record] = await db.records.toArray();
    expect(record.coverPath).toMatch(new RegExp(`^${SHELF}/${record.id}/front-.+\\.jpg$`));
    expect(record.backPath).toMatch(new RegExp(`^${SHELF}/${record.id}/back-.+\\.jpg$`));
    expect((await db.photos.toArray()).map((p) => p.path).sort()).toEqual([record.coverPath, record.backPath].sort());
    expect((await db.outbox.toArray()).map((p) => p.kind)).toEqual(['record.create', 'photo.upload', 'photo.upload', 'record.patch']);
  });

  it('a hand save whose drafts fail to clear still counts as saved, so Save isn’t tapped again', async () => {
    await saveDraft({ side: 'front', bytes: new Uint8Array([1]).buffer, foundEdges: true });
    const failed = new Error('IndexedDB is busy');
    vi.spyOn(db.photoDrafts, 'clear').mockRejectedValue(failed);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAdd('/add');
    expect(await screen.findByAltText('Front photo')).toBeInTheDocument();
    await openHandForm();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'The Shelf' });
    expect(await db.records.count()).toBe(1);
    await waitFor(() => expect(logged).toHaveBeenCalledWith(failed));
  });

  it('a found record takes the waiting photos, and Undo brings them back', async () => {
    await saveDraft({ side: 'front', bytes: new Uint8Array([1]).buffer, foundEdges: true });
    const backend = new FakeBackend({});
    backend.discogsResults = [FOUND];
    renderAdd('/add', backend);
    expect(await screen.findByAltText('Front photo')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a record' }), 'coltrane ascension{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /Ascension/ }));
    expect(await screen.findByText('On the shelf: Ascension')).toBeInTheDocument();
    await waitFor(async () => expect(await db.photoDrafts.count()).toBe(0));
    expect((await db.records.toArray())[0].coverPath).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(await db.photoDrafts.count()).toBe(1));
    expect(await screen.findByAltText('Front photo')).toBeInTheDocument();
    expect((await db.records.toArray())[0].deletedAt).not.toBeNull();
  });

  it('taking the front and back finds the record and saves it with both photos', async () => {
    let n = 0;
    vi.mocked(squareUpPhoto).mockImplementation(async () => ({ bytes: new Uint8Array([++n]).buffer, foundEdges: true }));
    const backend = new FakeBackend({});
    backend.identified = { read: { artist: 'John Coltrane', title: 'Ascension', barcode: null, catalog: 'A-95', label: 'Impulse!' }, match: 'exact', results: [FOUND] };
    const identify = vi.spyOn(backend, 'identifyRecord');
    const user = userEvent.setup();
    renderAdd('/add', backend);
    const shot = () => new File([new Uint8Array([1])], 'shot.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Front photo file'), shot());
    expect(await screen.findByText('Now the back')).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Back photo file'), shot());
    expect(await screen.findByText('On the shelf: Ascension')).toBeInTheDocument();
    expect(screen.getByText('1966 · Impulse! · A-95')).toBeInTheDocument();
    await waitFor(async () => expect(await db.photoDrafts.count()).toBe(0));
    const records = await db.records.toArray();
    expect(records).toHaveLength(1);
    expect(records[0].coverPath).toMatch(new RegExp(`^${SHELF}/${records[0].id}/front-`));
    expect(records[0].backPath).toMatch(new RegExp(`^${SHELF}/${records[0].id}/back-`));
    // One reading, of both photos.
    expect(identify).toHaveBeenCalledOnce();
    expect(new Uint8Array(identify.mock.calls[0][0])[0]).toBe(1);
    expect(new Uint8Array(identify.mock.calls[0][1]!)[0]).toBe(2);
    expect(await screen.findByRole('button', { name: 'Take photos' })).toBeInTheDocument();
  });

  it('Undo after a recognised save brings the photos back without reading them again', async () => {
    let n = 0;
    vi.mocked(squareUpPhoto).mockImplementation(async () => ({ bytes: new Uint8Array([++n]).buffer, foundEdges: true }));
    const backend = new FakeBackend({});
    backend.identified = { read: { artist: 'John Coltrane', title: 'Ascension', barcode: null, catalog: 'A-95', label: 'Impulse!' }, match: 'exact', results: [FOUND] };
    backend.discogsResults = [FOUND];
    const user = userEvent.setup();
    renderAdd('/add', backend);
    const shot = () => new File([new Uint8Array([1])], 'shot.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Front photo file'), shot());
    await user.click(await screen.findByRole('button', { name: 'Skip the back' }));
    await screen.findByText('On the shelf: Ascension');
    await waitFor(async () => expect(await db.photoDrafts.count()).toBe(0));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByAltText('Front photo')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Find a record' })).toHaveValue('john coltrane ascension');
    await waitFor(() => expect(backend.discogsCalls).toEqual(['john coltrane ascension']));
    await new Promise((r) => setTimeout(r, 400));
    expect(backend.identifyCalls).toBe(1);
    expect((await db.records.toArray())[0].deletedAt).not.toBeNull();
  });

  it('starting to fill it in by hand while Claude reads: the reading’s answer is ignored', async () => {
    vi.mocked(squareUpPhoto).mockImplementation(async () => ({ bytes: new Uint8Array([1]).buffer, foundEdges: true }));
    const backend = new FakeBackend({});
    backend.identified = { read: { artist: 'John Coltrane', title: 'Ascension', barcode: null, catalog: 'A-95', label: 'Impulse!' }, match: 'exact', results: [FOUND] };
    let release: () => void = () => {};
    const real = backend.identifyRecord.bind(backend);
    const identify = vi.spyOn(backend, 'identifyRecord').mockImplementation(async (front, back) => {
      await new Promise<void>((r) => (release = r));
      return real(front, back);
    });
    const user = userEvent.setup();
    renderAdd('/add', backend);
    await user.upload(screen.getByLabelText('Front photo file'), new File([new Uint8Array([1])], 'shot.jpg', { type: 'image/jpeg' }));
    await user.click(await screen.findByRole('button', { name: 'Skip the back' }));
    await waitFor(() => expect(identify).toHaveBeenCalledOnce());
    await openHandForm();
    await user.type(box('Artist'), 'John');
    await waitFor(() => expect(screen.queryByText('Looking it up…')).not.toBeInTheDocument());
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.records.count()).toBe(0);
    expect(await db.photoDrafts.count()).toBe(1);
    expect(screen.queryByText(/On the shelf:/)).not.toBeInTheDocument();
  });

  it('with the hand form already being filled in, photos taken aren’t read', async () => {
    vi.mocked(squareUpPhoto).mockImplementation(async () => ({ bytes: new Uint8Array([1]).buffer, foundEdges: true }));
    const backend = new FakeBackend({});
    backend.identified = { read: { artist: 'John Coltrane', title: 'Ascension', barcode: null, catalog: 'A-95', label: 'Impulse!' }, match: 'exact', results: [FOUND] };
    const user = userEvent.setup();
    renderAdd('/add', backend);
    await openHandForm();
    await user.type(box('Artist'), 'John');
    await user.upload(screen.getByLabelText('Front photo file'), new File([new Uint8Array([1])], 'shot.jpg', { type: 'image/jpeg' }));
    await user.click(await screen.findByRole('button', { name: 'Skip the back' }));
    await new Promise((r) => setTimeout(r, 400));
    expect(backend.identifyCalls).toBe(0);
    expect(await db.records.count()).toBe(0);
    expect(screen.queryByText('Looking it up…')).not.toBeInTheDocument();
  });

  it('the find box is first and the hand form starts folded', async () => {
    renderAdd('/add');
    const find = screen.getByRole('searchbox', { name: 'Find a record' });
    const hand = screen.getByRole('button', { name: HAND });
    expect(find.compareDocumentPosition(hand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Add a record' }).compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Artist' })).not.toBeInTheDocument();
    await userEvent.click(hand);
    expect(hand).toHaveAttribute('aria-expanded', 'true');
    expect(box('Artist')).toBeInTheDocument();
  });

  it('folding the hand form keeps what was typed, and Back still asks', async () => {
    renderAdd('/add');
    await openHandForm();
    await userEvent.type(box('Artist'), 'Miles');
    await openHandForm();
    expect(screen.queryByRole('textbox', { name: 'Artist' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Shelf/ }));
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await openHandForm();
    expect(box('Artist')).toHaveValue('Miles');
  });

  it('text in the find box isn’t treated as unsaved', async () => {
    renderAdd('/add');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a record' }), 'mccoy tyner');
    await userEvent.click(screen.getByRole('button', { name: /Shelf/ }));
    expect(await screen.findByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument();
  });

  it('the shelf header has Add, and it opens Add a record', async () => {
    renderAdd('/');
    await userEvent.click(screen.getByRole('link', { name: 'Add' }));
    expect(await screen.findByRole('heading', { name: 'Add a record' })).toBeInTheDocument();
  });

  it('saving adds an owned record and returns to the shelf', async () => {
    renderAdd('/add');
    await openHandForm();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
    const records = await db.records.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ artist: 'John Coltrane', title: 'Ascension', status: 'owned' });
    expect((await db.outbox.toArray()).map((p) => p.kind)).toEqual(['record.create']);
  });

  it('a hand save with no fun fact queues the record for one', async () => {
    renderAdd('/add');
    await openHandForm();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'The Shelf' });
    const [record] = await db.records.toArray();
    await waitFor(async () => expect(JSON.parse((await db.meta.get('funFactQueue'))?.value ?? '[]')).toEqual([{ recordId: record.id, tries: 0 }]));
  });

  it('a hand save with a typed fun fact queues nothing', async () => {
    renderAdd('/add');
    await openHandForm();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Fun fact' }), 'Recorded in one day.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'The Shelf' });
    expect((await db.records.toArray())[0].funFact).toBe('Recorded in one day.');
    expect(await db.meta.get('funFactQueue')).toBeUndefined();
  });

  it('rating while adding saves the rating too', async () => {
    renderAdd('/add');
    await openHandForm();
    await fillRequired();
    await userEvent.click(screen.getAllByRole('radio', { name: /^4 of 5/ })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'The Shelf' });
    expect((await db.outbox.toArray()).map((p) => p.kind)).toEqual(['record.create', 'rating.set']);
    expect(await db.ratings.toArray()).toMatchObject([{ userId: ME, value: 4 }]);
  });

  it('Save and add another stays, keeping section and label', async () => {
    renderAdd('/add');
    await openHandForm();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    await userEvent.type(box('Label'), 'Impulse!');
    await userEvent.click(screen.getByRole('button', { name: 'Save and add another' }));
    await waitFor(() => expect(box('Artist')).toHaveValue(''));
    expect(screen.getByRole('heading', { name: 'Add a record' })).toBeInTheDocument();
    expect(box('Label')).toHaveValue('Impulse!');
    expect(screen.getByRole('combobox', { name: 'Section' })).toHaveTextContent('Jazz / big band');
    expect(await db.records.count()).toBe(1);
  });

  it('a double tap on Save adds one record', async () => {
    renderAdd('/add');
    await openHandForm();
    await fillRequired();
    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.dblClick(save);
    await screen.findByRole('heading', { name: 'The Shelf' });
    expect(await db.records.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('Back with unsaved changes asks first', async () => {
    renderAdd('/add');
    await openHandForm();
    await userEvent.type(box('Artist'), 'Miles');
    await userEvent.click(screen.getByRole('button', { name: /Shelf/ }));
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('heading', { name: 'Add a record' })).toBeInTheDocument();
    expect(box('Artist')).toHaveValue('Miles');
    await userEvent.click(screen.getByRole('button', { name: /Shelf/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
  });

  it('Back with nothing typed just goes back', async () => {
    renderAdd('/add');
    await openHandForm();
    await userEvent.click(screen.getByRole('button', { name: /Shelf/ }));
    expect(await screen.findByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument();
  });

  it('Open it on the duplicate line asks first, then opens the record', async () => {
    await db.records.put({
      id: '00000000-0000-4000-8000-000000000009', shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null,
      artist: 'John Coltrane', title: 'Ascension', label: null, catalog: null, year: null, format: null, sectionId: sectionIdFor(SHELF, 'jazz'),
      discGrade: 'NM', sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null,
      discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: ME,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null,
    });
    renderAdd('/add');
    await openHandForm();
    await userEvent.type(box('Artist'), 'John Coltrane');
    await userEvent.type(box('Title'), 'Ascension');
    await userEvent.click(await screen.findByRole('button', { name: 'Open it' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('img', { name: 'Poster for John Coltrane, Ascension' })).toBeInTheDocument();
  });
});
