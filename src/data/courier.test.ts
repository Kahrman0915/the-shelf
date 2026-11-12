import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBackend } from '@/test/fakeBackend';
import { REJECTED, type ShelfWriter } from './backend';
import { discardPostcard, pushOutbox, retryPostcard, syncOnce } from './courier';
import { ShelfDB, writeSession } from './db';
import { savePostcards, type NewPostcard } from './outbox';
import { recordToRow } from './rowMapping';
import type { ShelfRecord } from './schema';
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
    coverPath: null,
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
