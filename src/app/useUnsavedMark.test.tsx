import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SAVED_OR_DISCARDED, useUnsavedMark } from './useUnsavedMark';

function Probe({ dirty }: { dirty: boolean }) {
  useUnsavedMark(dirty);
  return null;
}

describe('useUnsavedMark', () => {
  it('marks the page while dirty and clears it when clean or unmounted', () => {
    const { rerender, unmount } = render(<Probe dirty={false} />);
    expect(document.body.dataset.unsaved).toBeUndefined();
    rerender(<Probe dirty />);
    expect(document.body.dataset.unsaved).toBe('true');
    rerender(<Probe dirty={false} />);
    expect(document.body.dataset.unsaved).toBeUndefined();
    rerender(<Probe dirty />);
    unmount();
    expect(document.body.dataset.unsaved).toBeUndefined();
  });

  it('says so when it takes the mark away, after the mark is gone', () => {
    const heard = vi.fn(() => document.body.dataset.unsaved);
    window.addEventListener(SAVED_OR_DISCARDED, heard);
    const { rerender, unmount } = render(<Probe dirty={false} />);
    expect(heard).not.toHaveBeenCalled();
    rerender(<Probe dirty />);
    expect(heard).not.toHaveBeenCalled();
    rerender(<Probe dirty={false} />);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveLastReturnedWith(undefined);
    rerender(<Probe dirty />);
    unmount();
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener(SAVED_OR_DISCARDED, heard);
  });

  it('keeps the mark until every dirty form is clean', () => {
    const heard = vi.fn();
    window.addEventListener(SAVED_OR_DISCARDED, heard);
    const a = render(<Probe dirty />);
    const b = render(<Probe dirty />);
    a.rerender(<Probe dirty={false} />);
    expect(document.body.dataset.unsaved).toBe('true');
    expect(heard).not.toHaveBeenCalled();
    b.unmount();
    expect(document.body.dataset.unsaved).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(1);
    a.unmount();
    window.removeEventListener(SAVED_OR_DISCARDED, heard);
  });
});
