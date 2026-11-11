import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '@/data/backend';
import { db } from '@/data/db';
import { savePostcards } from '@/data/outbox';
import { recordToRow } from '@/data/rowMapping';
import type { ShelfRecord } from '@/data/schema';
import { FakeBackend, collectionRows } from '@/test/fakeBackend';
import App from './App';
import { BackendProvider } from './BackendContext';

const K = { userId: '11111111-1111-4111-8111-111111111111', email: 'kahrman@example.com' };
const MEG = { userId: '22222222-2222-4222-8222-222222222222', email: 'meg@example.com' };
const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function kahrmansShelf(extra: { records?: ReturnType<typeof collectionRows>['records']; users?: Record<string, string>; profiles?: Record<string, string>; signedIn?: typeof K | null } = {}) {
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

/** Open the shelf once so the phone has a copy, then leave changes on a record waiting to send. Returns that record's id. */
async function leaveAChangeWaiting(backend: FakeBackend, changes = 1): Promise<string> {
  const first = renderApp(backend);
  await screen.findByText('Ahmad Jamal Trio');
  first.unmount();
  const record = (await db.records.toArray())[0];
  const notes = ['Ask Megan', 'Play side B first'].slice(-changes);
  await savePostcards(
    db,
    notes.map((n) => ({ kind: 'record.patch' as const, shelfId: SHELF, recordId: record.id, userId: K.userId, createdAt: new Date().toISOString(), fields: { notes: n } })),
  );
  return record.id;
}

async function signInAs(email: string) {
  await userEvent.type(await screen.findByLabelText('Your email'), email);
  await userEvent.click(screen.getByRole('button', { name: 'Send my code' }));
  await userEvent.type(await screen.findByLabelText('Code'), '123456');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  localStorage.clear();
  // Run the quick intro (not the ~2s full first-visit one) so the sign-in form is immediately usable.
  localStorage.setItem('shelf:intro-played', '1');
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

  it('opens from the phone’s copy when the stored login can’t refresh offline', async () => {
    const backend = returning();
    const first = renderApp(backend);
    await screen.findByText('Ahmad Jamal Trio');
    first.unmount();
    backend.online = false;
    backend.sessionNeedsRefresh = true;
    renderApp(backend);
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your email')).not.toBeInTheDocument();
  });
});

