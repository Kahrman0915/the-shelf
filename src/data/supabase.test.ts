import { describe, expect, it } from 'vitest';
import { ConfigError, readConfig } from './supabase';

describe('readConfig', () => {
  it('returns the URL and publishable key', () => {
    expect(readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })).toEqual({
      url: 'https://x.supabase.co',
      key: 'sb_publishable_abc',
    });
  });

  it('fails loudly, naming what is missing and where to put it', () => {
    expect(() => readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toThrow(ConfigError);
    expect(() => readConfig({})).toThrow(/VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.*\.env\.local/s);
  });
});
