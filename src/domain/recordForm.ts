import { changedFields, type RecordFields } from '@/data/actions';
import { MONEY_MAX, type ShelfRecord } from '@/data/schema';
import { GENRE_KEYS, type GenreKey } from './genres';
import type { Grade } from './grades';
import { parsePrice } from './price';
import { normalise } from './search';

/** What the Add and Edit form holds while it is open: everything typed, as typed. */
export type RecordFormValues = {
  artist: string;
  title: string;
  genre: GenreKey | '';
  discGrade: Grade | null;
  sleeveGrade: Grade | null;
  label: string;
  catalog: string;
  year: string;
  format: string;
  notes: string;
  funFact: string;
  funFactSource: string;
  nmLow: string;
  nmHigh: string;
  valueNote: string;
  pricePaid: string;
};
export type FormErrors = Partial<Record<keyof RecordFormValues, string>>;

const FUN_FACT_MAX = 500;

export function emptyForm(keep?: { genre: GenreKey | ''; label: string }): RecordFormValues {
  return {
    artist: '',
    title: '',
    genre: keep?.genre ?? '',
    discGrade: null,
    sleeveGrade: null,
    label: keep?.label ?? '',
    catalog: '',
    year: '',
    format: '',
    notes: '',
    funFact: '',
    funFactSource: '',
    nmLow: '',
    nmHigh: '',
    valueNote: '',
    pricePaid: '',
  };
}

export function formFromRecord(r: ShelfRecord): RecordFormValues {
  return {
    artist: r.artist,
    title: r.title,
    genre: r.genre,
    discGrade: r.discGrade,
    sleeveGrade: r.sleeveGrade,
    label: r.label ?? '',
    catalog: r.catalog ?? '',
    year: r.year === null ? '' : String(r.year),
    format: r.format ?? '',
    notes: r.notes ?? '',
    funFact: r.funFact ?? '',
    funFactSource: r.funFactSource ?? '',
    nmLow: r.nmEstimateLow === null ? '' : String(r.nmEstimateLow),
    nmHigh: r.nmEstimateHigh === null ? '' : String(r.nmEstimateHigh),
    valueNote: r.valueNote ?? '',
    pricePaid: r.pricePaid === null ? '' : String(r.pricePaid),
  };
}

/** Trimmed text, with blank as null. */
function textOrNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

/** A money field: blank is null, a number under a million is itself, anything else is an error. */
function money(raw: string): { value: number | null; bad: string | null } {
  if (raw.trim() === '') return { value: null, bad: null };
  const value = parsePrice(raw);
  if (value === null) return { value, bad: 'Use a number, like 15.50' };
  if (value > MONEY_MAX) return { value, bad: 'Keep it under $1,000,000' };
  return { value, bad: null };
}

export function parseRecordForm(v: RecordFormValues): { ok: true; fields: RecordFields } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const artist = textOrNull(v.artist);
  const title = textOrNull(v.title);
  if (artist === null) errors.artist = 'Add the artist';
  if (title === null) errors.title = 'Add the title';
  const genre = GENRE_KEYS.find((g) => g === v.genre);
  if (!genre) errors.genre = 'Choose a genre';

  let year: number | null = null;
  const yearText = v.year.trim();
  if (yearText !== '') {
    year = /^\d+$/.test(yearText) ? Number(yearText) : NaN;
    if (!(year >= 1900 && year <= 2100)) {
      errors.year = 'Year must be between 1900 and 2100';
      year = null;
    }
  }

  const low = money(v.nmLow);
  const high = money(v.nmHigh);
  const paid = money(v.pricePaid);
  if (low.bad) errors.nmLow = low.bad;
  if (high.bad) errors.nmHigh = high.bad;
  if (paid.bad) errors.pricePaid = paid.bad;
  if (!low.bad && !high.bad) {
    if (low.value === null && high.value !== null) errors.nmLow = 'Fill both, or neither';
    else if (low.value !== null && high.value === null) errors.nmHigh = 'Fill both, or neither';
    else if (low.value !== null && high.value !== null && low.value > high.value) errors.nmLow = 'Low can’t be more than high';
  }

  const funFact = textOrNull(v.funFact);
  const funFactSource = textOrNull(v.funFactSource);
  if (funFact !== null && funFact.length > FUN_FACT_MAX) errors.funFact = `Keep it to ${FUN_FACT_MAX} characters`;
  if (funFactSource !== null) {
    if (!funFactSource.startsWith('https://') || funFactSource.length <= 'https://'.length) errors.funFactSource = 'Use a full web address (https://…)';
    else if (funFact === null) errors.funFactSource = 'Add the fun fact this source is for';
  }

  if (Object.keys(errors).length > 0 || artist === null || title === null || !genre) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      artist,
      title,
      genre,
      discGrade: v.discGrade,
      sleeveGrade: v.sleeveGrade,
      label: textOrNull(v.label),
      catalog: textOrNull(v.catalog),
      year,
      format: textOrNull(v.format),
      notes: textOrNull(v.notes),
      funFact,
      funFactSource,
      nmEstimateLow: low.value,
      nmEstimateHigh: high.value,
      valueNote: textOrNull(v.valueNote),
      pricePaid: paid.value,
    },
  };
}

/**
 * Whether the form differs from how it opened, by what it would save: typing a letter and deleting it, or `15.5` versus
 * `15,50`, is no change. A form that does not parse yet is compared as typed.
 */
export function isDirty(opened: RecordFormValues, current: RecordFormValues): boolean {
  const a = parseRecordForm(opened);
  const b = parseRecordForm(current);
  if (a.ok && b.ok) return Object.keys(changedFields(a.fields, b.fields)).length > 0;
  return (Object.keys(opened) as (keyof RecordFormValues)[]).some((k) => opened[k] !== current[k]);
}

/** The first record already on the shelf with this artist and title, ignoring case, accents and punctuation. */
export function findDuplicate(records: ShelfRecord[], artist: string, title: string, excludeId?: string): ShelfRecord | null {
  const a = normalise(artist);
  const t = normalise(title);
  if (a === '' || t === '') return null;
  return records.find((r) => r.deletedAt === null && r.id !== excludeId && normalise(r.artist) === a && normalise(r.title) === t) ?? null;
}

