import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootError } from './BootError';

describe('BootError', () => {
  it('says the app couldn’t open and lists what went wrong', () => {
    render(<BootError problems={['Missing VITE_SUPABASE_URL. Add it to .env.local on your Mac.']} />);
    expect(screen.getByRole('heading', { name: 'Couldn’t open The Shelf' })).toBeInTheDocument();
    expect(screen.getByText(/Missing VITE_SUPABASE_URL/)).toBeInTheDocument();
  });
});
