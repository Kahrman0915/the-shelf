// Reads a sleeve with Claude, then finds its record on Discogs. Runs on Supabase Edge Functions
// (Deno). The keys live only in the ANTHROPIC_API_KEY and DISCOGS_TOKEN function secrets. Photos and
// results are passed through, never stored or logged. verify_jwt = true in supabase/config.toml is
// the first layer, but the gateway also admits the public publishable key, so the function checks
// for a real signed-in user (auth.ts) before it spends anything. The logic lives in read.ts and
// match.ts, which Vitest tests; this file only wires them up.
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { signedInUser } from '../_shared/auth.ts';
import { searchDiscogsWith } from '../_shared/discogs.ts';
import { findMatch } from './match.ts';
import { isPhoto, readFromMessage, readRequest } from './read.ts';

/** Short of the app's 30 s limit, leaving room for the Discogs searches. */
const CLAUDE_TIMEOUT_MS = 20_000;

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method-not-allowed' });

  if (!supabase) {
    console.error(`identify-record: ${url ? 'SUPABASE_ANON_KEY' : 'SUPABASE_URL'} is not set`);
    return json(500, { error: 'not-configured' });
  }
  if (!client) {
    console.error('identify-record: ANTHROPIC_API_KEY is not set');
    return json(500, { error: 'not-configured' });
  }
  if ((await signedInUser(req.headers.get('Authorization'), getUser)) === null) {
    return json(401, { error: 'not-signed-in' });
  }

  let body: { front?: unknown; back?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // An unreadable body has no front photo; isPhoto(undefined) rejects it below.
  }
  const front = body?.front;
  const back = body?.back ?? null;
  if (!isPhoto(front) || (back !== null && !isPhoto(back))) return json(400, { error: 'bad-photos' });

  let message;
  try {
    message = await client.messages.create(
      // read.ts stays free of SDK types (Vitest can't load the SDK), so the request is typed here.
      readRequest(front, back) as Anthropic.MessageCreateParamsNonStreaming,
      { timeout: CLAUDE_TIMEOUT_MS, maxRetries: 0 },
    );
  } catch (e) {
    // The error's name and status only: never its message, which can echo the request.
    const { name, status } = (e ?? {}) as { name?: unknown; status?: unknown };
    console.error(`identify-record: Claude failed, ${typeof name === 'string' ? name : 'unknown error'} ${status ?? ''}`.trim());
    return json(502, { error: 'down' });
  }

  const read = readFromMessage(message);
  const { status, body: answer } = await findMatch(read, (p) => searchDiscogsWith(p, Deno.env.get('DISCOGS_TOKEN')));
  return json(status, answer);
});
