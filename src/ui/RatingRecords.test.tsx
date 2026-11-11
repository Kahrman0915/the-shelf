import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RatingRecords } from './RatingRecords';

describe('RatingRecords', () => {
  it('offers five records named by number and word', () => {
    render(<RatingRecords value={undefined} onRate={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Your rating' })).toBeInTheDocument();
    const names = screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.textContent);
    expect(names).toEqual(['1 of 5, Not for me', "2 of 5, Didn't love it", '3 of 5, Good', '4 of 5, Love it', '5 of 5, Desert island']);
  });

  it('marks the current value checked', () => {
    render(<RatingRecords value={4} onRate={() => {}} />);
    expect(screen.getByRole('radio', { name: '4 of 5, Love it' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '3 of 5, Good' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onRate with the tapped value', async () => {
    const onRate = vi.fn();
    render(<RatingRecords value={undefined} onRate={onRate} />);
    await userEvent.click(screen.getByRole('radio', { name: '4 of 5, Love it' }));
    expect(onRate).toHaveBeenCalledWith(4);
  });

  it('disables the records when told to', () => {
    render(<RatingRecords value={undefined} onRate={() => {}} disabled />);
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled();
  });
});
