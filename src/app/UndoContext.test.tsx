import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoBar, UndoProvider, useUndo } from './UndoContext';

function Offerer({ undo }: { undo: () => Promise<void> }) {
  const { offer } = useUndo();
  return <button onClick={() => offer('In New arrivals', undo)}>offer</button>;
}

function setup(undo: () => Promise<void>) {
  render(
    <UndoProvider>
      <Offerer undo={undo} />
      <UndoBar />
    </UndoProvider>,
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the Undo bar', () => {
  it('shows the label and Undo', () => {
    setup(async () => {});
    expect(screen.queryByText('In New arrivals')).toBeNull();
    fireEvent.click(screen.getByText('offer'));
    expect(screen.getByText('In New arrivals')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('Undo runs the function once and hides the bar', async () => {
    const undo = vi.fn(async () => {});
    setup(undo);
    fireEvent.click(screen.getByText('offer'));
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Undo' })));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('In New arrivals')).toBeNull();
  });

  it('is gone after 8000 ms, without running the function', () => {
    const undo = vi.fn(async () => {});
    setup(undo);
    fireEvent.click(screen.getByText('offer'));
    act(() => void vi.advanceTimersByTime(7999));
    expect(screen.getByText('In New arrivals')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByText('In New arrivals')).toBeNull();
    expect(undo).not.toHaveBeenCalled();
  });
});
