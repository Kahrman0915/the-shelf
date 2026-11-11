import type { NewRecordRow, RecordPatchRow } from './rowMapping';

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

/** Writes. A BackendError whose message is NO_SIGNAL means "try later"; any other BackendError message is a plain-words rejection reason. */
export interface ShelfWriter {
  insertRecord(row: NewRecordRow): Promise<'inserted' | 'already-there'>;
  patchRecord(id: string, fields: RecordPatchRow): Promise<'patched' | 'missing'>;
  setRating(recordId: string, userId: string, value: number): Promise<void>;
}

export interface Backend extends ShelfSource, ShelfWriter {
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

export const REJECTED = {
  missing: 'That record is no longer on your shelf.',
  permission: 'You don’t have permission to change this record.',
  range: 'The shelf refused a value that’s out of range.',
  unknownValue: 'The shelf refused a value it doesn’t recognise.',
  other: (code: string) => `The shelf refused this change. (${code})`,
  /** Set on the phone, not by the shelf: a waiting change no longer fits the record after a pull. */
  noLongerFits: 'This change doesn’t fit the record any more.',
};
