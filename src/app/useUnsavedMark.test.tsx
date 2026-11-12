import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUnsavedMark } from './useUnsavedMark';

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
});
