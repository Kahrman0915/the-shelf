import { describe, expect, it } from 'vitest';
import { FORM_FIELDS, type RecordFields } from '@/data/actions';
import type { ShelfRecord } from '@/data/schema';
import { emptyForm, findDuplicate, formFromRecord, isDirty, parseRecordForm, type RecordFormValues } from './recordForm';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function record(p: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id: ID,
    shelfId: '33333333-3333-4333-8333-333333333333',
    status: 'owned',
    wantsUpgrade: false,
    upgradeNote: null,
    artist: 'Mötley Crüe',
    title: 'Girls, Girls, Girls',
    label: 'Elektra',
    catalog: '60725',
    year: 1987,
    format: 'LP',
    genre: 'rock',
    discGrade: 'VG+',
    sleeveGrade: 'VG',
    pricePaid: 15.5,
    nmEstimateLow: 20,
    nmEstimateHigh: 40,
    valueNote: 'Original pressing',
    notes: 'Gatefold',
    discogsReleaseId: null,
    coverPath: null,
    funFact: 'Named after a strip club.',
    funFactSource: 'https://example.com/fact',
    coverImageUrl: null,
    boughtAt: null,
    addedBy: OTHER,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    deletedAt: null,
    importKey: null,
    ...p,
  };
}

function valid(p: Partial<RecordFormValues> = {}): RecordFormValues {
  return { ...emptyForm(), artist: 'Art Blakey', title: 'Moanin’', genre: 'jazz', ...p };
}

function errorsOf(p: Partial<RecordFormValues>) {
  const r = parseRecordForm(valid(p));
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}

describe('parseRecordForm', () => {
  it('turns a minimal form into fields, with blank text as null', () => {
    const r = parseRecordForm(valid({ label: '   ', notes: '' }));
    expect(r).toMatchObject({ ok: true, fields: { artist: 'Art Blakey', title: 'Moanin’', genre: 'jazz', label: null, notes: null, funFact: null, year: null, pricePaid: null } });
  });

  it('trims text', () => {
    const r = parseRecordForm(valid({ artist: '  Art Blakey ', funFact: ' A fact ' }));
    expect(r).toMatchObject({ ok: true, fields: { artist: 'Art Blakey', funFact: 'A fact' } });
  });

  it('asks for the artist, the title and a genre', () => {
    expect(errorsOf({ artist: '  ' })).toEqual({ artist: 'Add the artist' });
    expect(errorsOf({ title: '' })).toEqual({ title: 'Add the title' });
    expect(errorsOf({ genre: '' })).toEqual({ genre: 'Choose a genre' });
  });

  it('keeps the year between 1900 and 2100', () => {
    const msg = 'Year must be between 1900 and 2100';
    expect(errorsOf({ year: '66' })).toEqual({ year: msg });
    expect(errorsOf({ year: '2101' })).toEqual({ year: msg });
    expect(errorsOf({ year: '19.5' })).toEqual({ year: msg });
    expect(errorsOf({ year: 'abc' })).toEqual({ year: msg });
    expect(parseRecordForm(valid({ year: '1959' }))).toMatchObject({ ok: true, fields: { year: 1959 } });
  });

  it('reads a comma as a decimal point or a thousands separator', () => {
    expect(parseRecordForm(valid({ pricePaid: '15,50' }))).toMatchObject({ ok: true, fields: { pricePaid: 15.5 } });
    expect(parseRecordForm(valid({ nmLow: '1,200', nmHigh: '2,000' }))).toMatchObject({
      ok: true,
      fields: { nmEstimateLow: 1200, nmEstimateHigh: 2000 },
    });
  });

  it('wants both estimates or neither', () => {
    expect(errorsOf({ nmLow: '20' })).toEqual({ nmHigh: 'Fill both, or neither' });
    expect(errorsOf({ nmHigh: '20' })).toEqual({ nmLow: 'Fill both, or neither' });
  });

  it('checks low against high after parsing', () => {
    expect(errorsOf({ nmLow: '1,200', nmHigh: '900' })).toEqual({ nmLow: 'Low can’t be more than high' });
  });

  it('wants the source to be an https link, and to come with a fun fact', () => {
    const msg = 'Use a full web address (https://…)';
    expect(errorsOf({ funFact: 'x', funFactSource: 'http://example.com' })).toEqual({ funFactSource: msg });
    expect(errorsOf({ funFactSource: 'https://example.com' })).toEqual({ funFactSource: 'Add the fun fact this source is for' });
    expect(parseRecordForm(valid({ funFact: 'x', funFactSource: 'https://example.com' }))).toMatchObject({ ok: true });
  });

  it('keeps prices under a million', () => {
    const msg = 'Keep it under $1,000,000';
    expect(errorsOf({ pricePaid: '1000000' })).toEqual({ pricePaid: msg });
    expect(errorsOf({ nmLow: '10', nmHigh: '1,000,000' })).toEqual({ nmHigh: msg });
    expect(errorsOf({ nmLow: '1000000', nmHigh: '2000000' })).toEqual({ nmLow: msg, nmHigh: msg });
    expect(parseRecordForm(valid({ pricePaid: '999999.99' }))).toMatchObject({ ok: true, fields: { pricePaid: 999999.99 } });
  });

  it('rejects a fun fact over 500 characters', () => {
    expect(errorsOf({ funFact: 'x'.repeat(501) }).funFact).toBeDefined();
  });
});

