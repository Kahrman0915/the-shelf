import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function readConfig(env: Record<string, string | undefined>): { url: string; key: string } {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const missing = [!url && 'VITE_SUPABASE_URL', !key && 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
  if (missing.length > 0 || !url || !key) {
    throw new ConfigError(`Missing ${missing.join(' and ')}. Add them to .env.local on your Mac, and to Vercel → Settings → Environment Variables.`);
  }
  return { url, key };
}

/** Fixed, so supabaseBackend.signOut() can find and remove the stored login itself when the
 *  server round-trip fails offline (auth-js's own signOut() gives up before clearing it then). */
export const AUTH_STORAGE_KEY = 'the-shelf-auth';

let client: SupabaseClient | null = null;

/** The one Supabase client. Screens never call this; only src/data/supabaseBackend.ts does. */
export function supabase(): SupabaseClient {
  if (!client) {
    const { url, key } = readConfig(import.meta.env as Record<string, string | undefined>);
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY },
    });
  }
  return client;
}
