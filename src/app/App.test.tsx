import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { FakeBackend, collectionRows } from '@/test/fakeBackend';
import App from './App';
import { BackendProvider } from './BackendContext';

const K = { userId: '11111111-1111-4111-8111-111111111111', email: 'kahrman@example.com' };
const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function kahrmansShelf(extra: { profiles?: Record<string, string>; signedIn?: typeof K | null } = {}) {
  const rows = collectionRows(SHELF, K.userId);
  return new FakeBackend({
    users: { [K.email]: K.userId },
    shelfFor: { [K.userId]: SHELF },
    records: rows.records,
    ratings: rows.ratings,
    members: [{ shelfId: SHELF, userId: K.userId, role: 'owner', displayName: 'Kahrman' }],
    ...extra,
  });
}

const returning = () => kahrmansShelf({ profiles: { [K.userId]: 'Kahrman' }, signedIn: K });

function renderApp(backend: FakeBackend, path = '/') {
  return render(
    <BackendProvider backend={backend}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </BackendProvider>,
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  localStorage.clear();
});

describe('signing in', () => {
  it('takes a first-timer from email to code to name to their shelf', async () => {
    const backend = kahrmansShelf();
    renderApp(backend);
    await userEvent.type(await screen.findByLabelText('Your email'), 'kahrman@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send my code' }));
    await userEvent.type(await screen.findByLabelText('Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.type(await screen.findByLabelText('What should we call you?'), 'Kahrman');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
    expect(backend.sentCodesTo).toEqual(['kahrman@example.com']);
  });

  it('says so when the code is wrong, and lets you try again', async () => {
    renderApp(kahrmansShelf());
    await userEvent.type(await screen.findByLabelText('Your email'), 'kahrman@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send my code' }));
    await userEvent.type(await screen.findByLabelText('Code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code didn’t work. Check it, or send a new one.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('refuses something that isn’t an email before sending anything', async () => {
    const backend = kahrmansShelf();
    renderApp(backend);
    await userEvent.type(await screen.findByLabelText('Your email'), 'kahrman');
    await userEvent.click(screen.getByRole('button', { name: 'Send my code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That doesn’t look like an email address.');
    expect(backend.sentCodesTo).toEqual([]);
  });
});

describe('a signed-in person', () => {
  it('goes straight to their midnight shelf', async () => {
    renderApp(returning());
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('midnight');
  });

  it('finds a record at the show, checks its price, and comes back to the same search', async () => {
    renderApp(returning());
    await screen.findByText('Ahmad Jamal Trio');
    await userEvent.click(screen.getByRole('link', { name: 'At the show' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your records' }), 'pershing');
    const row = await screen.findByRole('button', { name: /At the Pershing/ });
    expect(within(row).getByText('Own it')).toBeInTheDocument();
    await userEvent.click(row);
    expect(await screen.findByText('~$12 – $32')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: /Back to search/ }));
    expect(await screen.findByRole('searchbox', { name: 'Search your records' })).toHaveValue('pershing');
  });

  it('says plainly when a search finds nothing', async () => {
    renderApp(returning(), '/show');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search your records' }), 'zeppelin');
    expect(await screen.findByText('Not in your collection or want list.')).toBeInTheDocument();
  });

  it('keeps working from the phone’s copy with no signal', async () => {
    const backend = returning();
    const first = renderApp(backend);
    await screen.findByText('Ahmad Jamal Trio');
    first.unmount();
    backend.online = false;
    renderApp(backend);
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
    expect(await screen.findByText('Couldn’t reach the shelf. Showing what’s on this phone.')).toBeInTheDocument();
  });

  it('shows a clear error, not an empty shelf, when there is no signal and nothing on the phone yet', async () => {
    const backend = returning();
    backend.online = false;
    renderApp(backend);
    expect(await screen.findByRole('heading', { name: 'Couldn’t open your shelf' })).toBeInTheDocument();
    expect(screen.getByText('No signal. Try again when you’re back online.')).toBeInTheDocument();
    backend.online = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
  });
});
