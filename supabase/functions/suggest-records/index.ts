// Asks Claude for records the shelf's members might like, checks each against Discogs, and saves the
// kept ones as suggestions. Runs on Supabase Edge Functions (Deno). The key lives only in the
// ANTHROPIC_API_KEY and DISCOGS_TOKEN function secrets. verify_jwt = true in supabase/config.toml is
// the first layer, but the gateway also admits the public publishable key, so the function checks
// for a real signed-in user (auth.ts) before it spends anything. The shelf is read with the caller's
// own sign-in, so RLS applies. The logic lives in taste.ts and check.ts, which Vitest tests; this
// file only wires them up. Logs name only status codes and error names.
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { signedInUser } from '../_shared/auth.ts';
import { searchDiscogsWith } from '../_shared/discogs.ts';
import { readAll } from '../_shared/pages.ts';
import { checkProposals, keyOf } from './check.ts';
import { claudeTimeoutMs, startBudget } from './deadline.ts';
import { MIN_RATED, proposalsFromMessage, ratedCount, suggestRequest, type Taste } from './taste.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** SUPABASE_ANON_KEY, else the first of SUPABASE_PUBLISHABLE_KEYS (a JSON array or object of keys,
 *  or a bare key), else undefined. */
function publicKey(): string | undefined {
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (anon) return anon;
  const raw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')?.trim();
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    const first = Array.isArray(parsed)
      ? parsed[0]
      : parsed && typeof parsed === 'object' ? Object.values(parsed)[0] : parsed;
    return typeof first === 'string' && first ? first : undefined;
  } catch {
    return raw;
  }
}

const url = Deno.env.get('SUPABASE_URL');
const key = publicKey();
const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
const client = apiKey ? new Anthropic({ apiKey }) : null;

const getUser = async (jwt: string) => {
  const { data } = await supabase!.auth.getUser(jwt);
  return data.user;
};

/** The error's name and status only: never its message, which can echo the request. */
const describe = (e: unknown): string => {
  const { name, status } = (e ?? {}) as { name?: unknown; status?: unknown };
  return `${typeof name === 'string' ? name : 'unknown error'} ${status ?? ''}`.trim();
};

type Row = Record<string, any>;

Deno.serve(async (req) => {
  // The app's 60 s covers everything: the whole answer has 50 s from here (deadline.ts).
  const msLeft = startBudget();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method-not-allowed' });

  if (!supabase) {
    console.error(`suggest-records: ${url ? 'SUPABASE_ANON_KEY' : 'SUPABASE_URL'} is not set`);
    return json(500, { error: 'not-configured' });
  }
  if (!client) {
    console.error('suggest-records: ANTHROPIC_API_KEY is not set');
    return json(500, { error: 'not-configured' });
  }
  const authHeader = req.headers.get('Authorization');
  const userId = await signedInUser(authHeader, getUser);
  if (userId === null) return json(401, { error: 'not-signed-in' });

  // The caller's own sign-in, so row-level security decides what is visible and writable.
  const db = createClient(url!, key!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader! } },
  });

  // Gather the shelf.
  const mine = await db.from('shelf_members').select('shelf_id').eq('user_id', userId).limit(1).maybeSingle();
  const shelfId: string | undefined = mine.data?.shelf_id;
  if (mine.error || !shelfId) {
    console.error(`suggest-records: no shelf ${mine.error?.code ?? ''}`.trim());
    return json(500, { error: 'no-shelf' });
  }
  const [members, records, ratings, suggestions] = await Promise.all([
    db.from('shelf_members').select('user_id, profiles(display_name)').eq('shelf_id', shelfId),
    // Paged: PostgREST caps a response at 1000 rows, and a truncated read would let owned albums be suggested.
    readAll<Row>((from, to) =>
      db.from('records').select('id, artist, title, year, status, sections(name)').eq('shelf_id', shelfId).is('deleted_at', null)
        .order('id').range(from, to)),
    readAll<Row>((from, to) =>
      db.from('ratings').select('record_id, user_id, value, records!inner(shelf_id)').eq('records.shelf_id', shelfId)
        .order('record_id').order('user_id').range(from, to)),
    readAll<Row>((from, to) =>
      db.from('suggestions').select('id, artist, title, status').eq('shelf_id', shelfId).order('id').range(from, to)),
  ]);
  const failed = [members, records, ratings, suggestions].find((r) => r.error);
  if (failed) {
    console.error(`suggest-records: read failed ${failed.error?.code ?? ''}`.trim());
    return json(500, { error: 'read-failed' });
  }

  const byRecord = new Map<string, { userId: string; value: number }[]>();
  for (const r of ratings.data as Row[]) {
    const list = byRecord.get(r.record_id) ?? [];
    list.push({ userId: r.user_id, value: r.value });
    byRecord.set(r.record_id, list);
  }
  const taste: Taste = {
    members: (members.data as Row[]).map((m) => ({ userId: m.user_id, name: m.profiles?.display_name ?? 'Someone' })),
    records: records.data!.map((r) => ({
      artist: r.artist,
      title: r.title,
      year: r.year ?? null,
      section: r.sections?.name ?? '',
      status: r.status,
      ratings: byRecord.get(r.id) ?? [],
    })),
    suggested: suggestions.data!.map((s) => ({ artist: s.artist, title: s.title, status: s.status })),
  };
  if (ratedCount(taste) < MIN_RATED) return json(400, { error: 'not-enough-ratings' });

  // Ask Claude.
  const claudeMs = claudeTimeoutMs(msLeft());
  if (claudeMs <= 0) {
    console.error('suggest-records: out of time');
    return json(502, { error: 'down' });
  }
  let message;
  try {
    // `betas` and `fallbacks` are beta parameters. taste.ts stays free of SDK types (Vitest can't
    // load the SDK), so the request is cast here.
    message = await client.beta.messages.create(suggestRequest(taste) as never, { timeout: claudeMs, maxRetries: 0 });
  } catch (e) {
    console.error(`suggest-records: Claude failed, ${describe(e)}`);
    return json(502, { error: 'down' });
  }
  // A cut-off answer (max_tokens, say) reads as nothing; the stop reason's name says why.
  if (message.stop_reason !== 'end_turn' && message.stop_reason !== 'refusal') {
    console.error(`suggest-records: stop ${message.stop_reason}`);
  }

  // Check against the shelf and Discogs.
  const taken = new Set([...taste.records, ...taste.suggested].map((r) => keyOf(r.artist, r.title)));
  const token = Deno.env.get('DISCOGS_TOKEN');
  const kept = await checkProposals(
    proposalsFromMessage(message),
    taken,
    (p, ms) => searchDiscogsWith(p, token, fetch, ms),
    msLeft,
  );

  if (kept.length > 0) {
    const roundAt = new Date().toISOString();
    const { error } = await db.from('suggestions').insert(
      kept.map((k) => ({
        shelf_id: shelfId,
        artist: k.artist,
        title: k.title,
        reason: k.reason,
        discogs_release_id: k.discogsReleaseId,
        discogs_genres: k.discogsGenres,
        discogs_styles: k.discogsStyles,
        round_at: roundAt,
      })),
    );
    if (error) {
      console.error(`suggest-records: insert failed ${error.code ?? ''}`.trim());
      return json(502, { error: 'down' });
    }
  }
  return json(200, { added: kept.length });
});
