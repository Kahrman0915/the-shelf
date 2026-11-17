// Discogs record lookup. Runs on Supabase Edge Functions (Deno). The Discogs token lives only in the
// DISCOGS_TOKEN function secret. Results are passed through, never stored. verify_jwt = true in
// supabase/config.toml makes the gateway insist on a signed-in caller.
import { askDiscogs } from './discogs.ts';
import { cleanQuery } from './shape.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method-not-allowed' });

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
