// Discogs record lookup. Runs on Supabase Edge Functions (Deno). The Discogs token lives only in the
// DISCOGS_TOKEN function secret. Results are passed through, never stored. verify_jwt = true in
// supabase/config.toml is the first layer, but the gateway also admits the public publishable key,
// so the function checks for a real signed-in user (auth.ts) before it asks Discogs anything.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { signedInUser } from '../_shared/auth.ts';
import { askDiscogs } from '../_shared/discogs.ts';
import { cleanQuery } from '../_shared/shape.ts';

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

const getUser = async (jwt: string) => {
  const { data } = await supabase!.auth.getUser(jwt);
  return data.user;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method-not-allowed' });

  if (!supabase) {
    console.error(`discogs-search: ${url ? 'SUPABASE_ANON_KEY' : 'SUPABASE_URL'} is not set`);
    return json(500, { error: 'not-configured' });
  }
  if ((await signedInUser(req.headers.get('Authorization'), getUser)) === null) {
    return json(401, { error: 'not-signed-in' });
  }

  let body: { query?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // An unreadable body has no query; cleanQuery(undefined) rejects it below.
  }
  const query = cleanQuery(body?.query);
  if (query === null) return json(400, { error: 'bad-query' });

  const { status, body: answer } = await askDiscogs(query, Deno.env.get('DISCOGS_TOKEN'));
  return json(status, answer);
});
