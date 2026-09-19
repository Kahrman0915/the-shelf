import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import App from './App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  localStorage.clear();
});

describe('The Shelf', () => {
  it('seeds the collection and shows owned records on the midnight shelf', async () => {
    renderAt('/');
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
    expect(screen.getAllByText(/Coltrane/).length).toBeGreaterThan(0);
    expect(document.documentElement.dataset.theme).toBe('midnight');
  });

  it('switches to show mode, finds a record, and opens its price check', async () => {
    renderAt('/');
    await screen.findByText('Ahmad Jamal Trio');
    await userEvent.click(screen.getByRole('link', { name: 'At the show' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your records' }), 'pershing');
    const row = await screen.findByRole('button', { name: /At the Pershing/ });
    expect(within(row).getByText('Own it')).toBeInTheDocument();
    await userEvent.click(row);
    expect(await screen.findByRole('radiogroup', { name: 'Copy in hand condition' })).toBeInTheDocument();
    expect(screen.getByText('~$12 – $32')).toBeInTheDocument();
  });

  it('keeps the search query when going back from a price check', async () => {
    renderAt('/');
    await screen.findByText('Ahmad Jamal Trio');
    await userEvent.click(screen.getByRole('link', { name: 'At the show' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your records' }), 'pershing');
    const row = await screen.findByRole('button', { name: /At the Pershing/ });
    await userEvent.click(row);
    await screen.findByRole('radiogroup', { name: 'Copy in hand condition' });
    await userEvent.click(screen.getByRole('link', { name: /Back to search/ }));
    expect(await screen.findByRole('searchbox', { name: 'Search your records' })).toHaveValue('pershing');
    expect(await screen.findByRole('button', { name: /At the Pershing/ })).toBeInTheDocument();
  });

  it('says plainly when a search finds nothing', async () => {
    renderAt('/show');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search your records' }), 'zeppelin');
    expect(await screen.findByText('Not in your collection or want list.')).toBeInTheDocument();
  });
});
