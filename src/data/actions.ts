import type { GenreKey } from '@/domain/genres';
import type { Grade } from '@/domain/grades';
import { BackendError } from './backend';
import type { ShelfDB } from './db';
import { savePostcards, type NewPostcard } from './outbox';
import { RecordSchema, type ShelfRecord } from './schema';

/** What an action needs from outside: who is acting and when. Actions never read a clock or make ids. */
export type Ctx = { me: string; now: string };
export type ActionResult = { postcards: NewPostcard[]; undo: NewPostcard[] | null };
export type NewBuy = { artist: string; title: string; genre: GenreKey; grade: Grade; pricePaid: number | null };

/** The fields the Add and Edit form shows, in form order. */
export const FORM_FIELDS = [
  'artist',
  'title',
  'genre',
  'discGrade',
  'sleeveGrade',
  'label',
  'catalog',
  'year',
  'format',
  'notes',
  'funFact',
  'funFactSource',
  'nmEstimateLow',
  'nmEstimateHigh',
  'valueNote',
  'pricePaid',
] as const;
export type RecordFields = Pick<ShelfRecord, (typeof FORM_FIELDS)[number]>;

/** Which kind of "Bought it" applies to this record, if any. */
export function buyKind(r: ShelfRecord): 'want' | 'upgrade' | null {
  if (r.status === 'wanted') return 'want';
  if (r.status === 'owned' && r.wantsUpgrade) return 'upgrade';
  return null;
}

function patchCard(r: ShelfRecord, ctx: Ctx, fields: Partial<ShelfRecord>): NewPostcard {
  return { kind: 'record.patch', shelfId: r.shelfId, recordId: r.id, userId: ctx.me, createdAt: ctx.now, fields };
}

/** Check a whole record against the record rules; throw naming the first broken field. */
function checkRecord(candidate: ShelfRecord): ShelfRecord {
  const parsed = RecordSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BackendError(`Record rules broken: ${issue.path.join('.') || 'record'} ${issue.message}`);
  }
  return parsed.data;
}

export function boughtIt(r: ShelfRecord, input: { grade: Grade; pricePaid: number | null }, ctx: Ctx): ActionResult {
  const kind = buyKind(r);
  if (!kind) throw new BackendError('Bought it is only for records on the want list or marked for an upgrade.');
  if (kind === 'want') {
    return {
      postcards: [patchCard(r, ctx, { status: 'new_arrival', boughtAt: ctx.now, discGrade: input.grade, pricePaid: input.pricePaid })],
      undo: [patchCard(r, ctx, { status: 'wanted', boughtAt: r.boughtAt, discGrade: r.discGrade, pricePaid: r.pricePaid })],
    };
  }
  return {
    postcards: [
      patchCard(r, ctx, {
        discGrade: input.grade,
        sleeveGrade: null,
        pricePaid: input.pricePaid,
        boughtAt: ctx.now,
        wantsUpgrade: false,
        upgradeNote: null,
      }),
    ],
    undo: [
      patchCard(r, ctx, {
        discGrade: r.discGrade,
        sleeveGrade: r.sleeveGrade,
        pricePaid: r.pricePaid,
        boughtAt: r.boughtAt,
        wantsUpgrade: r.wantsUpgrade,
        upgradeNote: r.upgradeNote,
      }),
    ],
  };
}

export function boughtNew(input: NewBuy, ctx: Ctx & { shelfId: string; newId: string }): ActionResult {
  const candidate: ShelfRecord = {
    id: ctx.newId,
    shelfId: ctx.shelfId,
    status: 'new_arrival',
    wantsUpgrade: false,
    upgradeNote: null,
    artist: input.artist.trim(),
    title: input.title.trim(),
    label: null,
    catalog: null,
    year: null,
    format: null,
    genre: input.genre,
    discGrade: input.grade,
    sleeveGrade: null,
    pricePaid: input.pricePaid,
    nmEstimateLow: null,
    nmEstimateHigh: null,
    valueNote: null,
    notes: null,
    discogsReleaseId: null,
    coverPath: null,
    funFact: null,
    funFactSource: null,
    coverImageUrl: null,
    boughtAt: ctx.now,
    addedBy: ctx.me,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
    importKey: null,
  };
  const checked = checkRecord(candidate);
  const base = { shelfId: ctx.shelfId, recordId: ctx.newId, userId: ctx.me, createdAt: ctx.now };
  return {
    postcards: [{ ...base, kind: 'record.create', fields: checked }],
    undo: [{ ...base, kind: 'record.patch', fields: { deletedAt: ctx.now } }],
  };
}

