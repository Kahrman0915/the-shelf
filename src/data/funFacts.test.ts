import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBackend } from '@/test/fakeBackend';
import { ShelfDB, writeSession } from './db';
import { readFunFactQueue, runFunFacts, wantFunFact } from './funFacts';
import type { ShelfRecord } from './schema';

const SHELF = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333';
const B = '44444444-4444-4444-8444-444444444444';
const WHEN = '2026-11-11T10:00:00.000Z';
const FACT = { fact: 'Recorded in two sessions in 1959.', sourceUrl: 'https://example.com/kind-of-blue' };

function record(id: string, over: Partial<ShelfRecord> = {}): ShelfRecord {
  return {
    id,
    shelfId: SHELF,
    status: 'owned',
    wantsUpgrade: false,
    upgradeNote: null,
    artist: 'Miles Davis',
    title: 'Kind of Blue',
    label: 'Columbia',
    catalog: null,
    year: 1959,
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
    backPath: null,
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

let db: ShelfDB;
let backend: FakeBackend;
const ctx = { me: ME };

async function queue(): Promise<{ recordId: string; tries: number; notBefore?: number }[]> {
  const row = await db.meta.get('funFactQueue');
  return row ? JSON.parse(row.value) : [];
}

/** Lets the fake's answer wait on something done while the request is out. */
function meanwhile(change: () => Promise<unknown>) {
  const real = backend.findFunFact.bind(backend);
  backend.findFunFact = async (r) => {
    const answer = await real(r);
    await change();
    return answer;
  };
}

beforeEach(async () => {
  db = new ShelfDB(`fun-facts-${crypto.randomUUID()}`);
  await db.open();
  await writeSession(db, { userId: ME, email: 'k@example.com', shelfId: SHELF });
  backend = new FakeBackend({});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

describe('wantFunFact', () => {
  it('queues a record once, however often it’s asked', async () => {
    await wantFunFact(db, A);
    await wantFunFact(db, A);
    expect(await queue()).toEqual([{ recordId: A, tries: 0 }]);
  });

  it('clears an earlier “none found”, so a re-queue starts fresh', async () => {
    await db.meta.put({ key: `funFactNone:${A}`, value: 'true' });
    await wantFunFact(db, A);
    expect(await db.meta.get(`funFactNone:${A}`)).toBeUndefined();
  });

  it('can hold a record back until a time, as a save that can still be undone does', async () => {
    await wantFunFact(db, A, { notBefore: 5_000 });
    expect(await queue()).toEqual([{ recordId: A, tries: 0, notBefore: 5_000 }]);
  });

  it('clears an earlier “couldn’t reach Claude”, too', async () => {
    await db.meta.put({ key: `funFactFailed:${A}`, value: 'true' });
    await wantFunFact(db, A);
    expect(await db.meta.get(`funFactFailed:${A}`)).toBeUndefined();
  });

  it('keeps the order records were asked in', async () => {
    await wantFunFact(db, A);
    await wantFunFact(db, B);
    expect((await queue()).map((e) => e.recordId)).toEqual([A, B]);
  });
});

describe('readFunFactQueue', () => {
  it('drops entries without a string recordId and a numeric tries', async () => {
    await db.meta.put({
      key: 'funFactQueue',
      value: JSON.stringify([{ recordId: A, tries: 1 }, { recordId: 7, tries: 0 }, { recordId: B }, null, 'x', { tries: 0 }]),
    });
    expect(await readFunFactQueue(db)).toEqual([{ recordId: A, tries: 1 }]);
  });

  it('keeps a numeric notBefore and drops any other', async () => {
    await db.meta.put({
      key: 'funFactQueue',
      value: JSON.stringify([{ recordId: A, tries: 0, notBefore: 9 }, { recordId: B, tries: 0, notBefore: 'soon' }]),
    });
    expect(await readFunFactQueue(db)).toEqual([{ recordId: A, tries: 0, notBefore: 9 }, { recordId: B, tries: 0 }]);
  });
});

describe('runFunFacts', () => {
  it('saves a found fact as one patch and takes the record off the queue', async () => {
    await db.records.put(record(A));
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    await wantFunFact(db, A);
    const after = vi.fn();
    await runFunFacts(db, backend, ctx, after);
    expect(await db.records.get(A)).toMatchObject({ funFact: FACT.fact, funFactSource: FACT.sourceUrl });
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      kind: 'record.patch',
      recordId: A,
      userId: ME,
      fields: { funFact: FACT.fact, funFactSource: FACT.sourceUrl },
    });
    expect(after).toHaveBeenCalledOnce();
    expect(await queue()).toEqual([]);
  });

  it('asks with the record’s artist, title, year and label', async () => {
    await db.records.put(record(A));
    const ask = vi.spyOn(backend, 'findFunFact');
    await wantFunFact(db, A);
    await runFunFacts(db, backend, ctx);
    expect(ask).toHaveBeenCalledWith({ artist: 'Miles Davis', title: 'Kind of Blue', year: 1959, label: 'Columbia' });
  });

  it('a fact typed while the request was out is kept, and the record leaves the queue', async () => {
    await db.records.put(record(A));
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    meanwhile(() => db.records.update(A, { funFact: 'Typed by hand.' }));
    await wantFunFact(db, A);
    await runFunFacts(db, backend, ctx);
    expect((await db.records.get(A))?.funFact).toBe('Typed by hand.');
    expect(await db.outbox.count()).toBe(0);
    expect(await queue()).toEqual([]);
  });

  it('a record deleted while the request was out gets no patch', async () => {
    await db.records.put(record(A));
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    meanwhile(() => db.records.update(A, { deletedAt: WHEN }));
    await wantFunFact(db, A);
    await runFunFacts(db, backend, ctx);
    expect((await db.records.get(A))?.funFact).toBeNull();
    expect(await db.outbox.count()).toBe(0);
    expect(await queue()).toEqual([]);
  });

  it('skips and removes a record that is missing, deleted, or already has a fact, without asking', async () => {
    await db.records.bulkPut([record(A, { deletedAt: WHEN }), record(B, { funFact: 'Already here.' })]);
    await wantFunFact(db, A);
    await wantFunFact(db, B);
    await wantFunFact(db, '55555555-5555-4555-8555-555555555555');
    await runFunFacts(db, backend, ctx);
    expect(backend.funFactCalls).toEqual([]);
    expect(await queue()).toEqual([]);
  });

  it('no fact found: notes it and takes the record off the queue', async () => {
    await db.records.put(record(A));
    await wantFunFact(db, A);
    await runFunFacts(db, backend, ctx);
    expect(await db.meta.get(`funFactNone:${A}`)).toEqual({ key: `funFactNone:${A}`, value: 'true' });
    expect(await db.outbox.count()).toBe(0);
    expect(await queue()).toEqual([]);
  });

  it('an answer the record rules refuse counts as no fact, and isn’t asked again', async () => {
    await db.records.put(record(A));
    backend.funFacts.set('Miles Davis|Kind of Blue', { fact: 'A fact.', sourceUrl: 'http://example.com' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await wantFunFact(db, A);
    await runFunFacts(db, backend, ctx);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.meta.get(`funFactNone:${A}`)).toBeDefined();
    expect(await queue()).toEqual([]);
  });

  it('offline: stops, keeps the queue, and counts no tries', async () => {
    await db.records.bulkPut([record(A), record(B, { title: 'Sketches of Spain' })]);
    backend.online = false;
    await wantFunFact(db, A);
    await wantFunFact(db, B);
    await runFunFacts(db, backend, ctx);
    expect(await queue()).toEqual([
      { recordId: A, tries: 0 },
      { recordId: B, tries: 0 },
    ]);
  });

  it('works oldest first, one record per run attempt', async () => {
    await db.records.bulkPut([record(A), record(B, { title: 'Sketches of Spain' })]);
    await wantFunFact(db, B);
    await wantFunFact(db, A);
    await runFunFacts(db, backend, ctx);
    expect(backend.funFactCalls).toEqual(['Miles Davis|Sketches of Spain', 'Miles Davis|Kind of Blue']);
  });

  it('a failure counts a try; after the second failed run the record leaves the queue', async () => {
    await db.records.put(record(A));
    backend.claudeFails = 'down';
    await wantFunFact(db, A);
    await runFunFacts(db, backend, ctx);
    expect(await queue()).toEqual([{ recordId: A, tries: 1 }]);
    await runFunFacts(db, backend, ctx);
    expect(await queue()).toEqual([]);
    expect(backend.funFactCalls).toHaveLength(2);
    expect(await db.meta.get(`funFactNone:${A}`)).toBeUndefined();
  });

  it('a record that leaves the queue after its second failed try is noted as failed', async () => {
    await db.records.put(record(A));
    backend.claudeFails = 'down';
    await wantFunFact(db, A);
    await runFunFacts(db, backend, ctx);
    expect(await db.meta.get(`funFactFailed:${A}`)).toBeUndefined();
    await runFunFacts(db, backend, ctx);
    expect(await db.meta.get(`funFactFailed:${A}`)).toEqual({ key: `funFactFailed:${A}`, value: 'true' });
  });

  it('leaves a record held back until later on the queue, unasked, and asks once the time has passed', async () => {
    await db.records.bulkPut([record(A), record(B, { title: 'Sketches of Spain' })]);
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    await wantFunFact(db, A, { notBefore: Date.now() + 60_000 });
    await wantFunFact(db, B);
    await runFunFacts(db, backend, ctx);
    expect(backend.funFactCalls).toEqual(['Miles Davis|Sketches of Spain']);
    expect((await queue()).map((e) => e.recordId)).toEqual([A]);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    await runFunFacts(db, backend, ctx);
    expect(backend.funFactCalls).toEqual(['Miles Davis|Sketches of Spain', 'Miles Davis|Kind of Blue']);
    expect((await db.records.get(A))?.funFact).toBe(FACT.fact);
  });

  it('a record undone while held back is never asked about', async () => {
    await db.records.put(record(A));
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    await wantFunFact(db, A, { notBefore: Date.now() + 9_000 });
    await runFunFacts(db, backend, ctx);
    await db.records.update(A, { deletedAt: WHEN });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9_000);
    await runFunFacts(db, backend, ctx);
    expect(backend.funFactCalls).toEqual([]);
    expect(await queue()).toEqual([]);
  });

  it('says to retry later only while a counted try leaves a record on the queue', async () => {
    await db.records.put(record(A));
    backend.claudeFails = 'down';
    await wantFunFact(db, A);
    expect(await runFunFacts(db, backend, ctx)).toEqual({ retryLater: true });
    expect(await runFunFacts(db, backend, ctx)).toEqual({ retryLater: false });
    backend.claudeFails = null;
    await wantFunFact(db, A);
    expect(await runFunFacts(db, backend, ctx)).toEqual({ retryLater: false });
  });

  it('a sign-out during the request ends the run: nothing is saved under the old identity', async () => {
    await db.records.bulkPut([record(A), record(B, { title: 'Sketches of Spain' })]);
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    backend.funFacts.set('Miles Davis|Sketches of Spain', FACT);
    meanwhile(() => writeSession(db, { userId: B, email: 'm@example.com', shelfId: SHELF }));
    await wantFunFact(db, A);
    await wantFunFact(db, B);
    await runFunFacts(db, backend, ctx);
    expect(backend.funFactCalls).toEqual(['Miles Davis|Kind of Blue']);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.records.get(A))?.funFact).toBeNull();
  });

  it('a run for someone no longer signed in asks nothing', async () => {
    await db.records.put(record(A));
    await db.meta.delete('session');
    await wantFunFact(db, A);
    await runFunFacts(db, backend, ctx);
    expect(backend.funFactCalls).toEqual([]);
    expect(await queue()).toEqual([{ recordId: A, tries: 0 }]);
  });

  it('two runs called together ask once per record', async () => {
    await db.records.bulkPut([record(A), record(B, { title: 'Sketches of Spain' })]);
    backend.funFacts.set('Miles Davis|Kind of Blue', FACT);
    await wantFunFact(db, A);
    await wantFunFact(db, B);
    await Promise.all([runFunFacts(db, backend, ctx), runFunFacts(db, backend, ctx)]);
    expect(backend.funFactCalls).toEqual(['Miles Davis|Kind of Blue', 'Miles Davis|Sketches of Spain']);
    expect(await db.outbox.count()).toBe(1);
  });

  it('a record queued during a run is worked in that run', async () => {
    await db.records.bulkPut([record(A), record(B, { title: 'Sketches of Spain' })]);
    meanwhile(() => wantFunFact(db, B));
    await wantFunFact(db, A);
    await runFunFacts(db, backend, ctx);
    expect(backend.funFactCalls).toContain('Miles Davis|Sketches of Spain');
    expect(await queue()).toEqual([]);
  });
});
