import collection from '../../collection.json';
import { BackendError, NO_SIGNAL, type Backend, type Invite, type Member, type SignedIn } from '@/data/backend';
import { importCollection } from '@/data/importCollection';
import { ratingToRow, recordToRow, type RatingRow, type RecordRow } from '@/data/rowMapping';

type Options = {
  users?: Record<string, string>;
  profiles?: Record<string, string>;
  shelfFor?: Record<string, string>;
  records?: RecordRow[];
  ratings?: RatingRow[];
  members?: Member[];
  signedIn?: SignedIn | null;
};

/** An in-memory stand-in for Supabase. The only code that works is 123456. */
export class FakeBackend implements Backend {
  online = true;
  /** Simulates a stored login whose access token expired and can't refresh offline (see currentUser()). */
  sessionNeedsRefresh = false;
  signedIn: SignedIn | null;
  sentCodesTo: string[] = [];
  private users: Record<string, string>;
  private profiles: Record<string, string>;
  private shelfFor: Record<string, string>;
  private recordRows: RecordRow[];
  private ratingRows: RatingRow[];
  private memberList: Member[];
  private inviteList: (Invite & { shelfId: string })[] = [];

  constructor(o: Options) {
    this.users = { ...o.users };
    this.profiles = { ...o.profiles };
    this.shelfFor = { ...o.shelfFor };
    this.recordRows = [...(o.records ?? [])];
    this.ratingRows = [...(o.ratings ?? [])];
    this.memberList = [...(o.members ?? [])];
    this.signedIn = o.signedIn ?? null;
  }

  private guard() {
    if (!this.online) throw new BackendError(NO_SIGNAL);
  }

  async currentUser() {
    if (!this.online && this.sessionNeedsRefresh) throw new BackendError(NO_SIGNAL);
    return this.signedIn;
  }

  async sendCode(email: string) {
    this.guard();
    this.sentCodesTo.push(email);
  }

  async verifyCode(email: string, code: string) {
    this.guard();
    if (code !== '123456') throw new BackendError('That code didn’t work. Check it, or send a new one.');
    const userId = this.users[email] ?? crypto.randomUUID();
    this.users[email] = userId;
    this.signedIn = { userId, email };
    return this.signedIn;
  }

  async hasProfile(userId: string) {
    this.guard();
    return userId in this.profiles;
  }

  async bootstrap(displayName: string | null) {
    this.guard();
    const me = this.signedIn;
    if (!me) throw new BackendError('Not signed in');
    this.profiles[me.userId] = displayName ?? this.profiles[me.userId] ?? me.email.split('@')[0];
    let shelf = this.shelfFor[me.userId];
    if (!shelf) {
      shelf = crypto.randomUUID();
      this.shelfFor[me.userId] = shelf;
    }
    const mine = this.memberList.find((m) => m.shelfId === shelf && m.userId === me.userId);
    if (mine) mine.displayName = this.profiles[me.userId];
    else this.memberList.push({ shelfId: shelf, userId: me.userId, role: 'owner', displayName: this.profiles[me.userId] });
    return shelf;
  }

  async recordsSince(shelfId: string, since: string | null) {
    this.guard();
    return this.recordRows
      .filter((r) => r.shelf_id === shelfId && (since === null || r.updated_at > since))
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at)) as unknown as Record<string, unknown>[];
  }

  async ratings(shelfId: string) {
    this.guard();
    const ids = new Set(this.recordRows.filter((r) => r.shelf_id === shelfId).map((r) => r.id));
    return this.ratingRows.filter((r) => ids.has(r.record_id)) as unknown as Record<string, unknown>[];
  }

  async members(shelfId: string) {
    this.guard();
    return this.memberList.filter((m) => m.shelfId === shelfId).map((m) => ({ ...m }));
  }

  async invites(shelfId: string) {
    this.guard();
    return this.inviteList.filter((i) => i.shelfId === shelfId).map(({ email, acceptedAt }) => ({ email, acceptedAt }));
  }

  async invite(shelfId: string, email: string, _invitedBy: string) {
    this.guard();
    const clean = email.trim().toLowerCase();
    if (this.inviteList.some((i) => i.shelfId === shelfId && i.email === clean)) throw new BackendError('That email is already invited.');
    this.inviteList.push({ shelfId, email: clean, acceptedAt: null });
  }

  async signOut() {
    // Local sign-out happens even offline (mirrors supabaseBackend.signOut(), which removes the
    // stored login itself before throwing): the phone forgets who's signed in whether or not the
    // server heard about it.
    this.signedIn = null;
    this.guard();
  }

  /** Test helper: change a record on the "server" as if another phone had. */
  touchRecord(id: string, change: Partial<RecordRow>) {
    const row = this.recordRows.find((r) => r.id === id);
    if (!row) throw new Error(`No record ${id}`);
    Object.assign(row, change, { updated_at: new Date().toISOString() });
  }

  /** Test helper: remove a rating on the "server". */
  dropRating(recordId: string, userId: string) {
    this.ratingRows = this.ratingRows.filter((r) => !(r.record_id === recordId && r.user_id === userId));
  }
}

export function collectionRows(shelfId: string, userId: string): { records: RecordRow[]; ratings: RatingRow[] } {
  const { records, ratings } = importCollection(collection, { shelfId, userId, newId: () => crypto.randomUUID() });
  return { records: records.map(recordToRow), ratings: ratings.map(ratingToRow) };
}
