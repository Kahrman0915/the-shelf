import { addFunFact, perform } from './actions';
import { BackendError, NO_SIGNAL, type Backend } from './backend';
import type { ShelfDB } from './db';
import type { NewPostcard } from './outbox';

/** The meta key holding the records waiting for a fun fact, oldest first. */
export const FUN_FACT_QUEUE = 'funFactQueue';
/** Meta `funFactNone:{recordId}` = 'true': the last search found no fact with a source. */
export const FUN_FACT_NONE_PREFIX = 'funFactNone:';

export type FunFactWanted = { recordId: string; tries: number };

/** A record is tried this many times automatically; after that it's left for the button. */
const MAX_TRIES = 2;

export async function readFunFactQueue(db: ShelfDB): Promise<FunFactWanted[]> {
  const row = await db.meta.get(FUN_FACT_QUEUE);
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed) ? (parsed as FunFactWanted[]) : [];
  } catch {
    return [];
  }
}

/** Change the queue in one transaction, so a record queued meanwhile isn't lost. */
async function changeQueue(db: ShelfDB, change: (queue: FunFactWanted[]) => FunFactWanted[], also?: () => Promise<unknown>): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const next = change(await readFunFactQueue(db));
    await db.meta.put({ key: FUN_FACT_QUEUE, value: JSON.stringify(next) });
    await also?.();
  });
}

const without = (recordId: string) => (queue: FunFactWanted[]) => queue.filter((e) => e.recordId !== recordId);

/** Put a record on the fun-fact queue, unless it's already there. */
export async function wantFunFact(db: ShelfDB, recordId: string): Promise<void> {
  await changeQueue(db, (queue) => (queue.some((e) => e.recordId === recordId) ? queue : [...queue, { recordId, tries: 0 }]));
}

/** The last fun-fact run started on each phone's notebook. */
const runs = new WeakMap<ShelfDB, Promise<unknown>>();

/**
 * Work the fun-fact queue oldest first, one record at a time, each tried once per run.
 * A found fact is saved only if the record is still there, not deleted, and still has no fact.
 * No signal stops the run and keeps the rest for next time. Runs on one notebook never overlap,
 * so a record is never asked about twice at once.
 */
export function runFunFacts(db: ShelfDB, backend: Pick<Backend, 'findFunFact'>, ctx: { me: string }, after?: () => void): Promise<void> {
  const go = () => funFactRun(db, backend, ctx, after);
  const run = (runs.get(db) ?? Promise.resolve()).then(go, go);
  runs.set(db, run);
  return run;
}

async function funFactRun(db: ShelfDB, backend: Pick<Backend, 'findFunFact'>, ctx: { me: string }, after?: () => void): Promise<void> {
  const tried = new Set<string>();
  for (;;) {
    // Read the queue fresh each time, so a record queued during the run is seen.
    const next = (await readFunFactQueue(db)).find((e) => !tried.has(e.recordId));
    if (!next) return;
    const { recordId } = next;
    tried.add(recordId);

    const record = await db.records.get(recordId);
    if (!record || record.deletedAt !== null || record.funFact !== null) {
      await changeQueue(db, without(recordId));
      continue;
    }

    let found: { fact: string; sourceUrl: string } | null;
    try {
      found = await backend.findFunFact({ artist: record.artist, title: record.title, year: record.year, label: record.label });
    } catch (e) {
      if (e instanceof BackendError && e.message === NO_SIGNAL) return;
      if (!(e instanceof BackendError)) console.error(e);
      await changeQueue(db, (queue) =>
        queue.flatMap((w) => (w.recordId !== recordId ? [w] : w.tries + 1 >= MAX_TRIES ? [] : [{ ...w, tries: w.tries + 1 }])),
      );
      continue;
    }

    // The answer can take a while: the fact may have been typed, or the record deleted (or undone), meanwhile.
    const now = await db.records.get(recordId);
    const wanted = now && now.deletedAt === null && now.funFact === null ? now : null;
    let postcards: NewPostcard[] | null = null;
    if (found !== null && wanted) {
      try {
        postcards = addFunFact(wanted, found, { me: ctx.me, now: new Date().toISOString() }).postcards;
      } catch (e) {
        // An answer the record rules refuse is no fact; asking again would only get the same answer.
        if (!(e instanceof BackendError)) throw e;
        console.warn('A fun fact didn’t fit the record rules:', e.name);
        found = null;
      }
    }
    if (postcards) await perform(db, postcards, after);
    const noteNone = () => db.meta.put({ key: `${FUN_FACT_NONE_PREFIX}${recordId}`, value: 'true' });
    await changeQueue(db, without(recordId), found === null ? noteNone : undefined);
  }
}
