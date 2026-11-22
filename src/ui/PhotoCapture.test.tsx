import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/data/db';
import { markPhotoTipsSeen } from '@/data/photoDrafts';
import { squareUpPhoto, warmUpSquaring } from '@/photo/squareUp';
import { PhotoCapture } from './PhotoCapture';

vi.mock('@/photo/squareUp');

const file = () => new File([new Uint8Array([1, 2])], 'shot.jpg', { type: 'image/jpeg' });
const found = { bytes: new Uint8Array([9]).buffer, foundEdges: true };

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`);
  URL.revokeObjectURL = vi.fn();
  vi.mocked(squareUpPhoto).mockResolvedValue(found);
});
afterEach(async () => {
  await db.photoDrafts.clear();
  await db.meta.delete('photoTipsSeen');
  vi.clearAllMocks();
});

const frontInput = () => screen.getByLabelText('Front photo file') as HTMLInputElement;
const backInput = () => screen.getByLabelText('Back photo file') as HTMLInputElement;

async function takeButton() {
  const button = screen.getByRole('button', { name: 'Take photos' });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe('PhotoCapture', () => {
  it('shows the tips first, then opens the front camera on Got it', async () => {
    const user = userEvent.setup();
    render(<PhotoCapture />);
    const click = vi.spyOn(frontInput(), 'click');
    await user.click(await takeButton());
    expect(await screen.findByText('Tips for a sharp cover')).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(click).toHaveBeenCalledOnce();
    await waitFor(async () => expect(await db.meta.get('photoTipsSeen')).toBeDefined());
  });

  it('opens the front camera straight away once the tips are seen', async () => {
    await markPhotoTipsSeen();
    render(<PhotoCapture />);
    const click = vi.spyOn(frontInput(), 'click');
    const button = await takeButton();
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    expect(screen.queryByText('Tips for a sharp cover')).not.toBeInTheDocument();
  });

  it('starts loading the squaring-up after Take photos opens the camera, never before', async () => {
    await markPhotoTipsSeen();
    render(<PhotoCapture />);
    const click = vi.spyOn(frontInput(), 'click');
    fireEvent.click(await takeButton());
    expect(warmUpSquaring).toHaveBeenCalledOnce();
    expect(click.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(warmUpSquaring).mock.invocationCallOrder[0]);
  });

  it('starts loading the squaring-up while the first-time tips are read', async () => {
    render(<PhotoCapture />);
    fireEvent.click(await takeButton());
    expect(await screen.findByText('Tips for a sharp cover')).toBeInTheDocument();
    expect(warmUpSquaring).toHaveBeenCalled();
  });

  it('asks for the back after the front', async () => {
    await markPhotoTipsSeen();
    const user = userEvent.setup();
    render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    expect(await screen.findByAltText('Front photo')).toBeInTheDocument();
    expect(screen.getByText('Now the back')).toBeInTheDocument();
    const click = vi.spyOn(backInput(), 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Take the back' }));
    expect(click).toHaveBeenCalledOnce();
    await user.upload(backInput(), file());
    expect(await screen.findByAltText('Back photo')).toBeInTheDocument();
    expect(screen.queryByText('Now the back')).not.toBeInTheDocument();
  });

  it('skips the back', async () => {
    const user = userEvent.setup();
    render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    await user.click(await screen.findByRole('button', { name: 'Skip the back' }));
    expect(screen.getByAltText('Front photo')).toBeInTheDocument();
    expect(screen.queryByAltText('Back photo')).not.toBeInTheDocument();
    expect(screen.queryByText('Now the back')).not.toBeInTheDocument();
  });

  it('says to find the record once the photos are done, not while it is still asking for the back', async () => {
    const user = userEvent.setup();
    const next = 'Now find it below, and these photos go with it.';
    render(<PhotoCapture />);
    expect(screen.queryByText(next)).not.toBeInTheDocument();
    await user.upload(frontInput(), file());
    expect(await screen.findByText('Now the back')).toBeInTheDocument();
    expect(screen.queryByText(next)).not.toBeInTheDocument();
    await user.upload(backInput(), file());
    expect(await screen.findByText(next)).toBeInTheDocument();
  });

  it('says to find the record after skipping the back', async () => {
    const user = userEvent.setup();
    render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    await user.click(await screen.findByRole('button', { name: 'Skip the back' }));
    expect(screen.getByText('Now find it below, and these photos go with it.')).toBeInTheDocument();
  });

  it('says when it couldn’t find the edges', async () => {
    vi.mocked(squareUpPhoto).mockResolvedValue({ ...found, foundEdges: false });
    const user = userEvent.setup();
    render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    expect(await screen.findByText('Couldn’t find the edges')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument();
  });

  it('retakes a side, replacing its draft', async () => {
    const user = userEvent.setup();
    render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    await screen.findByAltText('Front photo');
    const click = vi.spyOn(frontInput(), 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
    expect(click).toHaveBeenCalledOnce();
    vi.mocked(squareUpPhoto).mockResolvedValue({ bytes: new Uint8Array([7]).buffer, foundEdges: true });
    await user.upload(frontInput(), file());
    await waitFor(async () => expect(new Uint8Array((await db.photoDrafts.get('front'))!.bytes)[0]).toBe(7));
    expect(await db.photoDrafts.count()).toBe(1);
  });

  it('removes a photo', async () => {
    const user = userEvent.setup();
    render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    await screen.findByAltText('Front photo');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByAltText('Front photo')).not.toBeInTheDocument());
    expect(await db.photoDrafts.count()).toBe(0);
  });

  it('keeps the drafts across a reload', async () => {
    const user = userEvent.setup();
    const first = render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    await screen.findByAltText('Front photo');
    first.unmount();
    render(<PhotoCapture />);
    expect(await screen.findByAltText('Front photo')).toBeInTheDocument();
  });

  it('shows a message when squaring fails, and stores nothing', async () => {
    vi.mocked(squareUpPhoto).mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t prepare that photo. Try again.');
    expect(await db.photoDrafts.count()).toBe(0);
  });

  it('reopens the tips from the link', async () => {
    await markPhotoTipsSeen();
    const user = userEvent.setup();
    render(<PhotoCapture />);
    await user.click(screen.getByRole('button', { name: 'Photo tips' }));
    expect(await screen.findByText('Tips for a sharp cover')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByText('Tips for a sharp cover')).not.toBeInTheDocument());
  });

  it('lets you take the back after skipping it', async () => {
    const user = userEvent.setup();
    render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    await user.click(await screen.findByRole('button', { name: 'Skip the back' }));
    const click = vi.spyOn(backInput(), 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Take the back' }));
    expect(click).toHaveBeenCalledOnce();
    await user.upload(backInput(), file());
    expect(await screen.findByAltText('Back photo')).toBeInTheDocument();
  });

  it('lets you take the back after a reload with only a front draft', async () => {
    await db.photoDrafts.put({ side: 'front', bytes: found.bytes, foundEdges: true });
    const user = userEvent.setup();
    render(<PhotoCapture />);
    await screen.findByAltText('Front photo');
    fireEvent.click(screen.getByRole('button', { name: 'Take the back' }));
    await user.upload(backInput(), file());
    expect(await screen.findByAltText('Back photo')).toBeInTheDocument();
  });

  it('keeps the newest photo when an older one finishes squaring last', async () => {
    const user = userEvent.setup();
    let resolveA!: (v: typeof found) => void;
    let resolveB!: (v: typeof found) => void;
    vi.mocked(squareUpPhoto)
      .mockImplementationOnce(() => new Promise((r) => (resolveA = r)))
      .mockImplementationOnce(() => new Promise((r) => (resolveB = r)));
    render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    await user.upload(frontInput(), file());
    resolveB({ bytes: new Uint8Array([2]).buffer, foundEdges: true });
    await waitFor(async () => expect(await db.photoDrafts.get('front')).toBeDefined());
    resolveA({ bytes: new Uint8Array([1]).buffer, foundEdges: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(new Uint8Array((await db.photoDrafts.get('front'))!.bytes)[0]).toBe(2);
  });

  it('stores nothing when a photo is removed while it is squaring', async () => {
    const user = userEvent.setup();
    let resolveA!: (v: typeof found) => void;
    vi.mocked(squareUpPhoto).mockImplementationOnce(() => new Promise((r) => (resolveA = r)));
    render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    resolveA(found);
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.photoDrafts.count()).toBe(0);
  });

  it('stores nothing when a photo finishes squaring after the screen is gone', async () => {
    const user = userEvent.setup();
    let resolveA!: (v: typeof found) => void;
    vi.mocked(squareUpPhoto).mockImplementationOnce(() => new Promise((r) => (resolveA = r)));
    const view = render(<PhotoCapture />);
    await user.upload(frontInput(), file());
    view.unmount();
    resolveA(found);
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.photoDrafts.count()).toBe(0);
  });

  it('closing the tips without Got it neither marks them seen nor opens the camera', async () => {
    const user = userEvent.setup();
    render(<PhotoCapture />);
    const click = vi.spyOn(frontInput(), 'click');
    await user.click(await takeButton());
    await screen.findByText('Tips for a sharp cover');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Tips for a sharp cover')).not.toBeInTheDocument());
    expect(click).not.toHaveBeenCalled();
    expect(await db.meta.get('photoTipsSeen')).toBeUndefined();
  });
});
