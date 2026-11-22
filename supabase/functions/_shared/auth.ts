// Who is calling? The gateway's verify_jwt also lets through the public publishable key, which ships
// in the app, so the function itself insists on a real signed-in user before spending the Discogs
// quota. Plain TypeScript, no Deno APIs, so Vitest can run it. Never logs the token.

/** The signed-in user's id, or null unless the header is `Bearer <jwt>` and getUser knows the jwt. */
export async function signedInUser(
  authHeader: string | null,
  getUser: (jwt: string) => Promise<{ id: string } | null>,
): Promise<string | null> {
  const match = /^Bearer (\S+)$/.exec(authHeader ?? '');
  if (!match) return null;
  try {
    const user = await getUser(match[1]);
    return user?.id ?? null;
  } catch {
    return null;
  }
}