/** A record added by hand: owned, added by you, with an optional rating in the same batch. */
export function addRecord(fields: RecordFields, rating: number | null, ctx: Ctx & { shelfId: string; newId: string }): ActionResult {
  const checked = checkRecord({
    ...fields,
    id: ctx.newId,
    shelfId: ctx.shelfId,
    status: 'owned',
    wantsUpgrade: false,
    upgradeNote: null,
    discogsReleaseId: null,
    coverPath: null,
    coverImageUrl: null,
    boughtAt: null,
    importKey: null,
    addedBy: ctx.me,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
  });
  const base = { shelfId: ctx.shelfId, recordId: ctx.newId, userId: ctx.me, createdAt: ctx.now };
  const postcards: NewPostcard[] = [{ ...base, kind: 'record.create', fields: checked }];
  if (rating !== null) postcards.push({ ...base, kind: 'rating.set', fields: { value: rating } });
  return { postcards, undo: null };
}

/** Fields the record rules check together: if either half changed, both are sent, so a change from another phone
 *  to the other half can't leave the record broken (low above high, or a source with no fun fact). */
const PAIRS = [
  ['nmEstimateLow', 'nmEstimateHigh'],
  ['funFact', 'funFactSource'],
] as const satisfies readonly (readonly [keyof RecordFields, keyof RecordFields])[];

/** The form fields whose value in `edited` differs (by ===) from the value the form opened with, pairs whole. */
export function changedFields(opened: RecordFields, edited: RecordFields): Partial<RecordFields> {
  const changed: Partial<Record<keyof RecordFields, unknown>> = {};
  for (const key of FORM_FIELDS) if (edited[key] !== opened[key]) changed[key] = edited[key];
  for (const [a, b] of PAIRS) {
    if (a in changed || b in changed) {
      changed[a] = edited[a];
      changed[b] = edited[b];
    }
  }
  return changed as Partial<RecordFields>;
}

/** Send only the fields changed since the form opened, so someone else's change to another field survives. */
export function editRecord(record: ShelfRecord, opened: RecordFields, edited: RecordFields, ctx: Ctx): ActionResult {
  const changed = changedFields(opened, edited);
  if (Object.keys(changed).length === 0) return { postcards: [], undo: null };
  checkRecord({ ...record, ...changed });
  return { postcards: [patchCard(record, ctx, changed)], undo: null };
}

/** Delete any record, whatever its status. Undo clears the mark, so it works after the delete reached the server. */
export function deleteRecord(record: ShelfRecord, ctx: Ctx): ActionResult {
  return { postcards: [patchCard(record, ctx, { deletedAt: ctx.now })], undo: [patchCard(record, ctx, { deletedAt: null })] };
}

/** Bring back a record deleted on another phone, with this phone's edits, in one patch. */
export function restoreWithEdits(record: ShelfRecord, opened: RecordFields, edited: RecordFields, ctx: Ctx): ActionResult {
  const fields: Partial<ShelfRecord> = { deletedAt: null, ...changedFields(opened, edited) };
  checkRecord({ ...record, ...fields });
  return { postcards: [patchCard(record, ctx, fields)], undo: null };
}

export function didntBuyIt(r: ShelfRecord, ctx: Ctx): ActionResult {
  if (r.status !== 'new_arrival') throw new BackendError('Only new arrivals can be removed this way.');
  return { postcards: [patchCard(r, ctx, { deletedAt: ctx.now })], undo: null };
}

export function rate(r: ShelfRecord, value: number, ctx: Ctx): ActionResult {
  if (r.status === 'wanted') throw new BackendError('You can rate records you’ve bought.');
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new BackendError('A rating is 1 to 5.');
  return {
    postcards: [{ kind: 'rating.set', shelfId: r.shelfId, recordId: r.id, userId: ctx.me, createdAt: ctx.now, fields: { value } }],
    undo: null,
  };
}

/** Save the postcards to the notebook and the outbox, then run `after` (e.g. start the courier). */
export async function perform(db: ShelfDB, postcards: NewPostcard[], after?: () => void): Promise<void> {
  await savePostcards(db, postcards);
  after?.();
}
