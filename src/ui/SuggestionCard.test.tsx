import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Suggestion } from '@/data/schema';
import { SuggestionCard } from './SuggestionCard';

const s: Suggestion = {
  id: '00000000-0000-4000-8000-000000000001', shelfId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', artist: 'Ahmad Jamal', title: 'The Awakening',
  reason: 'You rated At the Top 4', discogsReleaseId: null, discogsGenres: [], discogsStyles: [], status: 'pending', decidedBy: null, decidedAt: null,
  roundAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('SuggestionCard', () => {
  it('shows the artist, title and reason, with two 48 px buttons that call back', async () => {
    const onAdd = vi.fn();
    const onDismiss = vi.fn();
    render(<ul><SuggestionCard suggestion={s} onAdd={onAdd} onDismiss={onDismiss} /></ul>);
    expect(screen.getByText('Ahmad Jamal')).toBeInTheDocument();
    expect(screen.getByText('The Awakening')).toBeInTheDocument();
    expect(screen.getByText('You rated At the Top 4')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add to want list' });
    const no = screen.getByRole('button', { name: 'Not for me' });
    expect(add).toHaveClass('h-12');
    expect(no).toHaveClass('h-12');
    await userEvent.click(add);
    await userEvent.click(no);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
