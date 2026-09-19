// One-time: copy collection.json onto a person's shelf in Supabase, with their ratings.
// Safe to re-run: records already on the shelf (same import key) are skipped, ratings are only added if missing.
// Usage: npm run import:collection -- you@example.com
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { importCollection } from '../src/data/importCollection';
import { ratingToRow, recordToRow } from '../src/data/rowMapping';

function stop(message: string): never {
  console.error(`Import stopped.\n${message}`);
  process.exit(1);
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email) stop('Say whose shelf: npm run import:collection -- you@example.com');

const url = process.env.VITE_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) stop('Missing VITE_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local.');

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

// 1. Who is it?
let userId: string | undefined;
for (let page = 1; userId === undefined; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) stop(`Couldn't list accounts: ${error.message}`);
  userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
  if (data.users.length < 200) break;
}
if (!userId) stop(`No one has signed in as ${email} yet. Sign in on your phone first, then run this again.`);

// 2. Which shelf do they own?
const { data: owned, error: shelfError } = await admin.from('shelf_members').select('shelf_id').eq('user_id', userId).eq('role', 'owner');
if (shelfError) stop(`Couldn't find the shelf: ${shelfError.message}`);
if (!owned || owned.length !== 1) stop(`Expected ${email} to own exactly one shelf, found ${owned?.length ?? 0}.`);
const shelfId = owned[0].shelf_id as string;

// 3. Check the whole file before touching anything.
const json: unknown = JSON.parse(readFileSync(new URL('../collection.json', import.meta.url), 'utf8'));
let prepared: ReturnType<typeof importCollection>;
try {
  prepared = importCollection(json, { shelfId, userId, newId: () => crypto.randomUUID() });
} catch (e) {
  stop(`Nothing was saved.\n${e instanceof Error ? e.message : String(e)}`);
}

// 4. Add the records that aren't there yet.
const { data: existing, error: existingError } = await admin.from('records').select('id, import_key').eq('shelf_id', shelfId).not('import_key', 'is', null);
if (existingError) stop(`Couldn't read the shelf: ${existingError.message}`);
const serverIdByKey = new Map(existing.map((r) => [r.import_key as string, r.id as string]));
const newRecords = prepared.records.filter((r) => r.importKey !== null && !serverIdByKey.has(r.importKey));
if (newRecords.length > 0) {
  const { error } = await admin.from('records').insert(newRecords.map(recordToRow));
  if (error) stop(`Nothing was saved: ${error.message}`);
  for (const r of newRecords) serverIdByKey.set(r.importKey as string, r.id);
}

// 5. Add ratings that are missing, matched by import key so re-runs repair a half-finished import.
const keyByLocalId = new Map(prepared.records.map((r) => [r.id, r.importKey as string]));
const ratingRows = prepared.ratings.map((r) => ({ ...r, recordId: serverIdByKey.get(keyByLocalId.get(r.recordId)!)! })).map(ratingToRow);
if (ratingRows.length > 0) {
  const { error } = await admin.from('ratings').upsert(ratingRows, { onConflict: 'record_id,user_id', ignoreDuplicates: true });
  if (error) stop(`The ${newRecords.length} records were added, but ratings failed: ${error.message}\nRun the same command again to finish.`);
}

console.log(`Done. ${newRecords.length} records added (${prepared.records.length - newRecords.length} were already there). Ratings checked: ${ratingRows.length}.`);
