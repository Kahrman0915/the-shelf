import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Input } from './input';

describe('ui primitives sizing', () => {
  it('renders a 48px tall input whose text size never steps down', () => {
    render(<Input aria-label="x" />);
    const input = screen.getByLabelText('x');
    expect(input.className).toContain('h-12');
    expect(input.className).not.toContain('md:text-sm');
  });

  it('renders a 48px tall default button', () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.className).toContain('h-12');
  });
});
