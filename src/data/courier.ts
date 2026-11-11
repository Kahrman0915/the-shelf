import { BackendError, NO_SIGNAL, REJECTED, type ShelfSource, type ShelfWriter } from './backend';
import type { ShelfDB } from './db';
import type { Postcard } from './outbox';
import { newRecordToRow, patchToRow } from './rowMapping';
import { forgetLastPull, pullShelf } from './sync';

export type PushResult = { sent: number; rejected: number; noSignal: boolean };

/** Sends one postcard. Every send is safe to repeat. Returns 'missing' when a patch found no record. */
async function send(writer: ShelfWriter, p: Postcard): Promise<'sent' | 'missing'> {
  switch (p.kind) {
    case 'record.create':
      await writer.insertRecord(newRecordToRow(p.fields));
      return 'sent';
    case 'record.patch':
      return (await writer.patchRecord(p.recordId, patchToRow(p.fields))) === 'missing' ? 'missing' : 'sent';
    case 'rating.set':
      await writer.setRating(p.recordId, p.userId, p.fields.value);
      return 'sent';
  }
}

/** The last push run started on each phone's notebook. */
const runs = new WeakMap<ShelfDB, Promise<unknown>>();

/**
 * The courier's drop-off run: send waiting postcards oldest first, one at a time.
 * A record with a rejected postcard is held: its later postcards may depend on the rejected one.
 * No signal stops the run and keeps everything for next time.
 * Runs on one notebook never overlap (sync, sign-out, anyone): an overlapping run could resend an
 * older change after a newer one had landed. A run waits for the one before it, failed or not.
 */
export function pushOutbox(db: ShelfDB, writer: ShelfWriter): Promise<PushResult> {
  const go = () => pushRun(db, writer);
  const run = (runs.get(db) ?? Promise.resolve()).then(go, go);
  runs.set(db, run);
  return run;
}

async function pushRun(db: ShelfDB, writer: ShelfWriter): Promise<PushResult> {
  const result: PushResult = { sent: 0, rejected: 0, noSignal: false };
  const held = new Set((await db.outbox.where('state').equals('rejected').toArray()).map((p) => p.recordId));
  let after = 0;

  for (;;) {
    // Read the next postcard fresh each time, so one added or discarded during the run is seen.
    const p = await db.outbox
      .where('seq')
      .above(after)
      .filter((q) => q.state === 'waiting' && !held.has(q.recordId))
      .first();
    if (!p) return result;
    after = p.seq;

    let reason: string;
    try {
      if ((await send(writer, p)) === 'sent') {
        await db.outbox.delete(p.seq);
        result.sent++;
        continue;
      }
      reason = REJECTED.missing;
    } catch (e) {
      if (e instanceof BackendError && e.message === NO_SIGNAL) return { ...result, noSignal: true };
      reason = e instanceof Error ? e.message : String(e);
    }
    await db.outbox.update(p.seq, { state: 'rejected', reason });
    held.add(p.recordId);
    result.rejected++;
  }
}

/** Push; then, unless the push stopped for no signal, pull. Pull errors are thrown. */
export async function syncOnce(db: ShelfDB, backend: ShelfSource & ShelfWriter, shelfId: string): Promise<PushResult> {
  const result = await pushOutbox(db, backend);
  if (!result.noSignal) await pullShelf(db, backend, shelfId);
  return result;
}

/** Put a rejected postcard back in line; the next run sends it. */
export async function retryPostcard(db: ShelfDB, seq: number): Promise<void> {
  await db.outbox.update(seq, { state: 'waiting', reason: null });
}

/** Delete this postcard and every later one for the same record, forget the last pull, pull everything. */
export async function discardPostcard(db: ShelfDB, source: ShelfSource, shelfId: string, seq: number): Promise<void> {
  await db.transaction('rw', [db.records, db.ratings, db.meta, db.outbox], async () => {
    const p = await db.outbox.get(seq);
    if (!p) return;
    const dropped = await db.outbox
      .where('recordId')
      .equals(p.recordId)
      .filter((q) => q.seq >= seq)
      .toArray();
    await db.outbox.bulkDelete(dropped.map((q) => q.seq));
    // A record made only on this phone has nothing on the server to restore it; the pull below
    // brings it back if the server does have it after all.
    if (dropped.some((q) => q.kind === 'record.create')) {
      await db.records.delete(p.recordId);
      await db.ratings.where('recordId').equals(p.recordId).delete();
    }
    await forgetLastPull(db, shelfId);
  });
  await pullShelf(db, source, shelfId);
}
