import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ShelfRecord } from '@/data/schema';
import { PileRow } from './PileRow';

const sectionsById = new Map([
  ['jazz-id', { id: 'jazz-id', color: 'jazz' as const, discogsGenres: ['Jazz'], isCatchAll: false }],
  ['reggae-id', { id: 'reggae-id', color: 'reggae' as const, discogsGenres: ['Reggae'], isCatchAll: false }],
]);

function rec(artist: string, sectionId = 'jazz-id'): ShelfRecord {
  return {
    id: crypto.randomUUID(), shelfId: 's', status: 'new_arrival', wantsUpgrade: false, upgradeNote: null, artist, title: 'T', label: null, catalog: null,
    year: null, format: null, sectionId, discGrade: null, sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null,
    notes: null, discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: 'u', createdAt: 'x', updatedAt: 'x', deletedAt: null, importKey: null,
  };
}

describe('PileRow', () => {
  it('renders nothing when there are no new arrivals', () => {
    const { container } = render(<PileRow records={[]} sectionsById={sectionsById} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count and artists, and opens', async () => {
    const onOpen = vi.fn();
    const { container } = render(<PileRow records={[rec('Art Blakey'), rec('Bob Marley', 'reggae-id')]} sectionsById={sectionsById} onOpen={onOpen} />);
    expect(screen.getByText('New arrivals · 2')).toBeInTheDocument();
    expect(screen.getByText('Art Blakey, Bob Marley')).toBeInTheDocument();
    const spines = [...container.querySelectorAll<HTMLElement>('[aria-hidden] > span')].map((s) => s.style.background);
    expect(spines).toEqual(['var(--section-jazz)', 'var(--section-reggae)']);
    await userEvent.click(screen.getByRole('button', { name: 'New arrivals, 2 waiting' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
