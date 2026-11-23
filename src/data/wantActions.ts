import { findDuplicate } from '@/domain/recordForm';
import { sectionFor, type SortableSection } from '@/domain/sections';
import { checkRecord, type ActionResult, type Ctx } from './actions';
import { BackendError, type FoundRecord } from './backend';
import type { NewPostcard } from './outbox';
import type { ShelfRecord, Suggestion } from './schema';

type WantCtx = Ctx & { shelfId: string; newId: string; sections: SortableSection[] };

const MAX_UPGRADE_NOTE = 200;

/** A wanted record: no grade, price or purchase date yet, added by you. */
function wantedRecord(
  ctx: WantCtx,
  f: Pick<ShelfRecord, 'artist' | 'title' | 'sectionId' | 'label' | 'catalog' | 'year' | 'format' | 'discogsReleaseId'>,
): ShelfRecord {
  return checkRecord({
    ...f,
    id: ctx.newId,
    shelfId: ctx.shelfId,
    status: 'wanted',
    wantsUpgrade: false,
    upgradeNote: null,
    discGrade: null,
    sleeveGrade: null,
    pricePaid: null,
    nmEstimateLow: null,
    nmEstimateHigh: null,
    valueNote: null,
    notes: null,
    coverPath: null,
    backPath: null,
    funFact: null,
    funFactSource: null,
    coverImageUrl: null,
    boughtAt: null,
    importKey: null,
    addedBy: ctx.me,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
  });
}

function createCard(r: ShelfRecord, ctx: Ctx): NewPostcard {
  return { kind: 'record.create', shelfId: r.shelfId, recordId: r.id, userId: ctx.me, createdAt: ctx.now, fields: r };
}

function softDeleteCard(r: ShelfRecord, ctx: Ctx): NewPostcard {
  return { kind: 'record.patch', shelfId: r.shelfId, recordId: r.id, userId: ctx.me, createdAt: ctx.now, fields: { deletedAt: ctx.now } };
}

function suggestionCard(s: Suggestion, ctx: Ctx, fields: Pick<Suggestion, 'status' | 'decidedBy' | 'decidedAt'>): NewPostcard {
  return { kind: 'suggestion.patch', shelfId: s.shelfId, recordId: s.id, userId: ctx.me, createdAt: ctx.now, fields };
}

const PENDING = { status: 'pending', decidedBy: null, decidedAt: null } as const;

/** A Discogs result added to the want list. Album-level (just artist and title) unless `exactPressing`. Undone by soft-delete. */
export function addWant(found: FoundRecord, ctx: WantCtx, opts: { exactPressing: boolean }): ActionResult {
  const exact = opts.exactPressing;
  const record = wantedRecord(ctx, {
    artist: found.artist,
    title: found.title,
    sectionId: sectionFor(found.genres, found.styles, ctx.sections),
    label: exact ? found.label : null,
    catalog: exact ? found.catalog : null,
    year: exact ? found.year : null,
    format: exact ? found.format : null,
    discogsReleaseId: exact ? found.releaseId : null,
  });
  return { postcards: [createCard(record, ctx)], undo: [softDeleteCard(record, ctx)] };
}

/** Accept a suggestion: an album-level want plus the suggestion marked added. When the record is already on the shelf, only the mark. */
export function addSuggestion(s: Suggestion, records: ShelfRecord[], ctx: WantCtx): ActionResult {
  const added = suggestionCard(s, ctx, { status: 'added', decidedBy: ctx.me, decidedAt: ctx.now });
  const back = suggestionCard(s, ctx, PENDING);
  if (findDuplicate(records, s.artist, s.title)) return { postcards: [added], undo: [back] };
  const record = wantedRecord(ctx, {
    artist: s.artist,
    title: s.title,
    sectionId: sectionFor(s.discogsGenres, s.discogsStyles, ctx.sections),
    label: null,
    catalog: null,
    year: null,
    format: null,
    discogsReleaseId: null,
  });
  return { postcards: [createCard(record, ctx), added], undo: [softDeleteCard(record, ctx), back] };
}

/** "Not for me". No undo. */
export function dismissSuggestion(s: Suggestion, ctx: Ctx): ActionResult {
  return { postcards: [suggestionCard(s, ctx, { status: 'dismissed', decidedBy: ctx.me, decidedAt: ctx.now })], undo: null };
}

/** The `extra` the Edit screen hands editRecord and restoreWithEdits: only the upgrade fields that differ from the record. */
export function upgradeChange(record: ShelfRecord, wantsUpgrade: boolean, note: string): Partial<ShelfRecord> {
  if (record.status !== 'owned') throw new BackendError('Only records you own can be marked for an upgrade.');
  const trimmed = note.trim();
  if (trimmed.length > MAX_UPGRADE_NOTE) throw new BackendError('An upgrade note is at most 200 characters.');
  const upgradeNote = wantsUpgrade && trimmed !== '' ? trimmed : null;
  const change: Partial<ShelfRecord> = {};
  if (wantsUpgrade !== record.wantsUpgrade) change.wantsUpgrade = wantsUpgrade;
  if (upgradeNote !== record.upgradeNote) change.upgradeNote = upgradeNote;
  return change;
}
