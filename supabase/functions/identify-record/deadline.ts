// The identify-record time budget. The app waits 30 s for an answer, and that also covers sending the
// photos, so the function answers within 26 s of the request arriving: Claude and each Discogs search
// get their usual time, or what is left of the budget if that is less. Plain TypeScript, so Vitest
// can load it.
import { DISCOGS_TIMEOUT_MS } from '../_shared/discogs.ts';

export const IDENTIFY_BUDGET_MS = 26_000;
/** Claude's reading of the sleeve, at most. */
export const CLAUDE_TIMEOUT_MS = 20_000;
/** Kept back from a Discogs search, so a search cut short still leaves time to answer. */
const ANSWER_MS = 1_000;

/** Start the clock as the request arrives: the result says how many ms of the budget are left. */
export function startBudget(now: () => number = Date.now): () => number {
  const start = now();
  return () => IDENTIFY_BUDGET_MS - (now() - start);
}

/** Claude's timeout with `left` ms of the budget left. At or below 0: no time to ask Claude. */
export const claudeTimeoutMs = (left: number): number => Math.min(CLAUDE_TIMEOUT_MS, left);

/** One Discogs search's timeout with `left` ms of the budget left. At or below 0: no time for another search. */
export const discogsTimeoutMs = (left: number): number => Math.min(DISCOGS_TIMEOUT_MS, left - ANSWER_MS);
