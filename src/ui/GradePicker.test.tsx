import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GradePicker } from './GradePicker';

describe('GradePicker', () => {
  it('lays out grade keys in two rows at narrow widths and one row from sm up', () => {
    render(<GradePicker value="NM" onChange={() => {}} part="Copy in hand" />);
    const group = screen.getByRole('radiogroup', { name: 'Copy in hand condition' });
    expect(group.className).toContain('grid-cols-4');
    expect(group.className).toContain('sm:grid-cols-8');
  });
});
