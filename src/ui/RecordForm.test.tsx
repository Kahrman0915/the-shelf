import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ShelfRecord } from '@/data/schema';
import { emptyForm, formFromRecord } from '@/domain/recordForm';
import { RecordForm } from './RecordForm';

const ID = '11111111-1111-4111-8111-111111111111';

function record(p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: ID,
    shelfId: '33333333-3333-4333-8333-333333333333',
    status: 'owned',
    wantsUpgrade: false,
    upgradeNote: null,
    artist: 'John Coltrane',
    title: 'Ascension',
    label: 'Impulse!',
    catalog: null,
    year: 1966,
    format: null,
    genre: 'jazz',
    discGrade: 'Sealed',
    sleeveGrade: null,
    pricePaid: null,
    nmEstimateLow: null,
    nmEstimateHigh: null,
    valueNote: null,
    notes: null,
    discogsReleaseId: null,
    coverPath: null,
    funFact: null,
    funFactSource: null,
    coverImageUrl: null,
    boughtAt: null,
    addedBy: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    deletedAt: null,
    importKey: null,
    ...p,
  };
}

type Save = (fields: never, opts: { rating: number | null; another: boolean }) => Promise<void>;

function setup(over: Partial<React.ComponentProps<typeof RecordForm>> = {}) {
  const onSave = vi.fn<Save>(async () => {});
  const onOpenDuplicate = vi.fn();
  render(
    <RecordForm
      mode="add"
      initial={emptyForm()}
      records={[]}
      onSave={onSave as never}
      onOpenDuplicate={onOpenDuplicate}
      {...over}
    />,
  );
  return { onSave, onOpenDuplicate };
}

async function chooseGenre(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Genre' }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

const box = (name: string) => screen.getByRole('textbox', { name });

describe('RecordForm', () => {
  it('add starts short, More details opens the rest', async () => {
    setup();
    expect(box('Artist')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Your rating' })).toBeInTheDocument();
    expect(screen.getByText('Your rating · optional')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Label' })).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'More details' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Save and add another' })).toBeInTheDocument();

    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Label', 'Catalog', 'Year', 'Pressing', 'Notes', 'Fun fact', 'Fun fact source', 'NM estimate low', 'NM estimate high', 'Value note', 'Price paid']) {
      expect(box(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('radiogroup', { name: 'Sleeve condition' })).toBeInTheDocument();
    expect(box('Year')).toHaveAttribute('inputmode', 'numeric');
    expect(box('NM estimate low')).toHaveAttribute('inputmode', 'decimal');
  });

  it('edit starts with More details open and no rating', () => {
    const r = record();
    setup({ mode: 'edit', initial: formFromRecord(r), excludeId: r.id, records: [r], footer: <a href="#x">Delete record</a> });
    expect(screen.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'true');
    expect(box('Label')).toHaveValue('Impulse!');
    expect(screen.queryByRole('radiogroup', { name: 'Your rating' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save and add another' })).not.toBeInTheDocument();
    expect(screen.getByText('Delete record')).toBeInTheDocument();
    // The record being edited is never its own duplicate.
    expect(screen.queryByText(/Already on the shelf/)).not.toBeInTheDocument();
  });

  it('will not save without artist, title and genre', async () => {
    const { onSave } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Add the artist')).toBeInTheDocument();
    expect(screen.getByText('Add the title')).toBeInTheDocument();
    expect(screen.getByText('Choose a genre', { selector: 'p' })).toBeInTheDocument();
    expect(box('Artist')).toHaveAttribute('aria-describedby');
    expect(box('Artist')).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves the parsed fields', async () => {
    const { onSave } = setup();
    await userEvent.type(box('Artist'), ' John Coltrane ');
    await userEvent.type(box('Title'), 'A Love Supreme');
    await chooseGenre('Jazz');
    await userEvent.click(screen.getByRole('radio', { name: 'NM' }));
    await userEvent.click(screen.getAllByRole('radio', { name: /^4 of 5/ })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    await userEvent.type(box('Year'), '1966');
    await userEvent.type(box('Price paid'), '15,50');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [fields, opts] = onSave.mock.calls[0] as [Record<string, unknown>, { rating: number | null; another: boolean }];
    expect(fields).toMatchObject({ artist: 'John Coltrane', title: 'A Love Supreme', genre: 'jazz', discGrade: 'NM', year: 1966, pricePaid: 15.5, label: null });
    expect(opts).toEqual({ rating: 4, another: false });
  });

  it('Save and add another keeps genre and label and clears the rest', async () => {
    const { onSave } = setup();
    await userEvent.type(box('Artist'), 'John Coltrane');
    await userEvent.type(box('Title'), 'Ascension');
    await chooseGenre('Jazz');
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    await userEvent.type(box('Label'), 'Impulse!');
    await userEvent.type(box('Year'), '1966');
    await userEvent.click(screen.getAllByRole('radio', { name: /^3 of 5/ })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Save and add another' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][1]).toEqual({ rating: 3, another: true });
    await waitFor(() => expect(box('Artist')).toHaveValue(''));
    expect(box('Artist')).toHaveFocus();
    expect(box('Title')).toHaveValue('');
    expect(box('Year')).toHaveValue('');
    expect(box('Label')).toHaveValue('Impulse!');
    expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveTextContent('Jazz');
    expect(screen.getByRole('radio', { name: /^3 of 5/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('a double tap on Save saves once', async () => {
    let release: () => void = () => {};
    const onSave = vi.fn<Save>(() => new Promise<void>((r) => { release = r; }));
    setup({ onSave: onSave as never, initial: { ...emptyForm(), artist: 'A', title: 'T', genre: 'jazz' } });
    await userEvent.dblClick(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save and add another' })).toBeDisabled();
    release();
  });

  it('shows the duplicate line and Open it calls onOpenDuplicate(id)', async () => {
    const r = record();
    const { onOpenDuplicate } = setup({ records: [r, record({ id: 'x', title: 'Other', discGrade: null })] });
    await userEvent.type(box('Artist'), 'john coltrane');
    await userEvent.type(box('Title'), 'ASCENSION');
    expect(screen.getByText(/Already on the shelf: Ascension \(Sealed\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(onOpenDuplicate).toHaveBeenCalledWith(ID);
  });

  it('says no grade when the duplicate has none', async () => {
    setup({ records: [record({ discGrade: null })] });
    await userEvent.type(box('Artist'), 'John Coltrane');
    await userEvent.type(box('Title'), 'Ascension');
    expect(screen.getByText(/Already on the shelf: Ascension \(no grade\)/)).toBeInTheDocument();
  });

  it('keeps what you typed when saving fails', async () => {
    const onSave = vi.fn<Save>(async () => { throw new Error('The server said no'); });
    setup({ onSave: onSave as never });
    await userEvent.type(box('Artist'), 'John Coltrane');
    await userEvent.type(box('Title'), 'Ascension');
    await chooseGenre('Jazz');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server said no');
    expect(box('Artist')).toHaveValue('John Coltrane');
    expect(box('Title')).toHaveValue('Ascension');
    expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveTextContent('Jazz');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('reports dirtiness and marks the page, and clears when changed back', async () => {
    const onDirtyChange = vi.fn();
    setup({ onDirtyChange });
    expect(document.body.dataset.unsaved).toBeUndefined();
    await userEvent.type(box('Artist'), 'x');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(document.body.dataset.unsaved).toBe('true');
    await userEvent.clear(box('Artist'));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(document.body.dataset.unsaved).toBeUndefined();
  });
});
