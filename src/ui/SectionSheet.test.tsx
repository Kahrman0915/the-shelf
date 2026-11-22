import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { sectionsFromSet } from '@/data/db';
import { KAHRMANS_NINE, sectionIdFor } from '@/domain/sections';
import { SectionSheet } from './SectionSheet';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sections = sectionsFromSet(SHELF, KAHRMANS_NINE, '2026-01-01T00:00:00.000Z');
const rock = sections.find((s) => s.id === sectionIdFor(SHELF, 'rock'))!;
const jazz = sections[0];
const christmas = sections[sections.length - 1];

function setup(section = rock, onSave = vi.fn(), onCancel = vi.fn()) {
  render(<SectionSheet open section={section} sections={sections} onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel };
}

describe('SectionSheet', () => {
  it('shows the name, 12 colours, 15 genres and the holiday switch', () => {
    setup();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Rock');
    expect(screen.getAllByRole('radio')).toHaveLength(12);
    expect(screen.getByRole('radio', { name: 'Brick' })).toBeChecked();
    expect(screen.getByText('Discogs genres that go here')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(15);
    expect(screen.getByRole('checkbox', { name: 'Rock' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Holiday records go here' })).not.toBeChecked();
  });

  it('says where a claimed genre lives now', () => {
    setup();
    expect(screen.getByRole('checkbox', { name: 'Jazz (in Jazz / big band)' })).toBeInTheDocument();
  });

  it('says which section has holiday records now, until this one takes them', async () => {
    setup();
    const holiday = screen.getByRole('switch', { name: 'Holiday records go here' });
    expect(screen.getByText('(now in Christmas)')).toBeInTheDocument();
    expect(holiday).toHaveAccessibleDescription('(now in Christmas)');
    await userEvent.click(holiday);
    expect(screen.queryByText('(now in Christmas)')).toBeNull();
  });

  it('says nothing about holiday on the section that has it', () => {
    setup(christmas);
    expect(screen.queryByText(/now in/)).toBeNull();
  });

  it('will not save an empty or over-40 name', async () => {
    const { onSave } = setup();
    const name = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.type(name, 'x'.repeat(41));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('only notes a name another section has, and still saves', async () => {
    const { onSave } = setup();
    const name = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'jazz / BIG band');
    expect(screen.getByText(/another section/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('saves the changes and the moves; Cancel saves nothing', async () => {
    const { onSave, onCancel } = setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ' hard');
    await userEvent.click(screen.getByRole('radio', { name: 'Teal' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Blues' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'Rock hard', color: 'teal', discogsGenres: ['Rock', 'Blues'], takesHoliday: false }, ['up']);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Escape closes without saving', async () => {
    const { onSave, onCancel } = setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ' x');
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('names each colour for a person', () => {
    setup();
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Blue', 'Brick', 'Amber', 'Rose', 'Stone', 'Olive', 'Green', 'Plum', 'Crimson', 'Teal', 'Slate', 'Sand',
    ]);
  });

  it('disables Move up on the first section and Move down on the last', () => {
    setup(jazz);
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move down' })).toBeEnabled();
  });

  it('disables Move down on the last section', () => {
    setup(christmas);
    expect(screen.getByRole('button', { name: 'Move down' })).toBeDisabled();
  });

  it('every control is at least 48px tall', () => {
    setup();
    const tall = (el: HTMLElement) => /(^|\s)((min-)?h-12|size-12)(\s|$)/.test(el.className) || /(^|\s)(min-)?h-12(\s|$)/.test(el.closest('label')?.className ?? '');
    const controls = [
      ...screen.getAllByRole('radio'), ...screen.getAllByRole('checkbox'), screen.getByRole('switch'), screen.getByRole('textbox'),
      ...screen.getAllByRole('button'),
    ];
    for (const c of controls) expect(tall(c), c.outerHTML).toBe(true);
  });
});
