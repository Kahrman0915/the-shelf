import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GenreSelect, GENRE_ITEM_CLASS } from './GenreSelect';

describe('GenreSelect', () => {
  it('is a labelled combobox showing the current genre', () => {
    render(<GenreSelect value="all" onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveTextContent('All genres');
  });

  it('shows the chosen genre by its label', () => {
    render(<GenreSelect value="popsoul" onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveTextContent('Pop / soul / contemporary');
  });

  it('menu items meet 48px tap-target minimum', () => {
    expect(GENRE_ITEM_CLASS).toContain('min-h-12');
  });
});
