import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '@/app/App';
import { BackendProvider } from '@/app/BackendContext';
import { db } from '@/data/db';
import { FakeBackend } from '@/test/fakeBackend';

const K = { userId: '11111111-1111-4111-8111-111111111111', email: 'kahrman@example.com' };
const M = { userId: '22222222-2222-4222-8222-222222222222', email: 'megan@example.com' };
const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const members = [
  { shelfId: SHELF, userId: K.userId, role: 'owner' as const, displayName: 'Kahrman' },
  { shelfId: SHELF, userId: M.userId, role: 'member' as const, displayName: 'Megan' },
];

function backendFor(who: typeof K) {
  return new FakeBackend({
    users: { [K.email]: K.userId, [M.email]: M.userId },
    profiles: { [K.userId]: 'Kahrman', [M.userId]: 'Megan' },
    shelfFor: { [K.userId]: SHELF, [M.userId]: SHELF },
    members,
    signedIn: who,
  });
}

function renderSettings(backend: FakeBackend) {
  return render(
    <BackendProvider backend={backend}>
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>
    </BackendProvider>,
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  localStorage.clear();
  // Run the quick intro (not the ~2s full first-visit one) so the sign-in form is immediately usable.
  localStorage.setItem('shelf:intro-played', '1');
});

describe('Shelf settings', () => {
  it('lists who is on the shelf', async () => {
    renderSettings(backendFor(K));
    expect(await screen.findByText('Kahrman')).toBeInTheDocument();
    expect(await screen.findByText('Megan')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('lets the owner invite someone by email, and shows them as waiting', async () => {
    renderSettings(backendFor(K));
    await userEvent.type(await screen.findByLabelText('Their email'), 'Friend@Example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByText('friend@example.com')).toBeInTheDocument();
    expect(screen.getByText('Waiting for them to sign in')).toBeInTheDocument();
  });

  it('says so when an email is already invited', async () => {
    renderSettings(backendFor(K));
    const field = await screen.findByLabelText('Their email');
    await userEvent.type(field, 'friend@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    await screen.findByText('friend@example.com');
    await userEvent.type(field, 'friend@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That email is already invited.');
  });

  it('does not offer invites to someone who isn’t the owner', async () => {
    renderSettings(backendFor(M));
    await screen.findByText('Megan');
    expect(screen.queryByLabelText('Their email')).toBeNull();
    expect(screen.getByText('Only the shelf’s owner can invite people.')).toBeInTheDocument();
  });

  it('signs out, clears the phone and returns to sign-in', async () => {
    renderSettings(backendFor(K));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Your email')).toBeInTheDocument();
    expect(await db.members.count()).toBe(0);
  });
});
