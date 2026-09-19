import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootError } from './BootError';

describe('BootError', () => {
  it('points at collection.json when the failure was a bad import', () => {
    render(<BootError kind="import" problems={['coltrane-ballads: grade invalid']} />);
    expect(screen.getByText('Nothing was saved. Fix these in collection.json and reload:')).toBeInTheDocument();
    expect(screen.getByText('coltrane-ballads: grade invalid')).toBeInTheDocument();
  });

  it('blames the phone, not collection.json, for a storage failure', () => {
    render(<BootError kind="storage" problems={['QuotaExceededError: disk full']} />);
    expect(screen.getByText("The shelf couldn't open on this phone.")).toBeInTheDocument();
    expect(screen.queryByText(/collection\.json/)).toBeNull();
    expect(screen.getByText('QuotaExceededError: disk full')).toBeInTheDocument();
  });
});
