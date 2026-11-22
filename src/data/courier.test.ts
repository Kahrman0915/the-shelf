import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBackend } from '@/test/fakeBackend';
import { REJECTED, type ShelfWriter } from './backend';
import { discardPostcard, pushOutbox, retryPostcard, syncOnce } from './courier';
import { clearPhoneIfNothingWaiting, ShelfDB, writeSession } from './db';
import { savePostcards, type NewPostcard } from './outbox';
import { recordToRow } from './rowMapping';
import type { Section, ShelfRecord } from './schema';
import { pullShelf } from './sync';

const SHELF = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333';
const B = '44444444-4444-4444-8444-444444444444';
const WHEN = '2026-11-11T10:00:00.000Z';

function record(id: string, over: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id,
    shelfId: SHELF,
    status: 'owned',
    wantsUpgrade: false,
    upgradeNote: null,
    artist: 'Miles Davis',
    title: 'Kind of Blue',
    label: null,
    catalog: null,
    year: null,
    format: null,
    genre: 'jazz',
    discGrade: null,
    sleeveGrade: null,
    pricePaid: null,
    nmEstimateLow: null,
    nmEstimateHigh: null,
    valueNote: null,
    notes: null,
    discogsReleaseId: null,
    coverPath: null, backPath: null,
    funFact: null,
    funFactSource: null,
    coverImageUrl: null,
    boughtAt: null,
    addedBy: ME,
    createdAt: WHEN,
    updatedAt: WHEN,
    deletedAt: null,
    importKey: null,
    ...over,
  };
}

const card = { shelfId: SHELF, userId: ME, createdAt: WHEN };
const create = (id: string): NewPostcard => ({ ...card, recordId: id, kind: 'record.create', fields: record(id, { status: 'new_arrival' }) });
const patch = (id: string, fields: Partial<ShelfRecord>): NewPostcard => ({ ...card, recordId: id, kind: 'record.patch', fields });
const rate = (id: string, value: number): NewPostcard => ({ ...card, recordId: id, kind: 'rating.set', fields: { value } });

let db: ShelfDB;
let backend: FakeBackend;

beforeEach(async () => {
  db = new ShelfDB(`courier-${crypto.randomUUID()}`);
  await writeSession(db, { userId: ME, email: 'me@example.com', shelfId: SHELF });
  backend = new FakeBackend({ records: [recordToRow(record(B, { discGrade: 'NM', notes: 'Server notes' }))], ratings: [], members: [] });
  await pullShelf(db, backend, SHELF);
});

afterEach(async () => {
  await db.delete();
});

const serverRows = async (id: string) => (await backend.recordsSince(SHELF, null)).filter((r) => r.id === id);
const outbox = () => db.outbox.orderBy('seq').toArray();

