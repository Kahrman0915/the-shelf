import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ShelfRecord } from '@/data/schema';
import { PriceCheck } from './PriceCheck';

function record(p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: '00000000-0000-4000-8000-000000000002', shelfId: 's', status: 'wanted', wantsUpgrade: false, upgradeNote: null,
    artist: 'Ahmad Jamal Trio', title: 'At the Pershing', label: 'Argo', catalog: 'LP-628', year: null, format: null,
    genre: 'jazz', discGrade: null, sleeveGrade: null, pricePaid: null, nmEstimateLow: 40, nmEstimateHigh: 60,
    valueNote: 'Check the label colour.', notes: null, discogsReleaseId: null, coverPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null,
    addedBy: 'u', createdAt: 'x', updatedAt: 'x', deletedAt: null, importKey: null, ...p,
  };
}

describe('PriceCheck', () => {
  it('shifts the fair range with the grade of the copy in hand', async () => {
    render(<PriceCheck record={record()} />);
    expect(screen.getByText('~$40 – $60')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'VG' }));
    expect(screen.getByText('~$10 – $15')).toBeInTheDocument();
    expect(screen.getByText(/Not "very good"/)).toBeInTheDocument();
    expect(screen.getByText('Estimate from the NM range')).toBeInTheDocument();
  });

  it('gives a verdict for the asking price', async () => {
    render(<PriceCheck record={record()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'VG' }));
    const asking = screen.getByRole('textbox', { name: "They're asking" });
    await userEvent.type(asking, '12');
    expect(screen.getByRole('status')).toHaveTextContent('Fair');
    await userEvent.clear(asking);
    await userEvent.type(asking, '25');
    expect(screen.getByRole('status')).toHaveTextContent('Overpriced');
  });

  it('keeps at most one dot in the asking price', async () => {
    render(<PriceCheck record={record()} />);
    const asking = screen.getByRole('textbox', { name: "They're asking" });
    await userEvent.type(asking, '1.2.3');
    expect(asking).toHaveValue('1.23');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('never shows $0 when there is no estimate', () => {
    render(<PriceCheck record={record({ nmEstimateLow: null, nmEstimateHigh: null })} />);
    expect(screen.getByText('No price yet: add a Near Mint estimate')).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).toBeNull();
  });

  it('has no Bought it when the record cannot be bought', () => {
    render(<PriceCheck record={record()} buyable={false} />);
    expect(screen.queryByRole('button', { name: 'Bought it' })).toBeNull();
  });

  it('shows the asking box without an estimate when buyable, but no verdict', async () => {
    render(<PriceCheck record={record({ nmEstimateLow: null, nmEstimateHigh: null })} buyable onBought={async () => {}} />);
    const asking = screen.getByRole('textbox', { name: "They're asking" });
    await userEvent.type(asking, '12');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Bought it' })).toBeInTheDocument();
  });

  it('says what Bought it will log, and logs it', async () => {
    const onBought = vi.fn(async () => {});
    render(<PriceCheck record={record()} buyable onBought={onBought} />);
    expect(screen.getByText('Logs NM')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'VG+' }));
    await userEvent.type(screen.getByRole('textbox', { name: "They're asking" }), '15');
    expect(screen.getByText('Logs VG+ · $15 paid')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bought it' }));
    expect(onBought).toHaveBeenCalledWith({ grade: 'VG+', pricePaid: 15 });
  });

  it('reads a comma as cents', async () => {
    render(<PriceCheck record={record()} buyable onBought={async () => {}} />);
    await userEvent.type(screen.getByRole('textbox', { name: "They're asking" }), '15,50');
    expect(screen.getByText('Logs NM · $15.50 paid')).toBeInTheDocument();
  });
});
