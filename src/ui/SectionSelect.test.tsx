import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sectionsFromSet } from '@/data/db';
import { KAHRMANS_NINE, sectionIdFor } from '@/domain/sections';
import { SectionSelect, SECTION_ITEM_CLASS } from './SectionSelect';

const SHELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sections = sectionsFromSet(SHELF, KAHRMANS_NINE, '2026-01-01T00:00:00.000Z');

describe('SectionSelect', () => {
  it('is a labelled combobox showing All sections', () => {
    render(<SectionSelect sections={sections} value="all" onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Section' })).toHaveTextContent('All sections');
  });

  it('shows the chosen section by its name', () => {
    render(<SectionSelect sections={sections} value={sectionIdFor(SHELF, 'popsoul')} onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Section' })).toHaveTextContent('Pop / soul / contemporary');
  });

  it('lists All sections, then the shelf’s sections in order, each with its swatch', async () => {
    render(<SectionSelect sections={sections} value="all" onChange={() => {}} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Section' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['All sections', ...KAHRMANS_NINE.map((s) => s.name)]);
    const swatch = (o: HTMLElement) => (o.querySelector('[aria-hidden]') as HTMLElement).style.background;
    expect(options.slice(1).map(swatch)).toEqual(KAHRMANS_NINE.map((s) => `var(--section-${s.color})`));
  });

  it('menu items meet 48px tap-target minimum', () => {
    expect(SECTION_ITEM_CLASS).toContain('min-h-12');
  });
});
