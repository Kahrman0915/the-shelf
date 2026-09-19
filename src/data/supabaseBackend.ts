import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { BackendError, NO_SIGNAL, type Backend, type Invite, type Member, type SignedIn } from './backend';
import { supabase } from './supabase';

const PAGE = 1000;

function offlineLooking(error: { message: string }): boolean {
  return (typeof navigator !== 'undefined' && navigator.onLine === false) || isAuthRetryableFetchError(error) || /fetch|network/i.test(error.message);
}

function fail(action: string, error: { message: string; code?: string } | null): never {
  throw new BackendError(offlineLooking({ message: error?.message ?? '' }) ? NO_SIGNAL : `${action}: ${error?.message ?? 'unknown error'}`);
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
        const { data, error } = await query.order('updated_at').range(from, from + PAGE - 1);
        if (error) fail('Couldn’t fetch records', error);
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < PAGE) return rows;
      }
    },

    async ratings(shelfId) {
      const { data, error } = await client
        .from('ratings')
        .select('record_id, user_id, value, updated_at, records!inner(shelf_id)')
        .eq('records.shelf_id', shelfId);
      if (error) fail('Couldn’t fetch ratings', error);
      return (data as Record<string, unknown>[]).map(({ records: _shelf, ...rating }) => rating);
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

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) fail('Couldn’t sign out', error);
    },
  };
}
