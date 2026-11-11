import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Poster } from './Poster';

describe('Poster', () => {
  it('is labelled with the artist and title', () => {
    render(<Poster artist="John Coltrane" title="Ballads" genre="jazz" />);
    expect(screen.getByRole('img', { name: 'Poster for John Coltrane, Ballads' })).toBeInTheDocument();
  });
  it('renders identically every time', () => {
    const a = render(<Poster artist="John Coltrane" title="Ballads" genre="jazz" />);
    const b = render(<Poster artist="John Coltrane" title="Ballads" genre="jazz" />);
    expect(a.container.innerHTML).toBe(b.container.innerHTML);
  });
});
