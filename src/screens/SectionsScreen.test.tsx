import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentShelfProvider } from '@/app/CurrentShelf';
import { db, sectionsFromSet } from '@/data/db';
import type { ShelfRecord } from '@/data/schema';
import { KAHRMANS_NINE, sectionIdFor } from '@/domain/sections';
import { SectionsScreen } from './SectionsScreen';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = '11111111-1111-4111-8111-111111111111';
const id = (g: Parameters<typeof sectionIdFor>[1]) => sectionIdFor(SHELF, g);

function record(n: number, genre: Parameters<typeof sectionIdFor>[1], p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`, shelfId: SHELF, status: 'owned', wantsUpgrade: false, upgradeNote: null, artist: `Artist ${n}`, title: 'T',
    label: null, catalog: null, year: null, format: null, sectionId: id(genre), discGrade: null, sleeveGrade: null, pricePaid: null, nmEstimateLow: null,
    nmEstimateHigh: null, valueNote: null, notes: null, discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null,
    coverImageUrl: null, boughtAt: null, addedBy: ME, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    importKey: null, ...p,
  };
}

function renderScreen() {
  const shelf = { shelfId: SHELF, userId: ME, email: 'k@example.com', signOut: async () => null, signOutAndDelete: async () => {} };
  return render(
    <CurrentShelfProvider value={shelf}>
      <MemoryRouter initialEntries={['/settings/sections']}>
        <Routes>
          <Route path="/settings/sections" element={<SectionsScreen />} />
        </Routes>
      </MemoryRouter>
    </CurrentShelfProvider>,
  );
}

const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, `) });
const menu = async (name: string) => userEvent.click(screen.getByRole('button', { name: `More for ${name}` }));
const outbox = async () => (await db.outbox.toArray()).map((p) => p.kind);

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.sections.bulkPut(sectionsFromSet(SHELF, KAHRMANS_NINE, '2026-01-01T00:00:00.000Z'));
  await db.records.bulkPut([record(1, 'rock'), record(2, 'rock'), record(3, 'rock', { deletedAt: '2026-02-01T00:00:00.000Z' }), record(4, 'jazz')]);
});

describe('SectionsScreen', () => {
  it('lists the sections in order with their live record counts', async () => {
    renderScreen();
    await screen.findByRole('button', { name: 'Rock, 2 records' });
    const names = screen.getAllByRole('button', { name: /, \d+ records?$/ }).map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual([...KAHRMANS_NINE.map((s) => expect.stringMatching(new RegExp(`^${s.name.replace(/[/]/g, '\\/')}, `)))]);
    expect(row('Rock')).toHaveTextContent('2');
    expect(row('Jazz / big band')).toHaveTextContent('1');
    expect(row('Reggae')).toHaveTextContent('0');
  });

  it('renames a section with one section.patch', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^Rock, / }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Hard rock');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await outbox()).toEqual(['section.patch']));
    expect((await db.sections.get(id('rock')))?.name).toBe('Hard rock');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull());
  });

  it('taking a genre another section has moves it', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^Rock, / }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Jazz (in Jazz / big band)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.sections.get(id('jazz')))?.discogsGenres).toEqual([]));
    expect((await db.sections.get(id('rock')))?.discogsGenres).toEqual(['Rock', 'Jazz']);
    expect(await outbox()).toEqual(['section.patch']);
  });

  it('turning on holiday clears it on the other section', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^Rock, / }));
    await userEvent.click(screen.getByRole('switch', { name: 'Holiday records go here' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.sections.get(id('rock')))?.takesHoliday).toBe(true));
    expect((await db.sections.get(id('christmas')))?.takesHoliday).toBe(false);
  });

  it('moves a section up and down, and disables the ends', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^Rock, / }));
    await userEvent.click(screen.getByRole('button', { name: 'Move up' }));
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.sections.get(id('rock')))?.position).toBe(0));
    expect((await db.sections.get(id('jazz')))?.position).toBe(1);
    await userEvent.click(await screen.findByRole('button', { name: /^Rock, / }));
    await userEvent.click(screen.getByRole('button', { name: 'Move down' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.sections.get(id('rock')))?.position).toBe(1));
    expect((await db.sections.get(id('jazz')))?.position).toBe(0);
  });

  it('Cancel discards the edits', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^Rock, / }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ' x');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(await db.outbox.count()).toBe(0);
    expect((await db.sections.get(id('rock')))?.name).toBe('Rock');
  });

  it('merges after a confirm, and the records show in the target', async () => {
    renderScreen();
    await screen.findByRole('button', { name: /^Rock, / });
    await menu('Rock');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Merge into…' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Jazz / big band' }));
    expect(await screen.findByText('Move 2 records from Rock into Jazz / big band? Rock will be removed.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(await db.outbox.count()).toBe(0);
    await menu('Rock');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Merge into…' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Jazz / big band' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Merge' }));
    await waitFor(async () => expect(await outbox()).toEqual(['section.merge']));
    await waitFor(() => expect(row('Jazz / big band')).toHaveTextContent('3'));
    expect(screen.queryByRole('button', { name: /^Rock, / })).toBeNull();
  });

  it('offers Delete only for an empty section, and not for the catch-all', async () => {
    renderScreen();
    await screen.findByRole('button', { name: /^Rock, / });
    await menu('Rock');
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await menu('Reggae');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await outbox()).toEqual(['section.merge']));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Reggae, / })).toBeNull());
  });

  it('gives the catch-all no Delete or Merge', async () => {
    renderScreen();
    await screen.findByRole('button', { name: /^Rock, / });
    expect(screen.queryByRole('button', { name: 'More for Miscellaneous' })).toBeNull();
  });

  it('+ Add makes New section and opens it', async () => {
    renderScreen();
    await screen.findByRole('button', { name: /^Rock, / });
    await userEvent.click(screen.getByRole('button', { name: 'Add a section' }));
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('New section');
    expect(await outbox()).toEqual(['section.create']);
    expect(await db.sections.count()).toBe(10);
  });

  it('every control is at least 48px tall', async () => {
    renderScreen();
    await screen.findByRole('button', { name: /^Rock, / });
    for (const b of within(screen.getByRole('main')).getAllByRole('button')) expect(b.className, b.outerHTML).toMatch(/(^|\s)(min-)?h-12(\s|$)/);
  });
});
