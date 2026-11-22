import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { db } from '@/data/db';
import type { ShelfRecord } from '@/data/schema';
import { FakeBackend } from '@/test/fakeBackend';
import { RecordCover } from './RecordCover';

const FRONT = 's/r/front-1.jpg';
const BACK = 's/r/back-1.jpg';
const bytes = () => new Uint8Array([1, 2, 3]).buffer;

function record(p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: 'r', shelfId: 's', status: 'owned', wantsUpgrade: false, upgradeNote: null,
    artist: 'McCoy Tyner', title: 'Sahara', label: null, catalog: null, year: null, format: null, genre: 'jazz',
    discGrade: 'NM', sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null,
    discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: 'u',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...p,
  };
}

let backend: FakeBackend;
const show = (r: ShelfRecord) =>
  render(
    <BackendProvider backend={backend}>
      <RecordCover record={r} />
    </BackendProvider>,
  );

beforeEach(() => {
  backend = new FakeBackend({});
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(async () => {
  await db.photos.clear();
});

describe('RecordCover', () => {
  it('shows the poster when the record has no photos', () => {
    show(record());
    expect(screen.getByRole('img', { name: /^Poster for/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Flip|Show the/ })).toBeNull();
  });

  it('shows the front photo in place of the poster', async () => {
    await db.photos.put({ path: FRONT, bytes: bytes() });
    show(record({ coverPath: FRONT }));
    expect(await screen.findByRole('img', { name: 'Front of Sahara' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Poster for/ })).toBeNull();
  });

  it('has no Flip without a back photo', async () => {
    await db.photos.put({ path: FRONT, bytes: bytes() });
    show(record({ coverPath: FRONT }));
    await screen.findByRole('img', { name: 'Front of Sahara' });
    expect(screen.queryByRole('button', { name: /Show the/ })).toBeNull();
  });

  it('Flip shows the back, and again shows the front', async () => {
    await db.photos.put({ path: FRONT, bytes: bytes() });
    await db.photos.put({ path: BACK, bytes: bytes() });
    show(record({ coverPath: FRONT, backPath: BACK }));
    const flip = await screen.findByRole('button', { name: 'Show the back' });
    expect(screen.getByRole('img', { name: 'Front of Sahara' })).toBeInTheDocument();
    expect(screen.getByAltText('Back of Sahara')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(flip);
    expect(screen.getByRole('button', { name: 'Show the front' })).toBeInTheDocument();
    expect(screen.getByAltText('Front of Sahara')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('img', { name: 'Back of Sahara' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the front' }));
    expect(screen.getByRole('button', { name: 'Show the back' })).toBeInTheDocument();
  });

  it('shows the poster while the front is still on its way', async () => {
    show(record({ coverPath: FRONT }));
    await waitFor(() => expect(screen.getByRole('img', { name: /^Poster for/ })).toBeInTheDocument());
    expect(screen.queryByRole('img', { name: 'Front of Sahara' })).toBeNull();
  });
});
