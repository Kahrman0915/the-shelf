import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BuyNewSheet } from './BuyNewSheet';

function setup(onSave: (b: unknown) => Promise<void> = async () => {}, initialArtist = '') {
  render(<BuyNewSheet open initialArtist={initialArtist} onOpenChange={() => {}} onSave={onSave as never} />);
}

async function chooseGenre(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Genre' }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('BuyNewSheet', () => {
  it('prefills the artist from the search', () => {
    setup(undefined, 'art blakey');
    expect(screen.getByRole('textbox', { name: 'Artist' })).toHaveValue('art blakey');
    expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveTextContent('Choose a genre');
  });

  it('will not save without a title and a genre', async () => {
    const onSave = vi.fn(async () => {});
    setup(onSave, 'Art Blakey');
    await userEvent.click(screen.getByRole('button', { name: 'Bought it' }));
    expect(await screen.findByText('Add the title')).toBeInTheDocument();
    expect(screen.getByText('Choose a genre', { selector: 'p' })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves trimmed values with the chosen grade and price', async () => {
    const onSave = vi.fn(async () => {});
    setup(onSave);
    await userEvent.type(screen.getByRole('textbox', { name: 'Artist' }), '  Art Blakey ');
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), ' Moanin’ ');
    await chooseGenre('Jazz');
    await userEvent.click(screen.getByRole('radio', { name: 'VG+' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Price paid' }), '15,50');
    await userEvent.click(screen.getByRole('button', { name: 'Bought it' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ artist: 'Art Blakey', title: 'Moanin’', genre: 'jazz', grade: 'VG+', pricePaid: 15.5 });
  });

  it('a double tap saves once', async () => {
    let release: () => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((r) => { release = r; }));
    setup(onSave, 'Art Blakey');
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Moanin’');
    await chooseGenre('Jazz');
    const button = screen.getByRole('button', { name: 'Bought it' });
    await userEvent.dblClick(button);
    expect(onSave).toHaveBeenCalledTimes(1);
    release();
  });
});
