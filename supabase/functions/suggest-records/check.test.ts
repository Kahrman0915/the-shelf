import { describe, expect, it } from 'vitest';
import type { Answer } from '../_shared/discogs.ts';
import { checkProposals, keyOf } from './check.ts';

const P = (artist: string, title: string) => ({ artist, title, reason: 'because' });
const found = (artist: string, title: string, id = 1) => ({
  releaseId: id, artist, title, label: null, catalog: null, year: null, format: null, country: null,
  genres: ['Jazz'], styles: ['Cool Jazz'], thumb: null,
});
const ok = (...results: ReturnType<typeof found>[]): Answer => ({ status: 200, body: { results, total: results.length } });
const plenty = () => 50_000;

/** A search that answers from a queue and records its calls. */
function fakeSearch(...answers: Answer[]) {
  const calls: Record<string, string>[] = [];
  const search = async (params: Record<string, string>) => {
    calls.push(params);
    return answers.shift() ?? ok();
  };
  return { search, calls };
}

describe('keyOf', () => {
  it('is the normalised artist and title', () => {
    expect(keyOf('Sigur Rós', 'Ágætis Byrjun')).toBe('sigur ros|agaetis byrjun');
  });
});

describe('checkProposals', () => {
  it('drops an owned title in other case and accents before any search', async () => {
    const { search, calls } = fakeSearch();
    const taken = new Set([keyOf('Beyoncé', 'Lemonade')]);
    expect(await checkProposals([P('BEYONCE', 'lemonade')], taken, search, plenty)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('drops a repeat within the answer', async () => {
    const { search, calls } = fakeSearch(ok(found('A', 'T')));
    const kept = await checkProposals([P('A', 'T'), P('a', 't')], new Set(), search, plenty);
    expect(kept).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('searches vinyl by artist and title', async () => {
    const { search, calls } = fakeSearch(ok());
    await checkProposals([P('Ahmad Jamal', 'Poinciana')], new Set(), search, plenty);
    expect(calls[0]).toEqual({ q: 'Ahmad Jamal Poinciana', format: 'Vinyl' });
  });

  it('keeps a match whose Discogs artist reads "Bill Evans (2)", with its facts', async () => {
    const { search } = fakeSearch(ok(found('Someone Else', 'Other', 9), found('Bill Evans (2)', 'Waltz for Debby', 42)));
    const kept = await checkProposals([P('Bill Evans', 'Waltz for Debby')], new Set(), search, plenty);
    expect(kept).toEqual([{ ...P('Bill Evans', 'Waltz for Debby'), discogsReleaseId: 42, discogsGenres: ['Jazz'], discogsStyles: ['Cool Jazz'] }]);
  });

  it('also strips * from the Discogs artist', async () => {
    const { search } = fakeSearch(ok(found('Bill Evans*', 'Waltz for Debby', 7)));
    expect(await checkProposals([P('Bill Evans', 'Waltz for Debby')], new Set(), search, plenty)).toHaveLength(1);
  });

  it('drops a suggestion with no matching result', async () => {
    const { search } = fakeSearch(ok(found('Bill Evans', 'Another Album')));
    expect(await checkProposals([P('Bill Evans', 'Waltz for Debby')], new Set(), search, plenty)).toEqual([]);
  });

  it('stops at keep', async () => {
    const ps = [P('A', '1'), P('B', '2'), P('C', '3')];
    const { search, calls } = fakeSearch(ok(found('A', '1')), ok(found('B', '2')), ok(found('C', '3')));
    expect(await checkProposals(ps, new Set(), search, plenty, 2)).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it('returns what it kept when a search answers 429', async () => {
    const ps = [P('A', '1'), P('B', '2'), P('C', '3'), P('D', '4')];
    const { search, calls } = fakeSearch(ok(found('A', '1')), ok(found('B', '2')), { status: 429, body: {} }, ok(found('D', '4')));
    expect((await checkProposals(ps, new Set(), search, plenty)).map((k) => k.artist)).toEqual(['A', 'B']);
    expect(calls).toHaveLength(3);
  });

  it('makes no search with no time left', async () => {
    const { search, calls } = fakeSearch(ok(found('A', '1')));
    expect(await checkProposals([P('A', '1')], new Set(), search, () => 900)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
