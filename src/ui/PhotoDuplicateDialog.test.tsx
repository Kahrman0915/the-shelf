import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhotoDuplicateDialog } from './PhotoDuplicateDialog';

function setup(replacing = false) {
  const props = { onAdd: vi.fn(), onCopy: vi.fn(), onClose: vi.fn() };
  render(<PhotoDuplicateDialog open replacing={replacing} {...props} />);
  return props;
}

describe('PhotoDuplicateDialog', () => {
  it('asks to add the photos to the one on the shelf, with two 48px buttons', async () => {
    const { onAdd, onCopy, onClose } = setup();
    expect(screen.getByRole('dialog', { name: 'Add these photos to the one on your shelf?' })).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add to that one' });
    const copy = screen.getByRole('button', { name: 'Save a second copy' });
    expect(add.className).toContain('h-12');
    expect(copy.className).toContain('h-12');
    await userEvent.click(add);
    expect(onAdd).toHaveBeenCalledOnce();
    await userEvent.click(copy);
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks to replace when that record already has photos', () => {
    setup(true);
    expect(screen.getByRole('dialog', { name: 'Replace the photos on the one on your shelf?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace them' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save a second copy' })).toBeInTheDocument();
  });

  it('Escape closes it and chooses nothing', async () => {
    const { onAdd, onCopy, onClose } = setup();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(onAdd).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
  });

  it('a tap outside closes it and chooses nothing', async () => {
    const { onAdd, onCopy, onClose } = setup();
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    await userEvent.pointer({ keys: '[MouseLeft]', target: overlay });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onAdd).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
  });
});