describe('pushOutbox', () => {
  it('runs one at a time per phone, so an overlapping run can’t resend an older change last', async () => {
    await savePostcards(db, [patch(B, { notes: 'X' }), patch(B, { notes: 'Y' })]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const held: ShelfWriter = {
      insertRecord: (row) => backend.insertRecord(row),
      setRating: (recordId, userId, value) => backend.setRating(recordId, userId, value),
      uploadPhoto: (path, bytes) => backend.uploadPhoto(path, bytes),
      deletePhoto: (path) => backend.deletePhoto(path),
      insertSection: (row) => backend.insertSection(row),
      patchSection: (id, fields) => backend.patchSection(id, fields),
      mergeSection: (from, into) => backend.mergeSection(from, into),
      patchRecord: async (id, fields) => {
        calls++;
        if (calls === 1) await gate;
        return backend.patchRecord(id, fields);
      },
    };

    const first = pushOutbox(db, held);
    const second = pushOutbox(db, held);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1); // the second run waits for the first to finish
    release();
    expect(await first).toEqual({ sent: 2, rejected: 0, noSignal: false });
    expect(await second).toEqual({ sent: 0, rejected: 0, noSignal: false });
    expect(backend.recordRow(B)?.notes).toBe('Y');
  });

  it('a failed run doesn’t stop the next one', async () => {
    await savePostcards(db, [patch(B, { notes: 'X' })]);
    const broken = vi.spyOn(db.outbox, 'where').mockImplementationOnce(() => {
      throw new Error('Disk is full');
    });
    await expect(pushOutbox(db, backend)).rejects.toThrow('Disk is full');
    broken.mockRestore();
    expect(await pushOutbox(db, backend)).toEqual({ sent: 1, rejected: 0, noSignal: false });
  });

  it('sends postcards in order', async () => {
    await savePostcards(db, [create(A)]);
    await savePostcards(db, [patch(A, { discGrade: 'VG+' })]);
    expect(await pushOutbox(db, backend)).toEqual({ sent: 2, rejected: 0, noSignal: false });
    expect(backend.recordRow(A)?.disc_grade).toBe('VG+');
    expect(await db.outbox.count()).toBe(0);
  });

  it('stops and keeps everything when there is no signal', async () => {
    await savePostcards(db, [create(A), patch(B, { discGrade: 'VG+' })]);
    backend.online = false;
    expect(await pushOutbox(db, backend)).toEqual({ sent: 0, rejected: 0, noSignal: true });
    const left = await outbox();
    expect(left.map((p) => [p.kind, p.state])).toEqual([
      ['record.create', 'waiting'],
      ['record.patch', 'waiting'],
    ]);
    backend.online = true;
    expect(backend.recordRow(A)).toBeUndefined();
    expect(backend.recordRow(B)?.disc_grade).toBe('NM');
  });

  it('a lost reply is resent without a duplicate', async () => {
    await savePostcards(db, [create(A)]);
    backend.loseNextReply = true;
    expect(await pushOutbox(db, backend)).toEqual({ sent: 0, rejected: 0, noSignal: true });
    expect(await db.outbox.count()).toBe(1);
    expect(await pushOutbox(db, backend)).toEqual({ sent: 1, rejected: 0, noSignal: false });
    expect(await serverRows(A)).toHaveLength(1);

    await savePostcards(db, [rate(B, 4)]);
    backend.loseNextReply = true;
    expect(await pushOutbox(db, backend)).toEqual({ sent: 0, rejected: 0, noSignal: true });
    expect(await pushOutbox(db, backend)).toEqual({ sent: 1, rejected: 0, noSignal: false });
    const ratings = (await backend.ratings(SHELF)).filter((r) => r.record_id === B && r.user_id === ME);
    expect(ratings).toHaveLength(1);
    expect(ratings[0].value).toBe(4);
    expect(await db.outbox.count()).toBe(0);
  });

  it('a rejection holds later postcards for that record only', async () => {
    await savePostcards(db, [create(A), patch(A, { discGrade: 'VG+' }), patch(B, { wantsUpgrade: true })]);
    backend.rejectNext = REJECTED.permission;
    expect(await pushOutbox(db, backend)).toEqual({ sent: 1, rejected: 1, noSignal: false });
    const left = await outbox();
    expect(left.map((p) => [p.kind, p.recordId, p.state, p.reason])).toEqual([
      ['record.create', A, 'rejected', REJECTED.permission],
      ['record.patch', A, 'waiting', null],
    ]);
    expect(backend.recordRow(A)).toBeUndefined();
    expect(backend.recordRow(B)?.wants_upgrade).toBe(true);

    // A rejection from an earlier run still holds the record's later postcards.
    expect(await pushOutbox(db, backend)).toEqual({ sent: 0, rejected: 0, noSignal: false });
    expect((await outbox()).map((p) => p.state)).toEqual(['rejected', 'waiting']);
  });

  it('a phone-side failure after a send fails the run, not the postcard, and the next run resends it', async () => {
    await savePostcards(db, [patch(B, { notes: 'X' })]);
    const broken = vi.spyOn(db.outbox, 'delete').mockRejectedValueOnce(new Error('Disk is full'));
    await expect(pushOutbox(db, backend)).rejects.toThrow('Disk is full');
    broken.mockRestore();
    expect(backend.recordRow(B)?.notes).toBe('X');
    expect((await outbox()).map((p) => [p.state, p.reason])).toEqual([['waiting', null]]);
    expect(await pushOutbox(db, backend)).toEqual({ sent: 1, rejected: 0, noSignal: false });
    expect(await db.outbox.count()).toBe(0);
  });

  it('an app error while sending is rejected in plain words, and logged', async () => {
    await savePostcards(db, [patch(B, { notes: 'X' })]);
    const bug = new TypeError('Cannot read properties of undefined');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writer: ShelfWriter = {
      insertRecord: (row) => backend.insertRecord(row),
      setRating: (recordId, userId, value) => backend.setRating(recordId, userId, value),
      uploadPhoto: (path, bytes) => backend.uploadPhoto(path, bytes),
      deletePhoto: (path) => backend.deletePhoto(path),
      insertSection: (row) => backend.insertSection(row),
      patchSection: (id, fields) => backend.patchSection(id, fields),
      mergeSection: (from, into) => backend.mergeSection(from, into),
      patchRecord: async () => {
        throw bug;
      },
    };
    expect(await pushOutbox(db, writer)).toEqual({ sent: 0, rejected: 1, noSignal: false });
    expect((await outbox()).map((p) => [p.state, p.reason])).toEqual([['rejected', 'The shelf refused this change. (app error)']]);
    expect(logged).toHaveBeenCalledWith(bug);
    logged.mockRestore();
  });

  it('a patch for a record the shelf no longer has is rejected in plain words', async () => {
    await db.records.put(record(A));
    await savePostcards(db, [patch(A, { notes: 'Hello' })]);
    expect(await pushOutbox(db, backend)).toEqual({ sent: 0, rejected: 1, noSignal: false });
    expect((await outbox()).map((p) => [p.state, p.reason])).toEqual([['rejected', REJECTED.missing]]);
  });
});

