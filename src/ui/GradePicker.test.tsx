import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GradePicker } from './GradePicker';

describe('GradePicker', () => {
  it('lays out grade keys in two rows at narrow widths and one row from sm up', () => {
    render(<GradePicker value="NM" onChange={() => {}} part="Copy in hand" />);
    const group = screen.getByRole('radiogroup', { name: 'Copy in hand condition' });
    expect(group.className).toContain('grid-cols-4');
    expect(group.className).toContain('sm:grid-cols-8');
  });

  it('with no grade, nothing is checked and it says Tap a grade.', () => {
    render(<GradePicker value={null} onChange={() => {}} part="Disc" />);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Tap a grade.')).toBeInTheDocument();
  });

  it('only one grade is in the Tab order', () => {
    const { rerender } = render(<GradePicker value="NM" onChange={() => {}} part="Disc" />);
    const stops = () => screen.getAllByRole('radio').filter((r) => r.tabIndex === 0);
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveTextContent('NM');
    rerender(<GradePicker value={null} onChange={() => {}} part="Disc" />);
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveTextContent('Sealed');
  });

  it('arrow keys move and select', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<GradePicker value="NM" onChange={onChange} part="Disc" />);
    screen.getByRole('radio', { name: 'NM' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('VG+');
    expect(screen.getByRole('radio', { name: 'VG+' })).toHaveFocus();

    rerender(<GradePicker value="Sealed" onChange={onChange} part="Disc" />);
    screen.getByRole('radio', { name: 'Sealed' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('P');
    expect(screen.getByRole('radio', { name: 'P' })).toHaveFocus();
  });

  it('ArrowDown and ArrowUp move too, and Home and End go to the ends', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<GradePicker value="NM" onChange={onChange} part="Disc" />);
    screen.getByRole('radio', { name: 'NM' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('VG+');
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith('NM');
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('P');
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('Sealed');
  });

  it('leaves arrows, Home and End alone when Alt, Ctrl or Cmd is held, so browser and system shortcuts still work', () => {
    const onChange = vi.fn();
    render(<GradePicker value="NM" onChange={onChange} part="Disc" />);
    const nm = screen.getByRole('radio', { name: 'NM' });
    nm.focus();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mod });
        nm.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(nm).toHaveFocus();
  });

  it('Tab leaves the picker after one stop', async () => {
    const user = userEvent.setup();
    render(
      <>
        <GradePicker value="NM" onChange={() => {}} part="Disc" />
        <GradePicker value={null} onChange={() => {}} part="Sleeve" />
        <input aria-label="after" />
      </>,
    );
    await user.tab();
    expect(screen.getAllByRole('radio', { name: 'NM' })[0]).toHaveFocus();
    await user.tab();
    expect(screen.getAllByRole('radio', { name: 'Sealed' })[1]).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('after')).toHaveFocus();
  });
});
