import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { BackendError, CLAUDE_DOWN, COVERS_BUCKET, DISCOGS_MESSAGES, NO_SIGNAL, NOT_ENOUGH_RATINGS, REJECTED, SIGN_IN_AGAIN, SUGGEST_DOWN, type Backend, type FoundRecord, type Identified, type Invite, type Member, type SignedIn } from './backend';
import { AUTH_STORAGE_KEY, fetchWithTimeout, readConfig, supabase } from './supabase';

const PAGE = 1000;

/** The function's own limit: it waits on Discogs, so it gets longer than the shelf's 15 s. */
export const DISCOGS_TIMEOUT_MS = 20_000;
const IDENTIFY_TIMEOUT_MS = 30_000;
const FUN_FACT_TIMEOUT_MS = 45_000;
/** The function's own budget is 50 s (Claude gets 35 s of it), so the app waits a little longer. */
export const SUGGEST_TIMEOUT_MS = 60_000;

/** Base64 of the bytes, built in chunks: spreading a 2 MB array into String.fromCharCode overflows the stack. */
export function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < view.length; i += CHUNK) binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** The longest query the function accepts (see cleanQuery() in the discogs-search function). */
const MAX_QUERY = 200;

/** A request that timed out (see fetchWithTimeout() in supabase.ts) or was cut off. postgrest-js
 *  reports one as a message starting with the error's name; anything else carries the name itself. */
const abortedLooking = (error: { message: string; name?: string }) =>
  error.name === 'TimeoutError' || error.name === 'AbortError' || /^(TimeoutError|AbortError)\b/.test(error.message);

export function offlineLooking(error: { message: string; name?: string }): boolean {
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    isAuthRetryableFetchError(error) ||
    abortedLooking(error) ||
    /fetch|network/i.test(error.message)
  );
}

function fail(action: string, error: { message: string; code?: string } | null): never {
  throw new BackendError(offlineLooking({ message: error?.message ?? '' }) ? NO_SIGNAL : `${action}: ${error?.message ?? 'unknown error'}`);
}

/** Plain words for why the shelf turned a write down. */
export function rejectionReason(e: { code?: string; message: string }): string {
  if (e.code === '42501' || /row-level security|permission denied/i.test(e.message)) return REJECTED.permission;
  if (e.code === '23514') return REJECTED.range;
  if (e.code === '22P02') return REJECTED.unknownValue;
  if (e.code === '23503') return REJECTED.missing;
  return REJECTED.other(e.code ?? 'unknown');
}

/** Postgres gave up on the write because of another one at the same moment (a deadlock, or a
 *  serialization failure): nothing was wrong with it, so it waits and goes again like no signal. */
const TRY_AGAIN_CODES = new Set(['40P01', '40001']);

function writeFailure(error: { code?: string; message: string }): never {
  throw new BackendError(offlineLooking(error) || TRY_AGAIN_CODES.has(error.code ?? '') ? NO_SIGNAL : rejectionReason(error));
}

/** Plain words for why Storage turned a photo request down. */
type PhotoError = { message: string; name?: string; statusCode?: string };

function photoFailure(error: PhotoError): never {
  // storage-js gives every real server answer a statusCode; one without is a transport failure
  // (a timeout or "Load failed" arrive as a nameless StorageUnknownError), so try again later.
  if (!error.statusCode || offlineLooking(error)) throw new BackendError(NO_SIGNAL);
  if (error.statusCode === '403' || /row-level security|unauthorized/i.test(error.message)) throw new BackendError(REJECTED.permission);
  if (error.statusCode === '413' || /too large|maximum allowed size/i.test(error.message)) throw new BackendError(REJECTED.photoTooBig);
  throw new BackendError(REJECTED.other(`photo ${error.statusCode ?? 'unknown'}`));
}

/** What a Claude-backed call says differently from the default. */
type ClaudeCallOptions = {
  /** Said when the function failed or its answer can't be read (default CLAUDE_DOWN). Setting it also stops 429 being read as Discogs rate-limiting. */
  downMessage?: string;
  /** Looks at a failed answer first: a message to throw for it, or null to leave it to the usual handling. */
  onFailure?: (res: Response) => Promise<string | null>;
};

