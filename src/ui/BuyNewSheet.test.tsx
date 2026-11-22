import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { sectionsFromSet } from '@/data/db';
import { KAHRMANS_NINE, sectionIdFor } from '@/domain/sections';
import { BuyNewSheet } from './BuyNewSheet';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sections = sectionsFromSet(SHELF, KAHRMANS_NINE, '2026-01-01T00:00:00.000Z');

function setup(onSave: (b: unknown) => Promise<void> = async () => {}, initialArtist = '') {
  render(<BuyNewSheet open initialArtist={initialArtist} sections={sections} onOpenChange={() => {}} onSave={onSave as never} />);
}

async function chooseSection(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Section' }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('BuyNewSheet', () => {
  it('lists the shelf’s sections in order', async () => {
    setup();
    await userEvent.click(screen.getByRole('combobox', { name: 'Section' }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(KAHRMANS_NINE.map((s) => s.name));
  });

  it('prefills the artist from the search', () => {
    setup(undefined, 'art blakey');
    expect(screen.getByRole('textbox', { name: 'Artist' })).toHaveValue('art blakey');
    expect(screen.getByRole('combobox', { name: 'Section' })).toHaveTextContent('Choose a section');
  });

  it('will not save without a title and a section', async () => {
    const onSave = vi.fn(async () => {});
    setup(onSave, 'Art Blakey');
    await userEvent.click(screen.getByRole('button', { name: 'Bought it' }));
    expect(await screen.findByText('Add the title')).toBeInTheDocument();
    expect(screen.getByText('Choose a section', { selector: 'p' })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves trimmed values with the chosen grade and price', async () => {
    const onSave = vi.fn(async () => {});
    setup(onSave);
    await userEvent.type(screen.getByRole('textbox', { name: 'Artist' }), '  Art Blakey ');
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), ' Moanin’ ');
    await chooseSection('Jazz');
    await userEvent.click(screen.getByRole('radio', { name: 'VG+' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Price paid' }), '15,50');
    await userEvent.click(screen.getByRole('button', { name: 'Bought it' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ artist: 'Art Blakey', title: 'Moanin’', sectionId: sectionIdFor(SHELF, 'jazz'), grade: 'VG+', pricePaid: 15.5 });
  });

  it('a double tap saves once', async () => {
    let release: () => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((r) => { release = r; }));
    setup(onSave, 'Art Blakey');
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Moanin’');
    await chooseSection('Jazz');
    const button = screen.getByRole('button', { name: 'Bought it' });
    await userEvent.dblClick(button);
    expect(onSave).toHaveBeenCalledTimes(1);
    release();
  });
});
