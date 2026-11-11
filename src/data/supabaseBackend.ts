import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { BackendError, NO_SIGNAL, REJECTED, type Backend, type Invite, type Member, type SignedIn } from './backend';
import { AUTH_STORAGE_KEY, supabase } from './supabase';

const PAGE = 1000;

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

function writeFailure(error: { code?: string; message: string }): never {
  throw new BackendError(offlineLooking(error) ? NO_SIGNAL : rejectionReason(error));
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