describe('emptyForm', () => {
  it('keeps only the genre and label it is given', () => {
    const f = emptyForm({ genre: 'jazz', label: 'Impulse!' });
    expect(f).toEqual({ ...emptyForm(), genre: 'jazz', label: 'Impulse!' });
    expect(f.artist).toBe('');
  });
});

describe('formFromRecord', () => {
  it('round-trips every form field unchanged', () => {
    const r = record();
    const parsed = parseRecordForm(formFromRecord(r));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const expected = Object.fromEntries(FORM_FIELDS.map((k) => [k, r[k]])) as RecordFields;
    expect(parsed.fields).toEqual(expected);
  });
});

describe('isDirty', () => {
  const opened = formFromRecord(record());

  it('is false when untouched', () => {
    expect(isDirty(opened, { ...opened })).toBe(false);
  });
  it('is false after typing a character and deleting it', () => {
    expect(isDirty(opened, { ...opened, artist: opened.artist + 'x' })).toBe(true);
    expect(isDirty(opened, { ...opened, artist: opened.artist })).toBe(false);
  });
  it('is false for 15.5 versus 15,50', () => {
    expect(isDirty({ ...opened, pricePaid: '15.5' }, { ...opened, pricePaid: '15,50' })).toBe(false);
  });
  it('is false for whitespace around text', () => {
    expect(isDirty(opened, { ...opened, notes: ` ${opened.notes} ` })).toBe(false);
  });
  it('is true for a real change', () => {
    expect(isDirty(opened, { ...opened, pricePaid: '16' })).toBe(true);
    expect(isDirty(opened, { ...opened, discGrade: 'NM' })).toBe(true);
  });
  it('counts any raw difference when the form does not parse', () => {
    const broken = { ...opened, year: '66' };
    expect(isDirty(broken, { ...broken })).toBe(false);
    expect(isDirty(broken, { ...broken, year: '67' })).toBe(true);
  });
});

describe('findDuplicate', () => {
  const crue = record();
  it('matches across case, accents and punctuation', () => {
    expect(findDuplicate([crue], 'mötley crüe', 'GIRLS, GIRLS, GIRLS')).toBe(crue);
    expect(findDuplicate([crue], 'Motley Crue', 'girls girls girls')).toBe(crue);
  });
  it('does not match a different title', () => {
    expect(findDuplicate([crue], 'Mötley Crüe', 'Shout at the Devil')).toBeNull();
  });
  it('ignores deleted records', () => {
    expect(findDuplicate([record({ deletedAt: '2026-10-02T00:00:00.000Z' })], 'Mötley Crüe', 'Girls, Girls, Girls')).toBeNull();
  });
  it('skips the record being edited', () => {
    expect(findDuplicate([crue], 'Mötley Crüe', 'Girls, Girls, Girls', ID)).toBeNull();
    const twin = record({ id: OTHER });
    expect(findDuplicate([crue, twin], 'Mötley Crüe', 'Girls, Girls, Girls', ID)).toBe(twin);
  });
  it('returns null when the artist or title is empty', () => {
    expect(findDuplicate([crue], 'Mötley Crüe', '')).toBeNull();
    expect(findDuplicate([crue], '  ', 'Girls, Girls, Girls')).toBeNull();
  });
});