/** POSTs to a Claude-backed Edge Function and returns its JSON answer, mapping failures to plain words. */
async function callClaudeFunction<T>(client: SupabaseClient, name: string, body: unknown, timeoutMs: number, options: ClaudeCallOptions = {}): Promise<T> {
  const down = options.downMessage ?? CLAUDE_DOWN;
  const { data, error } = await client.auth.getSession();
  if (error) throw new BackendError(offlineLooking(error) ? NO_SIGNAL : error.message);
  if (!data.session) throw new BackendError(SIGN_IN_AGAIN);
  const { url, key } = readConfig(import.meta.env as Record<string, string | undefined>);
  let res: Response;
  try {
    res = await fetchWithTimeout(timeoutMs)(`${url}/functions/v1/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = e as Error;
    const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || err instanceof TypeError || (!abortedLooking(err) && offlineLooking(err));
    throw new BackendError(offline ? NO_SIGNAL : down);
  }
  if (res.status === 401) throw new BackendError(SIGN_IN_AGAIN);
  if (!res.ok) {
    const special = await options.onFailure?.(res);
    if (special) throw new BackendError(special);
  }
  if (res.status === 429 && options.downMessage === undefined) throw new BackendError(DISCOGS_MESSAGES.rateLimited);
  if (!res.ok) throw new BackendError(down);
  try {
    return (await res.json()) as T;
  } catch {
    throw new BackendError(down);
  }
}

export function supabaseBackend(client: SupabaseClient = supabase()): Backend {
  return {
    async currentUser(): Promise<SignedIn | null> {
      // An expired access token makes getSession() try to refresh; offline that fails with an
      // error even though the login is still stored. Don't mistake that for "signed out".
      const { data, error } = await client.auth.getSession();
      if (error) throw new BackendError(offlineLooking(error) ? NO_SIGNAL : error.message);
      const user = data.session?.user;
      return user ? { userId: user.id, email: user.email ?? '' } : null;
    },

    async sendCode(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) fail('Couldn’t send a code', error);
    },

    async verifyCode(email, code) {
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) {
        if (error.code === 'otp_expired' || /expired/i.test(error.message)) throw new BackendError('That code expired. Send a new one.');
        if (/fetch|network/i.test(error.message)) throw new BackendError(NO_SIGNAL);
        throw new BackendError('That code didn’t work. Check it, or send a new one.');
      }
      const user = data.user ?? data.session?.user;
      if (!user) throw new BackendError('Signed in, but no account came back. Try again.');
      return { userId: user.id, email: user.email ?? email };
    },

    async hasProfile(userId) {
      const { data, error } = await client.from('profiles').select('id').eq('id', userId).maybeSingle();
      if (error) fail('Couldn’t check your profile', error);
      return data !== null;
    },

    async bootstrap(displayName) {
      const { data, error } = await client.rpc('bootstrap', { p_display_name: displayName });
      if (error) fail('Couldn’t open your shelf', error);
      if (typeof data !== 'string') throw new BackendError('Couldn’t open your shelf: no shelf came back.');
      return data;
    },

    async recordsSince(shelfId, since) {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        let query = client.from('records').select('*').eq('shelf_id', shelfId);
        if (since) query = query.gt('updated_at', since);
        // A secondary sort on id breaks ties within the same updated_at instant, so paging never
        // skips or repeats a row when many records share a timestamp.
        const { data, error } = await query.order('updated_at').order('id').range(from, from + PAGE - 1);
        if (error) fail('Couldn’t fetch records', error);
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < PAGE) return rows;
      }
    },

    async ratings(shelfId) {
      // Paged like recordsSince: the hosted cap of 1000 rows per response would otherwise
      // silently truncate a shelf's ratings, and sync would read that as everything past row
      // 1000 having been deleted.
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client
          .from('ratings')
          .select('record_id, user_id, value, updated_at, records!inner(shelf_id)')
          .eq('records.shelf_id', shelfId)
          .order('record_id')
          .order('user_id')
          .range(from, from + PAGE - 1);
        if (error) fail('Couldn’t fetch ratings', error);
        rows.push(...(data as Record<string, unknown>[]).map(({ records: _shelf, ...rating }) => rating));
        if (data.length < PAGE) return rows;
      }
    },

    async sections(shelfId) {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client.from('sections').select('*').eq('shelf_id', shelfId).order('position').order('id').range(from, from + PAGE - 1);
        if (error) fail('Couldn’t fetch sections', error);
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < PAGE) return rows;
      }
    },

    async suggestions(shelfId) {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client.from('suggestions').select('*').eq('shelf_id', shelfId).order('created_at').order('id').range(from, from + PAGE - 1);
        if (error) fail('Couldn’t fetch suggestions', error);
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < PAGE) return rows;
      }
    },

    async members(shelfId): Promise<Member[]> {
      const { data, error } = await client.from('shelf_members').select('user_id, role, profiles(display_name)').eq('shelf_id', shelfId);
      if (error) fail('Couldn’t fetch who’s on the shelf', error);
      const rows = data as unknown as { user_id: string; role: 'owner' | 'member'; profiles: { display_name: string } | null }[];
      return rows.map((m) => ({ shelfId, userId: m.user_id, role: m.role, displayName: m.profiles?.display_name ?? 'Someone' }));
    },

    async invites(shelfId): Promise<Invite[]> {
      const { data, error } = await client.from('shelf_invites').select('email, accepted_at').eq('shelf_id', shelfId).order('created_at');
      if (error) fail('Couldn’t fetch invites', error);
      return (data as { email: string; accepted_at: string | null }[]).map((i) => ({ email: i.email, acceptedAt: i.accepted_at }));
    },

    async invite(shelfId, email, invitedBy) {
      const clean = email.trim().toLowerCase();
      const { error } = await client.from('shelf_invites').insert({ shelf_id: shelfId, email: clean, invited_by: invitedBy });
      if (error?.code === '23505') throw new BackendError('That email is already invited.');
      if (error) fail('Couldn’t send the invite', error);
    },

    async insertRecord(row) {
      const { error } = await client.from('records').insert(row);
      if (error?.code === '23505') return 'already-there';
      if (error) writeFailure(error);
      return 'inserted';
    },

    async patchRecord(id, fields) {
      const { data, error } = await client.from('records').update(fields).eq('id', id).select('id');
      if (error) writeFailure(error);
      return data.length > 0 ? 'patched' : 'missing';
    },

    async insertSection(row) {
      const { error } = await client.from('sections').insert(row);
      if (error?.code === '23505') return 'already-there';
      if (error) writeFailure(error);
      return 'inserted';
    },

    async patchSection(id, fields) {
      const { data, error } = await client.from('sections').update(fields).eq('id', id).select('id');
      if (error) writeFailure(error);
      return data.length > 0 ? 'patched' : 'missing';
    },

    async patchSuggestion(id, fields) {
      const { data, error } = await client.from('suggestions').update(fields).eq('id', id).select('id');
      if (error) writeFailure(error);
      return data.length > 0 ? 'patched' : 'missing';
    },

    async mergeSection(fromId, intoId) {
      const { error } = await client.rpc('merge_section', { p_from: fromId, p_into: intoId });
      if (!error) return;
      // A resend after the merge went through: the function can't find `from` any more, which is the
      // outcome we wanted (a `from` hidden by row-level security, e.g. after the person left the shelf, reads
      // the same way and also counts as done). If `from` is still there, something else was missing and that's a real refusal.
      if (/section not found/i.test(error.message)) {
        const { data, error: lookup } = await client.from('sections').select('id').eq('id', fromId).maybeSingle();
        if (lookup) writeFailure(lookup);
        if (data === null) return;
        throw new BackendError(REJECTED.sectionMissing);
      }
      writeFailure(error);
    },

    async setRating(recordId, userId, value) {
      // Never upsert: the column-level UPDATE grant on ratings makes ON CONFLICT DO UPDATE fail.
      // Update first; insert if there was nothing to update; if that loses a race, update again.
      const update = async () => {
        const { data, error } = await client.from('ratings').update({ value }).eq('record_id', recordId).eq('user_id', userId).select('record_id');
        if (error) writeFailure(error);
        return data.length > 0;
      };
      if (await update()) return;
      const { error } = await client.from('ratings').insert({ record_id: recordId, user_id: userId, value });
      if (!error) return;
      if (error.code !== '23505') writeFailure(error);
      if (!(await update())) throw new BackendError(REJECTED.missing);
    },

    async uploadPhoto(path, bytes) {
      const { error } = await client.storage.from(COVERS_BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (error) photoFailure(error as PhotoError);
    },

    async downloadPhoto(path) {
      const { data, error } = await client.storage.from(COVERS_BUCKET).download(path);
      if (error) {
        const e = error as PhotoError;
        if (e.statusCode === '404' || (e.statusCode === '400' && /not found/i.test(e.message))) return null;
        photoFailure(e);
      }
      return await data.arrayBuffer();
    },

    async deletePhoto(path) {
      const { error } = await client.storage.from(COVERS_BUCKET).remove([path]);
      if (error) photoFailure(error as PhotoError);
    },

    async searchDiscogs(query): Promise<FoundRecord[]> {
      const q = query.trim();
      if (q.length < 2 || q.length > MAX_QUERY) return [];
      const { data, error } = await client.auth.getSession();
      if (error) throw new BackendError(offlineLooking(error) ? NO_SIGNAL : error.message);
      if (!data.session) throw new BackendError('Sign in again to search.');
      const { url, key } = readConfig(import.meta.env as Record<string, string | undefined>);
      let res: Response;
      try {
        res = await fetchWithTimeout(DISCOGS_TIMEOUT_MS)(`${url}/functions/v1/discogs-search`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q }),
        });
      } catch (e) {
        // A timeout means Discogs (or the function) is slow, not that the phone lost signal:
        // only an offline phone or a failed connection (fetch rejects with a TypeError) is no signal.
        const err = e as Error;
        const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || err instanceof TypeError || (!abortedLooking(err) && offlineLooking(err));
        throw new BackendError(offline ? NO_SIGNAL : DISCOGS_MESSAGES.down);
      }
      if (res.status === 401) throw new BackendError('Sign in again to search.');
      if (res.status === 429) throw new BackendError(DISCOGS_MESSAGES.rateLimited);
      if (!res.ok) throw new BackendError(DISCOGS_MESSAGES.down);
      try {
        return ((await res.json()) as { results: FoundRecord[] }).results;
      } catch {
        throw new BackendError(DISCOGS_MESSAGES.down);
      }
    },

    async identifyRecord(front, back): Promise<Identified> {
      return callClaudeFunction<Identified>(client, 'identify-record', { front: base64(front), back: back ? base64(back) : null }, IDENTIFY_TIMEOUT_MS);
    },

    async findFunFact(r) {
      const out = await callClaudeFunction<{ fact: string | null; sourceUrl?: string }>(client, 'fun-fact', r, FUN_FACT_TIMEOUT_MS);
      return out.fact && out.sourceUrl ? { fact: out.fact, sourceUrl: out.sourceUrl } : null;
    },

    async suggestRecords() {
      const out = await callClaudeFunction<{ added: number }>(client, 'suggest-records', {}, SUGGEST_TIMEOUT_MS, {
        downMessage: SUGGEST_DOWN,
        onFailure: async (res) => {
          if (res.status !== 400) return null;
          const answer = (await res.json().catch(() => null)) as { error?: unknown } | null;
          return answer?.error === 'not-enough-ratings' ? NOT_ENOUGH_RATINGS : null;
        },
      });
      return { added: typeof out.added === 'number' ? out.added : 0 };
    },

    async signOut() {
      // This phone only: the default ('global') would sign the person out on every device.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) {
        // auth-js's own signOut() gives up on a session error (an expired token offline, say)
        // before it removes the stored session, so the next online open would silently sign the
        // person back in. Remove it ourselves so the local sign-out always sticks.
        try {
          localStorage.removeItem(AUTH_STORAGE_KEY);
        } catch {
          // Private browsing or no localStorage: nothing more we can do locally either way.
        }
        fail('Couldn’t sign out', error);
      }
    },
  };
}
