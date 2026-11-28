import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  it('links to the Sections screen, which keeps the paper theme', async () => {
    renderSettings(backendFor(K));
    const link = await screen.findByRole('link', { name: /^Sections/ });
    expect(link.className).toContain('h-12');
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { name: 'Sections' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('lists who is on the shelf', async () => {
    renderSettings(backendFor(K));
    expect(await screen.findByText('Kahrman')).toBeInTheDocument();
    expect(await screen.findByText('Megan')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('shows the Discogs notice', async () => {
    renderSettings(backendFor(K));
    expect(
      await screen.findByText(
        'This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the photo privacy notice', async () => {
    renderSettings(backendFor(K));
    expect(
      await screen.findByText(
        'Photos you take to add a record are sent to Anthropic’s Claude to read the sleeve. They aren’t stored there.',
      ),
    ).toBeInTheDocument();
  });

  it('lets the owner invite someone by email, and shows them as waiting', async () => {
    renderSettings(backendFor(K));
    await userEvent.type(await screen.findByLabelText('Their email'), 'Friend@Example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add to shelf' }));
    expect(await screen.findByText('friend@example.com')).toBeInTheDocument();
    expect(screen.getByText('Hasn’t signed in yet')).toBeInTheDocument();
    expect(screen.getByText('Added. Now send friend@example.com the link.')).toBeInTheDocument();
  });

  it('says plainly that the app doesn’t email the invite', async () => {
    renderSettings(backendFor(K));
    expect(
      await screen.findByText('The app doesn’t email them. Add their email, then send them the link. They join this shelf when they sign in with that email.'),
    ).toBeInTheDocument();
  });

  describe('Send link', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function addFriend() {
      renderSettings(backendFor(K));
      await userEvent.type(await screen.findByLabelText('Their email'), 'friend@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Add to shelf' }));
      return screen.findByRole('button', { name: 'Send the link to friend@example.com' });
    }

    it('opens the share sheet with the link and the email to sign in with', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
      const button = await addFriend();
      expect(button.className).toContain('h-12');
      await userEvent.click(button);
      expect(share).toHaveBeenCalledWith({
        text: `I added you to my record shelf on The Shelf. Open ${window.location.origin} and sign in with friend@example.com.`,
      });
      expect(screen.queryByText('Copied. Paste it in a message to them.')).toBeNull();
    });

    it('copies the message where there is no share sheet', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share: undefined, clipboard: { writeText } }));
      await userEvent.click(await addFriend());
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('sign in with friend@example.com'));
      expect(await screen.findByText('Copied. Paste it in a message to them.')).toBeInTheDocument();
    });

    it('says nothing when the share sheet is closed', async () => {
      const share = vi.fn().mockRejectedValue(Object.assign(new Error('closed'), { name: 'AbortError' }));
      const writeText = vi.fn();
      vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share, clipboard: { writeText } }));
      await userEvent.click(await addFriend());
      expect(writeText).not.toHaveBeenCalled();
      expect(screen.queryByText(/Copied|Couldn’t open sharing/)).toBeNull();
    });

    it('spells the link out when it can neither share nor copy', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('denied'));
      vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share: undefined, clipboard: { writeText } }));
      await userEvent.click(await addFriend());
      expect(
        await screen.findByText(`Couldn’t open sharing. Send them ${window.location.origin} and tell them to sign in with friend@example.com.`),
      ).toBeInTheDocument();
    });
  });

  it('says so when an email is already invited', async () => {
    renderSettings(backendFor(K));
    const field = await screen.findByLabelText('Their email');
    await userEvent.type(field, 'friend@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add to shelf' }));
    await screen.findByText('friend@example.com');
    await userEvent.type(field, 'friend@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add to shelf' }));
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

  it('shows the storage warning when the phone may clear changes', async () => {
    await db.meta.put({ key: 'storagePersisted', value: 'false' });
    renderSettings(backendFor(K));
    expect(await screen.findByText('This phone may clear unsent changes if it runs low on space.')).toBeInTheDocument();
  });
});