describe('retryPostcard', () => {
  it('sends it on the next run', async () => {
    await savePostcards(db, [create(A)]);
    backend.rejectNext = REJECTED.range;
    await pushOutbox(db, backend);
    const [rejected] = await outbox();
    expect(rejected.state).toBe('rejected');

    await retryPostcard(db, rejected.seq);
    expect((await outbox()).map((p) => [p.state, p.reason])).toEqual([['waiting', null]]);
    expect(await pushOutbox(db, backend)).toEqual({ sent: 1, rejected: 0, noSignal: false });
    expect(backend.recordRow(A)).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('discardPostcard', () => {
  it('drops it and the record’s later postcards, then matches the server', async () => {
    await savePostcards(db, [patch(B, { discGrade: 'VG+' })]);
    await savePostcards(db, [patch(B, { notes: 'My notes' })]);
    backend.rejectNext = REJECTED.unknownValue;
    await pushOutbox(db, backend);
    await savePostcards(db, [create(A), patch(A, { discGrade: 'G' })]);
    const [rejected] = await outbox();
    expect(rejected).toMatchObject({ recordId: B, state: 'rejected' });
    expect((await db.records.get(B))?.discGrade).toBe('VG+');

    const recordsSince = vi.spyOn(backend, 'recordsSince');
    await discardPostcard(db, backend, SHELF, rejected.seq);

    expect(recordsSince).toHaveBeenCalledWith(SHELF, null);
    expect((await outbox()).map((p) => [p.kind, p.recordId, p.state])).toEqual([
      ['record.create', A, 'waiting'],
      ['record.patch', A, 'waiting'],
    ]);
    const b = await db.records.get(B);
    expect([b?.discGrade, b?.notes]).toEqual(['NM', 'Server notes']);
    expect((await db.records.get(A))?.discGrade).toBe('G');
  });

  it('a discarded create that never reached the shelf leaves this phone too', async () => {
    await savePostcards(db, [create(A), rate(A, 3)]);
    backend.rejectNext = REJECTED.permission;
    await pushOutbox(db, backend);
    const [rejected] = await outbox();
    expect(rejected).toMatchObject({ kind: 'record.create', state: 'rejected' });

    await discardPostcard(db, backend, SHELF, rejected.seq);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.records.get(A)).toBeUndefined();
    expect(await db.ratings.where('recordId').equals(A).count()).toBe(0);
    expect(await db.records.get(B)).toBeDefined();
  });
});

describe('syncOnce', () => {
  it('pushes, then pulls', async () => {
    await savePostcards(db, [patch(B, { discGrade: 'VG+' })]);
    backend.touchRecord(B, { notes: 'From the other phone' });
    expect(await syncOnce(db, backend, SHELF)).toEqual({ sent: 1, rejected: 0, noSignal: false });
    const b = await db.records.get(B);
    expect([b?.discGrade, b?.notes]).toEqual(['VG+', 'From the other phone']);
  });

  it('skips the pull when there is no signal', async () => {
    await savePostcards(db, [patch(B, { discGrade: 'VG+' })]);
    backend.online = false;
    const recordsSince = vi.spyOn(backend, 'recordsSince');
    expect(await syncOnce(db, backend, SHELF)).toEqual({ sent: 0, rejected: 0, noSignal: true });
    expect(recordsSince).not.toHaveBeenCalled();
  });
});

describe('photo postcards', () => {
  const PATH = `${SHELF}/${A}/front-aaaa.jpg`;
  const bytes = () => new Uint8Array([1, 2, 3]).buffer;
  const upload: NewPostcard = { ...card, recordId: A, kind: 'photo.upload', fields: { path: PATH } };
  const pointer = patch(A, { coverPath: PATH });
  const saveBatch = () => savePostcards(db, [create(A), upload, pointer], [{ path: PATH, bytes: bytes() }]);
  const states = async () => (await outbox()).map((p) => [p.kind, p.state]);

  it('sends the create, then the photo, then the pointer', async () => {
    const order: string[] = [];
    for (const name of ['uploadPhoto', 'insertRecord', 'patchRecord'] as const) {
      const real = backend[name].bind(backend) as (...a: unknown[]) => Promise<unknown>;
      vi.spyOn(backend, name).mockImplementation(((...a: unknown[]) => (order.push(name), real(...a))) as never);
    }
    await saveBatch();
    expect(await pushOutbox(db, backend)).toEqual({ sent: 3, rejected: 0, noSignal: false });
    expect(order).toEqual(['insertRecord', 'uploadPhoto', 'patchRecord']);
    expect(new Uint8Array(backend.photos.get(PATH)!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(backend.recordRow(A)?.cover_path).toBe(PATH);
  });

  it('no signal keeps the photo for next time', async () => {
    await saveBatch();
    backend.online = false;
    expect((await pushOutbox(db, backend)).noSignal).toBe(true);
    expect(await db.photos.get(PATH)).toBeDefined();
    expect(await db.outbox.count()).toBe(3);
    expect(await clearPhoneIfNothingWaiting(db)).toBe(3);
    expect(await db.photos.get(PATH)).toBeDefined();
  });

  it('a rejected create holds that record’s photos', async () => {
    await saveBatch();
    const uploadPhoto = vi.spyOn(backend, 'uploadPhoto');
    backend.rejectNext = REJECTED.range;
    await pushOutbox(db, backend);
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(await states()).toEqual([['record.create', 'rejected'], ['photo.upload', 'waiting'], ['record.patch', 'waiting']]);
  });

  it('a photo missing from the phone is rejected, not skipped', async () => {
    await saveBatch();
    await db.photos.delete(PATH);
    await pushOutbox(db, backend);
    const [up, patched] = await outbox();
    expect([up.state, up.reason, patched.state]).toEqual(['rejected', REJECTED.photoGone, 'waiting']);
  });

  it('photo.delete removes the file on the shelf and on this phone', async () => {
    backend.photos.set(PATH, bytes());
    await savePostcards(db, [{ ...card, recordId: B, kind: 'photo.delete', fields: { path: PATH } }], []);
    await db.photos.put({ path: PATH, bytes: bytes() });
    await pushOutbox(db, backend);
    expect(backend.photos.has(PATH)).toBe(false);
    expect(await db.photos.get(PATH)).toBeUndefined();
  });

  it('a refused photo.delete counts as sent: it isn’t shown, doesn’t hold the record, and the bytes still go', async () => {
    backend.photos.set(PATH, bytes());
    await savePostcards(db, [{ ...card, recordId: B, kind: 'photo.delete', fields: { path: PATH } }, patch(B, { notes: 'after' })], []);
    await db.photos.put({ path: PATH, bytes: bytes() });
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    backend.rejectNext = REJECTED.permission;
    expect(await pushOutbox(db, backend)).toEqual({ sent: 2, rejected: 0, noSignal: false });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.photos.get(PATH)).toBeUndefined();
    expect(warned).toHaveBeenCalledOnce();
    expect(warned.mock.calls[0].join(' ')).toContain(REJECTED.permission);
    expect(warned.mock.calls[0].join(' ')).not.toContain(PATH);
  });

  it('no signal on photo.delete still stops the run and keeps it', async () => {
    await savePostcards(db, [{ ...card, recordId: B, kind: 'photo.delete', fields: { path: PATH } }], []);
    await db.photos.put({ path: PATH, bytes: bytes() });
    backend.online = false;
    expect((await pushOutbox(db, backend)).noSignal).toBe(true);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.photos.get(PATH)).toBeDefined();
  });

  it('a lost reply on upload is safe to send again', async () => {
    const path = `${SHELF}/${B}/front-bbbb.jpg`;
    await savePostcards(db, [{ ...card, recordId: B, kind: 'photo.upload', fields: { path } }], [{ path, bytes: bytes() }]);
    backend.loseNextReply = true;
    expect((await pushOutbox(db, backend)).noSignal).toBe(true);
    expect(await db.outbox.count()).toBe(1);
    expect(await pushOutbox(db, backend)).toEqual({ sent: 1, rejected: 0, noSignal: false });
    expect(backend.photos.size).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('discarding a create drops its photo bytes from the phone', async () => {
    await saveBatch();
    backend.rejectNext = REJECTED.range;
    await pushOutbox(db, backend);
    const [first] = await outbox();
    await discardPostcard(db, backend, SHELF, first.seq);
    expect(await db.photos.get(PATH)).toBeUndefined();
  });
});

describe('section postcards', () => {
  const S1 = '00000000-0000-4000-8000-000000000001';
  const S2 = '00000000-0000-4000-8000-000000000002';
  const section = (id: string, over: Partial<Section> = {}): Section => ({
    id, shelfId: SHELF, name: 'Rock', color: 'rock', position: 1, discogsGenres: [], takesHoliday: false, isCatchAll: false, legacyGenre: 'misc', updatedAt: WHEN, ...over,
  });
  const sCard = (id: string) => ({ ...card, recordId: id });
  const sCreate = (s: Section): NewPostcard => ({ ...sCard(s.id), kind: 'section.create', fields: s });
  const sPatch = (id: string, fields: Partial<Section>): NewPostcard => ({ ...sCard(id), kind: 'section.patch', fields });
  const sMerge = (from: string, into: string): NewPostcard => ({ ...sCard(from), kind: 'section.merge', fields: { into } });

  it('sends create, patch and merge through the writer', async () => {
    await savePostcards(db, [sCreate(section(S1, { discogsGenres: ['Rock'], takesHoliday: true })), sCreate(section(S2, { name: 'Jazz', discogsGenres: ['Jazz'] }))]);
    expect(await pushOutbox(db, backend)).toEqual({ sent: 2, rejected: 0, noSignal: false });
    expect(backend.sectionRow(S1)).toMatchObject({ name: 'Rock', shelf_id: SHELF, discogs_genres: ['Rock'] });

    await savePostcards(db, [sPatch(S1, { name: 'Hard rock', position: 3 })]);
    await pushOutbox(db, backend);
    expect(backend.sectionRow(S1)).toMatchObject({ name: 'Hard rock', position: 3 });

    await savePostcards(db, [sMerge(S1, S2)]);
    expect(await pushOutbox(db, backend)).toEqual({ sent: 1, rejected: 0, noSignal: false });
    expect(backend.sectionRow(S1)).toBeUndefined();
    expect(backend.sectionRow(S2)).toMatchObject({ discogs_genres: ['Jazz', 'Rock'], takes_holiday: true });
    expect(await db.outbox.count()).toBe(0);
  });

  it('a resent merge whose section is already gone counts as sent', async () => {
    await savePostcards(db, [sCreate(section(S1)), sCreate(section(S2, { name: 'Jazz' }))]);
    await pushOutbox(db, backend);
    await savePostcards(db, [sMerge(S1, S2)]);
    backend.loseNextReply = true;
    expect((await pushOutbox(db, backend)).noSignal).toBe(true);
    expect(backend.sectionRow(S1)).toBeUndefined();
    expect(await pushOutbox(db, backend)).toEqual({ sent: 1, rejected: 0, noSignal: false });
    expect(await db.outbox.count()).toBe(0);
  });

  it('a patch for a section the shelf no longer has is rejected in plain words', async () => {
    await savePostcards(db, [sPatch(S1, { name: 'Ghost' })]);
    expect(await pushOutbox(db, backend)).toEqual({ sent: 0, rejected: 1, noSignal: false });
    expect((await db.outbox.toArray()).map((p) => p.reason)).toEqual([REJECTED.sectionMissing]);
  });

  it('holds a section’s later postcards while an earlier one for it is rejected', async () => {
    await savePostcards(db, [sCreate(section(S1)), sPatch(S1, { name: 'Louder' })]);
    backend.rejectNext = 'The shelf refused a value that’s out of range.';
    expect(await pushOutbox(db, backend)).toEqual({ sent: 0, rejected: 1, noSignal: false });
    expect((await db.outbox.orderBy('seq').toArray()).map((p) => [p.kind, p.state])).toEqual([['section.create', 'rejected'], ['section.patch', 'waiting']]);
    expect(backend.sectionRow(S1)).toBeUndefined();
  });

  it('discarding a rejected section.create removes the section from the phone', async () => {
    await savePostcards(db, [sCreate(section(S1))]);
    backend.rejectNext = 'No.';
    await pushOutbox(db, backend);
    const [rejected] = await db.outbox.toArray();
    await discardPostcard(db, backend, SHELF, rejected.seq);
    expect(await db.sections.get(S1)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
});
