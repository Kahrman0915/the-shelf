/** Everything the app needs from the server. Screens use this, never Supabase directly. */
export type SignedIn = { userId: string; email: string };
export type Member = { shelfId: string; userId: string; role: 'owner' | 'member'; displayName: string };
export type Invite = { email: string; acceptedAt: string | null };

export interface ShelfSource {
  /** Raw record rows for a shelf, only those changed after `since` (all of them when null), oldest change first. */
  recordsSince(shelfId: string, since: string | null): Promise<Record<string, unknown>[]>;
  /** Every rating on the shelf, as raw rows. */
  ratings(shelfId: string): Promise<Record<string, unknown>[]>;
  members(shelfId: string): Promise<Member[]>;
}

export interface Backend extends ShelfSource {
  currentUser(): Promise<SignedIn | null>;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<SignedIn>;
  hasProfile(userId: string): Promise<boolean>;
  /** Sets the signed-in person up (see the bootstrap() migration) and returns their shelf id. */
  bootstrap(displayName: string | null): Promise<string>;
  invites(shelfId: string): Promise<Invite[]>;
  invite(shelfId: string, email: string, invitedBy: string): Promise<void>;
  signOut(): Promise<void>;
}

/** A failure worth showing to the person holding the phone; the message says what to do. */
export class BackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendError';
  }
}

export const NO_SIGNAL = 'No signal. Try again when you’re back online.';
