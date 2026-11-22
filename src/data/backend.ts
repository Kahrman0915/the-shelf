import type { FoundRecord, Identified } from '../../supabase/functions/_shared/shape';
import type { NewRecordRow, NewSectionRow, RecordPatchRow, SectionPatchRow } from './rowMapping';

export type { FoundRecord, Identified, Read } from '../../supabase/functions/_shared/shape';

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
  /** Every section on the shelf, as raw rows. */
  sections(shelfId: string): Promise<Record<string, unknown>[]>;
}

/** Writes. A BackendError whose message is NO_SIGNAL means "try later"; any other BackendError message is a plain-words rejection reason. */
export interface ShelfWriter {
  insertRecord(row: NewRecordRow): Promise<'inserted' | 'already-there'>;
  patchRecord(id: string, fields: RecordPatchRow): Promise<'patched' | 'missing'>;
  /** One section per request: the server's claim trigger checks one row at a time. */
  insertSection(row: NewSectionRow): Promise<'inserted' | 'already-there'>;
  patchSection(id: string, fields: SectionPatchRow): Promise<'patched' | 'missing'>;
  /** Moves every record from one section into another, hands over its genres and holiday, removes it. A `from` that's already gone counts as done (a resend). */
  mergeSection(fromId: string, intoId: string): Promise<void>;
  setRating(recordId: string, userId: string, value: number): Promise<void>;
  /** Stores a JPEG in the covers bucket at `path`. Overwrites, so it's safe to repeat. */
  uploadPhoto(path: string, bytes: ArrayBuffer): Promise<void>;
  /** Removes the photo at `path`. Deleting a missing file is not an error. */
  deletePhoto(path: string): Promise<void>;
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
  /** Looks a record up on Discogs. Resolves [] for a query under 2 characters without calling the server. Results are never stored. */
  searchDiscogs(query: string): Promise<FoundRecord[]>;
  /** Has Claude read a sleeve (front, and the back when there is one) and look it up on Discogs. Photos are sent, never stored. */
  identifyRecord(front: ArrayBuffer, back: ArrayBuffer | null): Promise<Identified>;
  /** A sourced fun fact about a record, or null when none was found or the answer came without a source. */
  findFunFact(r: { artist: string; title: string; year: number | null; label: string | null }): Promise<{ fact: string; sourceUrl: string } | null>;
  /** The photo's bytes, or null when it isn't there (yet). Throws BackendError(NO_SIGNAL) offline. */
  downloadPhoto(path: string): Promise<ArrayBuffer | null>;
}

/** A failure worth showing to the person holding the phone; the message says what to do. */
export class BackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendError';
  }
}

/** The private Storage bucket holding record photos. Not part of a photo's path. */
export const COVERS_BUCKET = 'covers';

export const NO_SIGNAL = 'No signal. Try again when you’re back online.';

/** The shelf's sections aren't on the phone yet (a fresh phone before its first sync). */
export const SHELF_LOADING = 'Your shelf is still loading. Try again in a moment.';

/** Plain words for why a Discogs lookup failed (other than having no signal). */
export const DISCOGS_MESSAGES = {
  rateLimited: 'Too many searches at once. Wait a minute and try again.',
  down: 'Discogs isn’t responding. Try again, or fill it in by hand.',
};

/** Shown when Claude couldn't read the sleeve or find a fact (other than having no signal). */
export const CLAUDE_DOWN = 'Couldn’t read the sleeve. Try again, or search below.';

export const REJECTED = {
  missing: 'That record is no longer on your shelf.',
  sectionMissing: 'That section is no longer on your shelf.',
  permission: 'You don’t have permission to change this record.',
  range: 'The shelf refused a value that’s out of range.',
  unknownValue: 'The shelf refused a value it doesn’t recognise.',
  other: (code: string) => `The shelf refused this change. (${code})`,
  /** Set on the phone, not by the shelf: a waiting change no longer fits the record after a pull. */
  noLongerFits: 'This change doesn’t fit the record any more.',
  photoGone: 'That photo is no longer on this phone.',
  photoTooBig: 'That photo is too big for the shelf.',
};
