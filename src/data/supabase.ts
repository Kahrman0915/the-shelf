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

/** How long a request to the shelf may take (photo uploads get UPLOAD_TIMEOUT_MS). A show's weak signal can leave one hanging
 *  for minutes; past this it counts as no signal (see offlineLooking() in supabaseBackend.ts). */
export const FETCH_TIMEOUT_MS = 15_000;

/** A signal that aborts after `ms`. AbortSignal.timeout needs Safari 16; older ones get a timer. */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('The request timed out.', 'TimeoutError')), ms);
  return controller.signal;
}

/** `fetch`, but giving up after `ms`. Our own timeout rejects as an AbortError, not a TimeoutError:
 *  postgrest-js retries a rejected read 3 times (1/2/4 s apart), but never an AbortError, and a
 *  hung read must not take over a minute to report no signal. A caller's own signal still cancels it. */
export function fetchWithTimeout(ms = FETCH_TIMEOUT_MS, base: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return async (input, init) => {
    const timeout = timeoutSignal(ms);
    const own = init?.signal;
    // AbortSignal.any is newer than AbortSignal.timeout; without it, the caller's signal wins.
    const signal = own ? (typeof AbortSignal.any === 'function' ? AbortSignal.any([own, timeout]) : own) : timeout;
    try {
      return await base(input, { ...init, signal });
    } catch (error) {
      if (timeout.aborted && !own?.aborted) throw new DOMException('The request timed out.', 'AbortError');
      throw error;
    }
  };
}

/** How long a photo upload may take. A 1600 px JPEG over a show's weak uplink can need far longer than a read,
 *  and timing out would count as no signal, stopping the whole courier run and the pull after it. */
export const UPLOAD_TIMEOUT_MS = 120_000;

/** Storage's own non-upload POSTs under /object/ (none used today, but they are not uploads). */
const NOT_UPLOADS = /\/storage\/v1\/object\/(sign|move|copy|list|info|public|authenticated)(\/|$)/;

/** The timeout for one request: Storage object uploads (POST or PUT) get UPLOAD_TIMEOUT_MS, everything else FETCH_TIMEOUT_MS. */
export function timeoutFor(input: RequestInfo | URL, init?: RequestInit): number {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const { pathname } = new URL(url, 'http://localhost');
  const upload = (method === 'POST' || method === 'PUT') && pathname.includes('/storage/v1/object/') && !NOT_UPLOADS.test(pathname);
  return upload ? UPLOAD_TIMEOUT_MS : FETCH_TIMEOUT_MS;
}

/** The client's fetch: fetchWithTimeout, with the timeout picked per request by timeoutFor. */
export function shelfFetch(base: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return (input, init) => fetchWithTimeout(timeoutFor(input, init), base)(input, init);
}

let client: SupabaseClient | null = null;

/** The one Supabase client. Screens never call this; only src/data/supabaseBackend.ts does. */
export function supabase(): SupabaseClient {
  if (!client) {
    const { url, key } = readConfig(import.meta.env as Record<string, string | undefined>);
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY },
      global: { fetch: shelfFetch() },
    });
  }
  return client;
}
