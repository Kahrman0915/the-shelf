import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ShelfRecord } from '@/data/schema';
import { PileRow } from './PileRow';

function rec(artist: string, genre: ShelfRecord['genre'] = 'jazz'): ShelfRecord {
  return {
    id: crypto.randomUUID(), shelfId: 's', status: 'new_arrival', wantsUpgrade: false, upgradeNote: null, artist, title: 'T', label: null, catalog: null,
    year: null, format: null, genre, discGrade: null, sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null,
    notes: null, discogsReleaseId: null, coverPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: 'u', createdAt: 'x', updatedAt: 'x', deletedAt: null, importKey: null,
  };
}

describe('PileRow', () => {
  it('renders nothing when there are no new arrivals', () => {
    const { container } = render(<PileRow records={[]} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count and artists, and opens', async () => {
    const onOpen = vi.fn();
    render(<PileRow records={[rec('Art Blakey'), rec('Bob Marley', 'reggae')]} onOpen={onOpen} />);
    expect(screen.getByText('New arrivals · 2')).toBeInTheDocument();
    expect(screen.getByText('Art Blakey, Bob Marley')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New arrivals, 2 waiting' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
