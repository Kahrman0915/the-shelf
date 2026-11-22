import { describe, expect, it } from 'vitest';
import { md5Hex } from './md5';

describe('md5Hex', () => {
  it('matches the RFC 1321 vectors', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5Hex('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
  });

  it('handles a 1,000-character string', () => {
    expect(md5Hex('a'.repeat(1000))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
  });

  it('hashes non-ASCII text as UTF-8', () => {
    expect(md5Hex('café')).toBe('07117fe4a1ebd544965dc19573183da2');
  });
});
