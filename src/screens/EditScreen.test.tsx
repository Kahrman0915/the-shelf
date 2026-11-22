import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { UndoBar, UndoProvider } from '@/app/UndoContext';
import { db } from '@/data/db';
import { markPhotoTipsSeen } from '@/data/photoDrafts';
import type { ShelfRecord } from '@/data/schema';
import { squareUpPhoto } from '@/photo/squareUp';
import { FakeBackend } from '@/test/fakeBackend';
import { EditScreen } from './EditScreen';
import { RecordScreen } from './RecordScreen';
import { ShelfScreen } from './ShelfScreen';

vi.mock('@/photo/squareUp');

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';
const ID = '00000000-0000-4000-8000-000000000009';

function record(p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: ID, shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null,
    artist: 'John Coltrane', title: 'Ascension', label: 'Impulse!', catalog: null, year: 1966, format: null,
    genre: 'jazz', discGrade: 'NM', sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null,
    valueNote: null, notes: null, discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: ME,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...p,
  };
}

function renderEdit(path = `/record/${ID}/edit`) {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  return render(
    <BackendProvider backend={new FakeBackend({})}>
    <CurrentShelfProvider value={shelf}>
      <UndoProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<ShelfScreen />} />
            <Route path="/record/:id" element={<RecordScreen />} />
            <Route path="/record/:id/edit" element={<EditScreen />} />
          </Routes>
        </MemoryRouter>
        <UndoBar />
      </UndoProvider>
    </CurrentShelfProvider>
    </BackendProvider>,
  );
}

const uploadedPath = (p: { fields: object }) => (p.fields as { path: string }).path;
const box = (name: string) => screen.getByRole('textbox', { name });
const poster = () => screen.findByRole('img', { name: 'Poster for John Coltrane, Ascension' });

const squared = { bytes: new Uint8Array([9]).buffer, foundEdges: true };
const shot = () => new File([new Uint8Array([1, 2])], 'shot.jpg', { type: 'image/jpeg' });
const photoInput = (side: 'Front' | 'Back') => screen.getByLabelText(`${side} photo file`);

