/** The app doesn't email invites: the owner sends the link themselves. This is what they send. */
export function inviteMessage(email: string, url: string): string {
  return `I added you to my record shelf on The Shelf. Open ${url} and sign in with ${email}.`;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Opens the phone's share sheet with the invite message; where there is none, copies it instead. */
export async function shareInvite(email: string, url: string = window.location.origin): Promise<ShareResult> {
  const text = inviteMessage(email, url);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      // Closing the share sheet isn't a failure. Anything else falls through to copying.
      if ((e as { name?: unknown } | null)?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
