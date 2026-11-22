import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '@/app/BackendContext';
import { db } from '@/data/db';
import { markPhotoTipsSeen } from '@/data/photoDrafts';
import type { PhotoChanges } from '@/data/photos';
import type { ShelfRecord } from '@/data/schema';
import { squareUpPhoto, warmUpSquaring } from '@/photo/squareUp';
import { FakeBackend } from '@/test/fakeBackend';
import { EditPhotos } from './EditPhotos';
import { sectionIdFor } from '@/domain/sections';

vi.mock('@/photo/squareUp');

const BACK = 's/r/back-1.jpg';
const file = () => new File([new Uint8Array([1, 2])], 'shot.jpg', { type: 'image/jpeg' });
const found = { bytes: new Uint8Array([9]).buffer, foundEdges: true };

function record(p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: 'r', shelfId: 's', status: 'owned', wantsUpgrade: false, upgradeNote: null,
    artist: 'McCoy Tyner', title: 'Sahara', label: null, catalog: null, year: null, format: null, sectionId: sectionIdFor('s', 'jazz'),
    discGrade: 'NM', sleeveGrade: null, pricePaid: null, nmEstimateLow: null, nmEstimateHigh: null, valueNote: null, notes: null,
    discogsReleaseId: null, coverPath: null, backPath: null, funFact: null, funFactSource: null, coverImageUrl: null, boughtAt: null, addedBy: 'u',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, importKey: null, ...p,
  };
}

function Harness({ r, spy }: { r: ShelfRecord; spy: (c: PhotoChanges) => void }) {
  const [changes, setChanges] = useState<PhotoChanges>({});
  return (
    <BackendProvider backend={new FakeBackend({})}>
      <EditPhotos
        record={r}
        changes={changes}
        onChange={(next) => {
          spy(next);
          setChanges(next);
        }}
      />
    </BackendProvider>
  );
}

beforeEach(async () => {
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`);
  URL.revokeObjectURL = vi.fn();
  vi.mocked(squareUpPhoto).mockResolvedValue(found);
  await markPhotoTipsSeen();
});
afterEach(async () => {
  await db.photos.clear();
  await db.meta.delete('photoTipsSeen');
  vi.clearAllMocks();
});

describe('EditPhotos', () => {
  it('shows Take for both sides of a record with no photos', async () => {
    render(<Harness r={record()} spy={() => {}} />);
    expect(screen.getAllByRole('button', { name: 'Take' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('starts loading the squaring-up after Take or Retake opens the camera, never before', async () => {
    await db.photos.put({ path: BACK, bytes: new Uint8Array([1]).buffer });
    render(<Harness r={record({ backPath: BACK })} spy={() => {}} />);
    const front = vi.spyOn(screen.getByLabelText('Front photo file') as HTMLInputElement, 'click');
    const back = vi.spyOn(screen.getByLabelText('Back photo file') as HTMLInputElement, 'click');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
    const warm = vi.mocked(warmUpSquaring).mock.invocationCallOrder;
    expect(warm).toHaveLength(2);
    expect(front.mock.invocationCallOrder[0]).toBeLessThan(warm[0]);
    expect(back.mock.invocationCallOrder[0]).toBeLessThan(warm[1]);
  });

  it('a new front is reported as a change and offers Retake and Remove', async () => {
    const spy = vi.fn();
    render(<Harness r={record()} spy={spy} />);
    fireEvent.change(screen.getByLabelText('Front photo file'), { target: { files: [file()] } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ front: { kind: 'new', photo: { side: 'front', bytes: found.bytes, foundEdges: true } } }));
    expect(await screen.findByRole('img', { name: 'Front photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Take' })).toHaveLength(1);
  });

  it('Remove on a stored back reports a removal and leaves an empty slot with Take', async () => {
    await db.photos.put({ path: BACK, bytes: new Uint8Array([1]).buffer });
    const spy = vi.fn();
    render(<Harness r={record({ backPath: BACK })} spy={spy} />);
    expect(await screen.findByRole('img', { name: 'Back photo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(spy).toHaveBeenCalledWith({ back: { kind: 'remove' } });
    expect(screen.queryByRole('img', { name: 'Back photo' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Take' })).toHaveLength(2);
  });

  it('shows the tips before the first camera, then opens that side’s camera on Got it', async () => {
    await db.meta.delete('photoTipsSeen');
    render(<Harness r={record()} spy={() => {}} />);
    const click = vi.spyOn(screen.getByLabelText('Back photo file') as HTMLInputElement, 'click');
    const takes = screen.getAllByRole('button', { name: 'Take' });
    await waitFor(() => expect(takes[1]).toBeEnabled());
    await userEvent.click(takes[1]);
    expect(await screen.findByText('Tips for a sharp cover')).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(click).toHaveBeenCalledOnce();
  });

  it('ignores a photo that finishes squaring after Remove', async () => {
    let finish!: (v: typeof found) => void;
    vi.mocked(squareUpPhoto).mockReturnValue(new Promise((r) => (finish = r)));
    await db.photos.put({ path: BACK, bytes: new Uint8Array([1]).buffer });
    const spy = vi.fn();
    render(<Harness r={record({ backPath: BACK })} spy={spy} />);
    await screen.findByRole('img', { name: 'Back photo' });
    fireEvent.change(screen.getByLabelText('Back photo file'), { target: { files: [file()] } });
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    finish(found);
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ back: { kind: 'remove' } });
  });
});