beforeEach(async () => {
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`);
  URL.revokeObjectURL = vi.fn();
  vi.mocked(squareUpPhoto).mockResolvedValue(squared);
  await db.delete();
  await db.open();
  await markPhotoTipsSeen();
});

describe('EditScreen', () => {
  it('Edit opens the record with More details open', async () => {
    await db.records.put(record());
    renderEdit();
    expect(await screen.findByRole('heading', { name: 'Edit' })).toBeInTheDocument();
    expect(box('Artist')).toHaveValue('John Coltrane');
    expect(box('Title')).toHaveValue('Ascension');
    expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveTextContent('Jazz');
    expect(screen.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'true');
    expect(box('Label')).toHaveValue('Impulse!');
    expect(box('Year')).toHaveValue('1966');
    expect(screen.queryByText(/Already on the shelf/)).not.toBeInTheDocument();
  });

  it('saving sends only the changed field and returns to the record', async () => {
    await db.records.put(record());
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    await userEvent.clear(box('Year'));
    await userEvent.type(box('Year'), '1967');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await poster()).toBeInTheDocument();
    const sent = await db.outbox.toArray();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'record.patch', recordId: ID, fields: { year: 1967 } });
    expect(Object.keys(sent[0].fields)).toEqual(['year']);
    expect((await db.records.get(ID))?.year).toBe(1967);
  });

  it('changing a field and back saves nothing and asks nothing', async () => {
    await db.records.put(record());
    const first = renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    await userEvent.type(box('Artist'), 'x');
    expect(document.body.dataset.unsaved).toBe('true');
    await userEvent.type(box('Artist'), '{Backspace}');
    await waitFor(() => expect(document.body.dataset.unsaved).toBeUndefined());
    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(await poster()).toBeInTheDocument();
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument();
    first.unmount();

    renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    await userEvent.type(box('Artist'), 'x{Backspace}');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await poster()).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(0);
  });

  it('Back with unsaved changes asks first, and a reload is held', async () => {
    await db.records.put(record());
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    await userEvent.type(box('Label'), ' Records');
    const reload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(box('Label')).toHaveValue('Impulse! Records');
    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(await poster()).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(0);
  });

  it('Delete asks, then goes to the shelf with Undo; Undo brings it back', async () => {
    await db.records.put(record());
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    expect(await screen.findByText('Delete Ascension? It goes from both your shelves.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(await db.outbox.count()).toBe(0);
    expect(screen.getByRole('heading', { name: 'Edit' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
    expect(screen.getByText('Deleted Ascension')).toBeInTheDocument();
    expect(screen.queryByText('That record was deleted on another phone.')).not.toBeInTheDocument();
    expect((await db.records.get(ID))?.deletedAt).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await db.records.get(ID))?.deletedAt).toBeNull());
    expect((await db.outbox.toArray()).map((p) => p.fields)).toEqual([{ deletedAt: expect.any(String) }, { deletedAt: null }]);
  });

  it('a record deleted on another phone offers Restore with your changes', async () => {
    await db.records.put(record());
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    await userEvent.clear(box('Year'));
    await userEvent.type(box('Year'), '1967');
    // As a sync would.
    await db.records.update(ID, { deletedAt: '2026-02-01T00:00:00.000Z' });
    expect(await screen.findByText('That record was deleted on another phone.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete record' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restore with your changes' }));
    expect(await poster()).toBeInTheDocument();
    expect(await db.records.get(ID)).toMatchObject({ deletedAt: null, year: 1967 });
    const sent = await db.outbox.toArray();
    expect(sent).toHaveLength(1);
    expect(sent[0].fields).toEqual({ deletedAt: null, year: 1967 });
  });

  it('Leave it deleted goes to the shelf and sends nothing', async () => {
    await db.records.put(record());
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    await userEvent.type(box('Label'), ' Records');
    await db.records.update(ID, { deletedAt: '2026-02-01T00:00:00.000Z' });
    await userEvent.click(await screen.findByRole('button', { name: 'Leave it deleted' }));
    expect(await screen.findByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(0);
    expect((await db.records.get(ID))?.deletedAt).not.toBeNull();
  });

  it('a record from another shelf shows That record isn’t on this phone.', async () => {
    await db.records.put(record({ shelfId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
    renderEdit();
    expect(await screen.findByText('That record isn’t on this phone.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Artist' })).not.toBeInTheDocument();
  });
  it('saving a new front with no field change uploads it, then points the record at it', async () => {
    await db.records.put(record());
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    fireEvent.change(photoInput('Front'), { target: { files: [shot()] } });
    await screen.findByRole('img', { name: 'Front photo' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await poster()).toBeInTheDocument();
    const sent = await db.outbox.toArray();
    expect(sent.map((p) => p.kind)).toEqual(['photo.upload', 'record.patch']);
    const path = uploadedPath(sent[0]);
    expect(path).toMatch(new RegExp(`^${SHELF}/${ID}/front-[0-9a-f-]{36}\\.jpg$`));
    expect(sent[1].fields).toEqual({ coverPath: path });
    expect((await db.records.get(ID))?.coverPath).toBe(path);
    expect(await db.photos.get(path)).toBeDefined();
  });

  it('retaking the back while changing the year sends one patch, then deletes the old back', async () => {
    const OLD = `${SHELF}/${ID}/back-old.jpg`;
    await db.photos.put({ path: OLD, bytes: new Uint8Array([1]).buffer });
    await db.records.put(record({ backPath: OLD }));
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    await userEvent.clear(box('Year'));
    await userEvent.type(box('Year'), '1967');
    fireEvent.change(photoInput('Back'), { target: { files: [shot()] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await poster()).toBeInTheDocument();
    const sent = await db.outbox.toArray();
    expect(sent.map((p) => p.kind)).toEqual(['photo.upload', 'record.patch', 'photo.delete']);
    const path = uploadedPath(sent[0]);
    expect(sent[1].fields).toEqual({ year: 1967, backPath: path });
    expect(sent[2].fields).toEqual({ path: OLD });
  });

  it('a photo change alone marks the page unsaved and makes Back ask first', async () => {
    await db.records.put(record());
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    expect(document.body.dataset.unsaved).toBeUndefined();
    fireEvent.change(photoInput('Front'), { target: { files: [shot()] } });
    await screen.findByRole('img', { name: 'Front photo' });
    expect(document.body.dataset.unsaved).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await poster()).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(0);
  });

  it('Restore with your changes carries the photo fields in its one patch', async () => {
    const OLD = `${SHELF}/${ID}/back-old.jpg`;
    await db.records.put(record({ backPath: OLD }));
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit' });
    fireEvent.change(photoInput('Front'), { target: { files: [shot()] } });
    await screen.findByRole('img', { name: 'Front photo' });
    await db.records.update(ID, { deletedAt: '2026-02-01T00:00:00.000Z' });
    await userEvent.click(await screen.findByRole('button', { name: 'Restore with your changes' }));
    expect(await poster()).toBeInTheDocument();
    const sent = await db.outbox.toArray();
    expect(sent.map((p) => p.kind)).toEqual(['photo.upload', 'record.patch']);
    expect(sent[1].fields).toEqual({ deletedAt: null, coverPath: uploadedPath(sent[0]) });
  });
});
