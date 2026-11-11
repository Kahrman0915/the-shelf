import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { UndoBar, UndoProvider } from '@/app/UndoContext';
import { db } from '@/data/db';
import { ShowScreen } from './ShowScreen';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';

function renderShow() {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  return render(
    <CurrentShelfProvider value={shelf}>
      <UndoProvider>
        <MemoryRouter initialEntries={['/show']}>
          <Routes>
            <Route path="/show" element={<ShowScreen />} />
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
});

describe('ShowScreen', () => {
  it('buying a record you don’t own puts it in New arrivals', async () => {
    renderShow();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your records' }), 'art blakey');
    expect(await screen.findByText('Not in your collection or want list.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bought it' }));

    expect(screen.getByRole('textbox', { name: 'Artist' })).toHaveValue('art blakey');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Artist' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Artist' }), 'Art Blakey');
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Moanin’');
    await userEvent.click(screen.getByRole('combobox', { name: 'Genre' }));
    await userEvent.click(await screen.findByRole('option', { name: /Jazz/ }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Bought it' }).at(-1)!);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('New arrival')).toBeInTheDocument();
    expect(screen.getByText('In New arrivals')).toBeInTheDocument();
    expect(await db.records.count()).toBe(1);
  });
});
