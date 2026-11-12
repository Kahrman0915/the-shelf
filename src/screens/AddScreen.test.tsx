import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { db } from '@/data/db';
import { AddScreen } from './AddScreen';
import { RecordScreen } from './RecordScreen';
import { ShelfScreen } from './ShelfScreen';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';

function renderAdd(path = '/') {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  return render(
    <CurrentShelfProvider value={shelf}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<ShelfScreen />} />
          <Route path="/add" element={<AddScreen />} />
          <Route path="/record/:id" element={<RecordScreen />} />
        </Routes>
      </MemoryRouter>
    </CurrentShelfProvider>,
  );
}

const box = (name: string) => screen.getByRole('textbox', { name });

async function chooseGenre(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Genre' }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

async function fillRequired(artist = 'John Coltrane', title = 'Ascension') {
  await userEvent.type(box('Artist'), artist);
  await userEvent.type(box('Title'), title);
  await chooseGenre('Jazz');
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('AddScreen', () => {
  it('the shelf header has Add, and it opens Add a record', async () => {
    renderAdd('/');
    await userEvent.click(screen.getByRole('link', { name: 'Add' }));
    expect(await screen.findByRole('heading', { name: 'Add a record' })).toBeInTheDocument();
  });

  it('saving adds an owned record and returns to the shelf', async () => {
    renderAdd('/add');
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
    const records = await db.records.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ artist: 'John Coltrane', title: 'Ascension', status: 'owned' });
    expect((await db.outbox.toArray()).map((p) => p.kind)).toEqual(['record.create']);
  });

  it('rating while adding saves the rating too', async () => {
    renderAdd('/add');
    await fillRequired();
    await userEvent.click(screen.getAllByRole('radio', { name: /^4 of 5/ })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'The Shelf' });
    expect((await db.outbox.toArray()).map((p) => p.kind)).toEqual(['record.create', 'rating.set']);
    expect(await db.ratings.toArray()).toMatchObject([{ userId: ME, value: 4 }]);
  });

  it('Save and add another stays, keeping genre and label', async () => {
    renderAdd('/add');
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    await userEvent.type(box('Label'), 'Impulse!');
    await userEvent.click(screen.getByRole('button', { name: 'Save and add another' }));
    await waitFor(() => expect(box('Artist')).toHaveValue(''));
    expect(screen.getByRole('heading', { name: 'Add a record' })).toBeInTheDocument();
    expect(box('Label')).toHaveValue('Impulse!');
    expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveTextContent('Jazz');
    expect(await db.records.count()).toBe(1);
  });

  it('a double tap on Save adds one record', async () => {
    renderAdd('/add');
    await fillRequired();
    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.dblClick(save);
    await screen.findByRole('heading', { name: 'The Shelf' });
    expect(await db.records.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('Back with unsaved changes asks first', async () => {
    renderAdd('/add');
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
    await userEvent.click(screen.getByRole('button', { name: /Shelf/ }));
    expect(await screen.findByRole('heading', { name: 'The Shelf' })).toBeInTheDocument();
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument();
  });

  it('Open it on the duplicate line asks first, then opens the record', async () => {
    await db.records.put({
      id: '00000000-0000-4000-8000-000000000009', shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null,
      artist: 'John Coltrane', title: 'Ascension', label: null, catalog: null, year: null, format: null, genre: 'jazz',
      discGrade: 'NM', sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null,
      discogsReleaseId: null, coverPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: ME,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null,
    });
    renderAdd('/add');
    await userEvent.type(box('Artist'), 'John Coltrane');
    await userEvent.type(box('Title'), 'Ascension');
    await userEvent.click(await screen.findByRole('button', { name: 'Open it' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('img', { name: 'Poster for John Coltrane, Ascension' })).toBeInTheDocument();
  });
});
