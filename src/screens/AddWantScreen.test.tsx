import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { UndoProvider } from '@/app/UndoContext';
import { db } from '@/data/db';
import { FakeBackend } from '@/test/fakeBackend';
import { AddWantScreen } from './AddWantScreen';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('AddWantScreen', () => {
  it('has the heading, a back link to the want list, and the want-mode search', () => {
    const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
    render(
      <BackendProvider backend={new FakeBackend({})}>
        <CurrentShelfProvider value={shelf}>
          <UndoProvider>
            <MemoryRouter initialEntries={['/want/add']}>
              <Routes>
                <Route path="/want/add" element={<AddWantScreen />} />
                <Route path="/want" element={<p>Want screen</p>} />
              </Routes>
            </MemoryRouter>
          </UndoProvider>
        </CurrentShelfProvider>
      </BackendProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Add to your want list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '‹ Want list' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'This pressing only' })).toBeInTheDocument();
  });
});
