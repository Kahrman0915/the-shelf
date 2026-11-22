import { describe, expect, it, vi } from 'vitest';
import { signedInUser } from './auth';

const someone = async () => ({ id: 'user-1' });

describe('signedInUser', () => {
  it('rejects a missing header', async () => {
    const getUser = vi.fn(someone);
    expect(await signedInUser(null, getUser)).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('rejects a header that is not a bearer token', async () => {
    const getUser = vi.fn(someone);
    expect(await signedInUser('Basic x', getUser)).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('rejects an empty bearer token', async () => {
    const getUser = vi.fn(someone);
    expect(await signedInUser('Bearer ', getUser)).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('rejects a token that names no user', async () => {
    expect(await signedInUser('Bearer abc.def.ghi', async () => null)).toBeNull();
  });

  it('rejects when the user lookup fails', async () => {
    const getUser = async () => {
      throw new Error('auth server down');
    };
    expect(await signedInUser('Bearer abc.def.ghi', getUser)).toBeNull();
  });

  it('returns the signed-in user id, asking about exactly the bearer value', async () => {
    const getUser = vi.fn(someone);
    expect(await signedInUser('Bearer abc.def.ghi', getUser)).toBe('user-1');
    expect(getUser).toHaveBeenCalledExactlyOnceWith('abc.def.ghi');
  });
});
