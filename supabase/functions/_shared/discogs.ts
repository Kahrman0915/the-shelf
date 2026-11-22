// The Discogs request shared by the discogs-search and identify-record Edge Functions. Web-standard
// fetch only, no Deno APIs, so the same file runs under Deno and under Vitest.
import { shapeResults } from './shape.ts';

const USER_AGENT = 'TheShelf/1.0 +https://the-shelf-sigma.vercel.app';

/** Short of the app's 20 s limit, so the app hears a 502 rather than giving up on us. */
export const DISCOGS_TIMEOUT_MS = 15_000;

export type Answer = { status: number; body: unknown };

const DOWN: Answer = { status: 502, body: { error: 'discogs-down' } };

/** Search Discogs releases with the given params (plus type=release and per_page=6) and turn its
 *  answer into the function's. Logs say only what went wrong (a status or an error's name): never
 *  the URL, the headers or the token. */
export async function searchDiscogsWith(
  params: Record<string, string>,
  token: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<Answer> {
  if (!token) {
    console.error('discogs: DISCOGS_TOKEN is not set');
    return DOWN;
  }
  try {
    const given = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const url = `https://api.discogs.com/database/search?${given}&type=release&per_page=6`;
    const res = await fetchFn(url, {
      headers: { Authorization: `Discogs token=${token}`, 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(DISCOGS_TIMEOUT_MS),
    });
    if (res.status === 429) return { status: 429, body: { error: 'rate-limited' } };
    if (!res.ok) {
      console.error(`discogs: Discogs answered ${res.status}`);
      return DOWN;
    }
    return { status: 200, body: { results: shapeResults(await res.json()) } };
  } catch (e) {
    // By name, not instanceof Error: a DOMException (a timeout) isn't an Error everywhere.
    const name = (e as { name?: unknown } | null)?.name;
    console.error(`discogs: ${typeof name === 'string' ? name : 'unknown error'}`);
    return DOWN;
  }
}

/** The text search: vinyl releases matching a free-text query. */
export const askDiscogs = (query: string, token: string | undefined, fetchFn: typeof fetch = fetch): Promise<Answer> =>
  searchDiscogsWith({ q: query, format: 'Vinyl' }, token, fetchFn);
