import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ShelfRecord } from '@/data/schema';
import { SpineRow } from './SpineRow';

const pershing: ShelfRecord = {
  id: '00000000-0000-4000-8000-000000000001', shelfId: 's', status: 'owned', wantsUpgrade: false, upgradeNote: null,
  artist: 'Ahmad Jamal Trio', title: 'At the Pershing: But Not for Me', label: 'Argo', catalog: 'LP-628', year: 1958,
  format: 'Mono', genre: 'jazz', discGrade: 'G', sleeveGrade: 'G', pricePaid: 15, nmEstimateLow: 12, nmEstimateHigh: 32,
  valueNote: null, notes: null, discogsReleaseId: null, coverPath: null, boughtAt: null, addedBy: 'u',
  createdAt: '2025-09-17T00:00:00.000Z', updatedAt: '2025-09-17T00:00:00.000Z', deletedAt: null, importKey: 'x',
};

describe('SpineRow', () => {
  it('reads artist, then title, then year · label · catalog, and never shows price paid', () => {
    render(<SpineRow record={pershing} rating={4} color="var(--genre-jazz)" tag={null} />);
    const text = document.body.textContent ?? '';
    expect(text.indexOf('Ahmad Jamal Trio')).toBeLessThan(text.indexOf('At the Pershing'));
    expect(screen.getByText('1958 · Argo · LP-628')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4 of 5, Love it' })).toBeInTheDocument();
    expect(text).not.toContain('15');
  });

  it('shows nothing for an unplayed record and a tag when given', () => {
    render(<SpineRow record={pershing} rating={undefined} color="var(--genre-jazz)" tag="upgrade" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Upgrade')).toBeInTheDocument();
  });

  it('is a button when it can be opened', async () => {
    const onOpen = vi.fn();
    render(<SpineRow record={pershing} rating={4} color="var(--genre-jazz)" tag={null} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
