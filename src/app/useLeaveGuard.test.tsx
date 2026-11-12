import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useLeaveGuard } from './useLeaveGuard';

function Guarded({ dirty, go }: { dirty: boolean; go: () => void }) {
  const { leave, dialog } = useLeaveGuard(dirty);
  return (
    <>
      <button onClick={() => leave(go)}>Leave</button>
      {dialog}
    </>
  );
}

function reloadPrevented(): boolean {
  const reload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(reload);
  return reload.defaultPrevented;
}

describe('useLeaveGuard', () => {
  it('clean: leaving goes straight away, and a reload is not held', async () => {
    const go = vi.fn();
    render(<Guarded dirty={false} go={go} />);
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument();
    expect(reloadPrevented()).toBe(false);
  });

  it('dirty: asks first; Keep editing stays, Discard goes', async () => {
    const go = vi.fn();
    render(<Guarded dirty go={go} />);
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument());
    expect(go).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(go).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument());
  });

  it('also sets returnValue, which older browsers need before they ask', () => {
    render(<Guarded dirty go={() => {}} />);
    const reload = new Event('beforeunload', { cancelable: true });
    const set: unknown[] = [];
    Object.defineProperty(reload, 'returnValue', { configurable: true, get: () => set.at(-1), set: (v: unknown) => set.push(v) });
    window.dispatchEvent(reload);
    expect(set).toEqual(['']);
    expect(reload.defaultPrevented).toBe(true);
  });

  it('holds a reload only while dirty', () => {
    const { rerender, unmount } = render(<Guarded dirty go={() => {}} />);
    expect(reloadPrevented()).toBe(true);
    rerender(<Guarded dirty={false} go={() => {}} />);
    expect(reloadPrevented()).toBe(false);
    rerender(<Guarded dirty go={() => {}} />);
    expect(reloadPrevented()).toBe(true);
    unmount();
    expect(reloadPrevented()).toBe(false);
  });
});
