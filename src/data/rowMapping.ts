import { RatingSchema, RecordSchema, type Rating, type ShelfRecord } from './schema';

export type RecordRow = {
  id: string;
  shelf_id: string;
  status: ShelfRecord['status'];
  wants_upgrade: boolean;
  upgrade_note: string | null;
  artist: string;
  title: string;
  label: string | null;
  catalog: string | null;
  year: number | null;
  format: string | null;
  genre: ShelfRecord['genre'];
  disc_grade: ShelfRecord['discGrade'];
  sleeve_grade: ShelfRecord['sleeveGrade'];
  price_paid: number | null;
  nm_estimate_low: number | null;
  nm_estimate_high: number | null;
  value_note: string | null;
  notes: string | null;
  discogs_release_id: number | null;
  cover_path: string | null;
  bought_at: string | null;
  added_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  import_key: string | null;
};

export type RatingRow = { record_id: string; user_id: string; value: number; updated_at: string };

export class RowError extends Error {
  constructor(public problems: string[]) {
    super(`The shelf sent data this app doesn't understand:\n${problems.join('\n')}`);
    this.name = 'RowError';
  }
}

/** Postgres numeric can arrive as a string; everything else passes through for the schema to judge. */
function num(v: unknown): unknown {
  return typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
}

export function recordToRow(r: ShelfRecord): RecordRow {
  return {
    id: r.id,
    shelf_id: r.shelfId,
    status: r.status,
    wants_upgrade: r.wantsUpgrade,
    upgrade_note: r.upgradeNote,
    artist: r.artist,
    title: r.title,
    label: r.label,
    catalog: r.catalog,
    year: r.year,
    format: r.format,
    genre: r.genre,
    disc_grade: r.discGrade,
    sleeve_grade: r.sleeveGrade,
    price_paid: r.pricePaid,
    nm_estimate_low: r.nmEstimateLow,
    nm_estimate_high: r.nmEstimateHigh,
    value_note: r.valueNote,
    notes: r.notes,
    discogs_release_id: r.discogsReleaseId,
    cover_path: r.coverPath,
    bought_at: r.boughtAt,
    added_by: r.addedBy,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    deleted_at: r.deletedAt,
    import_key: r.importKey,
  };
}

export function recordFromRow(row: Record<string, unknown>): ShelfRecord {
  const parsed = RecordSchema.safeParse({
    id: row.id,
    shelfId: row.shelf_id,
    status: row.status,
    wantsUpgrade: row.wants_upgrade,
    upgradeNote: row.upgrade_note,
    artist: row.artist,
    title: row.title,
    label: row.label,
    catalog: row.catalog,
    year: num(row.year),
    format: row.format,
    genre: row.genre,
    discGrade: row.disc_grade,
    sleeveGrade: row.sleeve_grade,
    pricePaid: num(row.price_paid),
    nmEstimateLow: num(row.nm_estimate_low),
    nmEstimateHigh: num(row.nm_estimate_high),
    valueNote: row.value_note,
    notes: row.notes,
    discogsReleaseId: num(row.discogs_release_id),
    coverPath: row.cover_path,
    boughtAt: row.bought_at,
    addedBy: row.added_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    importKey: row.import_key,
  });
  if (!parsed.success) {
    const name = typeof row.id === 'string' ? row.id : 'record';
    throw new RowError(parsed.error.issues.map((i) => `${name}: ${i.path.join('.') || '(record)'} ${i.message}`));
  }
  return parsed.data;
}

export function ratingToRow(r: Rating): RatingRow {
  return { record_id: r.recordId, user_id: r.userId, value: r.value, updated_at: r.updatedAt };
}

export function ratingFromRow(row: Record<string, unknown>): Rating {
  const parsed = RatingSchema.safeParse({ recordId: row.record_id, userId: row.user_id, value: num(row.value), updatedAt: row.updated_at });
  if (!parsed.success) {
    throw new RowError(parsed.error.issues.map((i) => `rating ${String(row.record_id)}: ${i.path.join('.')} ${i.message}`));
  }
  return parsed.data;
}