describe('signing out', () => {
  it('always clears the phone and returns to sign-in, even when signing out fails offline', async () => {
    const backend = returning();
    backend.online = false;
    renderApp(backend);
    await screen.findByRole('heading', { name: 'Couldn’t open your shelf' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Your email')).toBeInTheDocument();
    expect(await db.records.count()).toBe(0);
  });

  it('does not silently sign back in once online again, after signing out offline', async () => {
    const backend = returning();
    const first = renderApp(backend);
    await screen.findByText('Ahmad Jamal Trio');
    first.unmount();

    backend.online = false;
    const second = renderApp(backend, '/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await screen.findByLabelText('Your email');
    second.unmount();

    backend.online = true;
    renderApp(backend);
    expect(await screen.findByLabelText('Your email')).toBeInTheDocument();
    expect(screen.queryByText('Ahmad Jamal Trio')).not.toBeInTheDocument();
  });

  it('sign out sends waiting changes first, then signs out', async () => {
    const backend = returning();
    const id = await leaveAChangeWaiting(backend);
    backend.online = false;
    const tried = vi.spyOn(backend, 'patchRecord');
    renderApp(backend, '/settings');
    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    // The opening sync has tried and found no signal; only signing out can send it now.
    await waitFor(() => expect(tried).toHaveBeenCalled());
    backend.online = true;
    await userEvent.click(signOut);
    expect(await screen.findByLabelText('Your email')).toBeInTheDocument();
    expect(backend.recordRow(id)?.notes).toBe('Play side B first');
    expect(await db.outbox.count()).toBe(0);
  });

  it('sign out offline with a change waiting asks first, and Stay signed in keeps it', async () => {
    const backend = returning();
    await leaveAChangeWaiting(backend);
    backend.online = false;
    renderApp(backend, '/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('1 change hasn’t reached the shelf yet. Signing out deletes it.');
    await userEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Shelf settings' })).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(1);
  });

  it('counts several waiting changes in the sign-out question', async () => {
    const backend = returning();
    await leaveAChangeWaiting(backend, 2);
    backend.online = false;
    renderApp(backend, '/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('2 changes haven’t reached the shelf yet. Signing out deletes them.');
  });

  it('a change saved while the sign-out reaches the server is not wiped', async () => {
    const backend = returning();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let signingOut = false;
    const signOut = backend.signOut.bind(backend);
    backend.signOut = async () => {
      signingOut = true;
      await gate;
      return signOut();
    };
    renderApp(backend, '/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signingOut).toBe(true));
    const id = crypto.randomUUID();
    await savePostcards(db, [{ kind: 'record.patch', shelfId: SHELF, recordId: id, userId: K.userId, createdAt: new Date().toISOString(), fields: { notes: 'Late' } }]);
    release();
    expect(await screen.findByLabelText('Your email')).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(1);
  });

  it('Sign out and delete clears the phone', async () => {
    const backend = returning();
    await leaveAChangeWaiting(backend);
    backend.online = false;
    renderApp(backend, '/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out and delete' }));
    expect(await screen.findByLabelText('Your email')).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.records.count()).toBe(0);
  });
});

describe('when the sign-in has expired', () => {
  it('opening with no session keeps waiting changes, and sends them when the same person signs back in', async () => {
    const backend = returning();
    const id = await leaveAChangeWaiting(backend);
    backend.signedIn = null;
    renderApp(backend);
    await screen.findByLabelText('Your email');
    expect(await db.outbox.count()).toBe(1);
    expect(await db.records.count()).toBeGreaterThan(0);

    await signInAs(K.email);
    expect(await screen.findByText('Ahmad Jamal Trio')).toBeInTheDocument();
    await waitFor(() => expect(backend.recordRow(id)?.notes).toBe('Play side B first'));
    await waitFor(async () => expect(await db.outbox.count()).toBe(0));
  });

  it('a different person signing in is warned; Go back keeps the changes; Continue and delete clears them', async () => {
    const backend = kahrmansShelf({ users: { [K.email]: K.userId, [MEG.email]: MEG.userId }, profiles: { [K.userId]: 'Kahrman' }, signedIn: K });
    await leaveAChangeWaiting(backend);
    backend.signedIn = null;
    renderApp(backend);

    await signInAs(MEG.email);
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      '1 change from the previous person on this phone hasn’t been sent. Continuing deletes it.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(await screen.findByLabelText('Your email')).toBeInTheDocument();
    expect(backend.signedIn).toBeNull();
    expect(await db.outbox.count()).toBe(1);

    await signInAs(MEG.email);
    await userEvent.click(await screen.findByRole('button', { name: 'Continue and delete' }));
    expect(await screen.findByLabelText('What should we call you?')).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.records.count()).toBe(0);
  });

  it('counts several of the previous person’s changes', async () => {
    const backend = kahrmansShelf({ users: { [K.email]: K.userId, [MEG.email]: MEG.userId }, profiles: { [K.userId]: 'Kahrman' }, signedIn: K });
    await leaveAChangeWaiting(backend, 2);
    backend.signedIn = null;
    renderApp(backend);
    await signInAs(MEG.email);
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      '2 changes from the previous person on this phone haven’t been sent. Continuing deletes them.',
    );
  });

  it('a server failure while opening shows the error, not the phone’s copy', async () => {
    const backend = returning();
    const first = renderApp(backend);
    await screen.findByText('Ahmad Jamal Trio');
    first.unmount();
    backend.bootstrap = async () => {
      throw new BackendError('Couldn’t open your shelf: boom');
    };
    renderApp(backend);
    expect(await screen.findByRole('heading', { name: 'Couldn’t open your shelf' })).toBeInTheDocument();
    expect(screen.getByText('Couldn’t open your shelf: boom')).toBeInTheDocument();
    expect(screen.queryByText('Ahmad Jamal Trio')).not.toBeInTheDocument();
  });
});

describe('switching who’s signed in', () => {
  it('clears the departing person’s records before the next person’s shelf loads', async () => {
    const OTHER = { userId: '22222222-2222-4222-8222-222222222222', email: 'meg@example.com' };
    const rows = collectionRows(SHELF, K.userId);
    const backend = new FakeBackend({
      users: { [K.email]: K.userId, [OTHER.email]: OTHER.userId },
      profiles: { [K.userId]: 'Kahrman' },
      shelfFor: { [K.userId]: SHELF },
      records: rows.records,
      ratings: rows.ratings,
      members: [{ shelfId: SHELF, userId: K.userId, role: 'owner', displayName: 'Kahrman' }],
      signedIn: K,
    });
    const first = renderApp(backend);
    await screen.findByText('Ahmad Jamal Trio');
    await backend.signOut();
    first.unmount();

    renderApp(backend);
    await userEvent.type(await screen.findByLabelText('Your email'), OTHER.email);
    await userEvent.click(screen.getByRole('button', { name: 'Send my code' }));
    await userEvent.type(await screen.findByLabelText('Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.type(await screen.findByLabelText('What should we call you?'), 'Meg');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Nothing on the shelf yet.')).toBeInTheDocument();
    expect(screen.queryByText('Ahmad Jamal Trio')).not.toBeInTheDocument();
  });
});

describe('the Record screen', () => {
  it('opens from a shelf row, on midnight', async () => {
    renderApp(returning());
    await userEvent.click(await screen.findByRole('button', { name: /^Ahmad Jamal Trio, / }));
    expect(await screen.findByRole('img', { name: /^Poster for Ahmad Jamal Trio, / })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('midnight');
  });
});

describe('the pile', () => {
  it('the pile appears with a new arrival and goes once it is rated', async () => {
    const arrival: ShelfRecord = {
      id: '00000000-0000-4000-8000-0000000000aa', shelfId: SHELF, status: 'new_arrival', wantsUpgrade: false, upgradeNote: null,
      artist: 'Art Blakey', title: 'Moanin’', label: null, catalog: null, year: null, format: null, genre: 'jazz', discGrade: null, sleeveGrade: null,
      pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null, discogsReleaseId: null, coverPath: null,
      boughtAt: '2026-06-01T00:00:00.000Z', addedBy: K.userId, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', deletedAt: null, importKey: null,
    };
    const rows = collectionRows(SHELF, K.userId);
    const backend = kahrmansShelf({ profiles: { [K.userId]: 'Kahrman' }, signedIn: K, records: [...rows.records, recordToRow(arrival)] });
    renderApp(backend);
    await screen.findByText('Ahmad Jamal Trio');
    await userEvent.click(await screen.findByRole('button', { name: 'New arrivals, 1 waiting' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Art Blakey, Moanin’' }));
    await userEvent.click(await screen.findByRole('radio', { name: '4 of 5, Love it' }));
    await screen.findByText(/On the shelf/);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'The Shelf' });
    expect(screen.queryByRole('button', { name: /^New arrivals, / })).not.toBeInTheDocument();
  });
});

describe('Bought it on the price check', () => {
  const WANTED: ShelfRecord = {
    id: '00000000-0000-4000-8000-0000000000bb', shelfId: SHELF, status: 'wanted', wantsUpgrade: false, upgradeNote: null,
    artist: 'Art Blakey', title: 'Moanin’', label: null, catalog: null, year: null, format: null, genre: 'jazz', discGrade: null, sleeveGrade: null,
    pricePaid: null, nmEstimateLow: 40, nmEstimateHigh: 60, valueNote: null, notes: null, discogsReleaseId: null, coverPath: null,
    boughtAt: null, addedBy: K.userId, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', deletedAt: null, importKey: null,
  };

  /** Open the shelf once so the phone has a copy, then put a wanted record straight into the notebook. */
  async function openPriceCheck(record: ShelfRecord) {
    const backend = returning();
    const first = renderApp(backend);
    await screen.findByText('Ahmad Jamal Trio');
    first.unmount();
    await db.records.put(record);
    renderApp(backend, `/price/${record.id}`);
    await screen.findByText('Art Blakey');
    return backend;
  }

  async function logIt() {
    await userEvent.click(await screen.findByRole('radio', { name: 'VG+' }));
    await userEvent.type(screen.getByRole('textbox', { name: "They're asking" }), '15');
    await userEvent.click(screen.getByRole('button', { name: 'Bought it' }));
  }

  it('Bought it logs the grade and price and offers Undo', async () => {
    await openPriceCheck(WANTED);
    await logIt();
    expect(await screen.findByText('In New arrivals')).toBeInTheDocument();
    const stored = await db.records.get(WANTED.id);
    expect(stored).toMatchObject({ status: 'new_arrival', discGrade: 'VG+', pricePaid: 15 });
  });

  it('Undo puts it back on the want list', async () => {
    await openPriceCheck(WANTED);
    await logIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(await db.records.get(WANTED.id)).toMatchObject({ status: 'wanted', discGrade: null, pricePaid: null }));
    await waitFor(() => expect(screen.queryByText('In New arrivals')).toBeNull());
  });

  it('a double or triple tap logs one purchase', async () => {
    const backend = await openPriceCheck(WANTED);
    const patch = vi.spyOn(backend, 'patchRecord');
    await userEvent.click(await screen.findByRole('radio', { name: 'VG+' }));
    await userEvent.type(screen.getByRole('textbox', { name: "They're asking" }), '15');
    const bought = screen.getByRole('button', { name: 'Bought it' });
    await userEvent.tripleClick(bought);
    await screen.findByText('In New arrivals');
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('an owned record without an upgrade has no Bought it', async () => {
    await openPriceCheck({ ...WANTED, status: 'owned' });
    expect(screen.queryByRole('button', { name: 'Bought it' })).toBeNull();
  });
});
