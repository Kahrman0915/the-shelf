// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/** Just enough of Supabase's auth schema and roles for our policies to run. Real Supabase provides these. */
const AUTH_STANDIN = `
  create schema auth;
  create table auth.users (id uuid primary key, email text not null, email_confirmed_at timestamptz);
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Mirror hosted Supabase's default privileges, so migrations that forget to lock
  -- new tables/functions down fail here the same way they would in production.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STANDIN);
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  return db;
}

export async function addUser(
  db: PGlite,
  email: string,
  options: { confirmed?: boolean } = {},
): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID();
  const confirmed = options.confirmed ?? true;
  await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)', [
    id, email, confirmed ? new Date() : null,
  ]);
  return { id, email };
}

/** Run fn as a signed-in person (or signed out, with null), the way PostgREST would. */
export async function asUser<T>(db: PGlite, user: { id: string; email: string } | null, fn: () => Promise<T>): Promise<T> {
  const claims = user ? JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' }) : '';
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
