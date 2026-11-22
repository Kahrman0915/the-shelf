import { describe, expect, it } from 'vitest';
import { cleanFactInput, factFromMessage, factRequest, searchUrls } from './fact.ts';

const GOOD = { artist: 'Vince Guaraldi Trio', title: 'A Charlie Brown Christmas', year: 1965, label: 'Fantasy' };

const results = (...urls: string[]) => ({
  type: 'web_search_tool_result',
  content: urls.map((url) => ({ type: 'web_search_result', url, title: 't' })),
});
const answer = (o: unknown) => ({ type: 'text', text: JSON.stringify(o) });
const msg = (content: { type: string; text?: string; content?: unknown }[], stop_reason: string | null = 'end_turn') => ({
  stop_reason,
  content,
});
const SRC = 'https://example.com/story';

describe('cleanFactInput', () => {
  it('cleans good input', () => {
    expect(cleanFactInput({ ...GOOD, artist: '  Vince Guaraldi Trio ' })).toEqual(GOOD);
  });

  it('refuses a missing title or artist', () => {
    expect(cleanFactInput({ ...GOOD, title: '' })).toBeNull();
    expect(cleanFactInput({ artist: 'x', year: 1965, label: null })).toBeNull();
    expect(cleanFactInput({ ...GOOD, artist: 'x'.repeat(201) })).toBeNull();
    expect(cleanFactInput(null)).toBeNull();
  });

  it('nulls a year outside 1900-2100 and a blank or long label', () => {
    expect(cleanFactInput({ ...GOOD, year: 1850 })?.year).toBeNull();
    expect(cleanFactInput({ ...GOOD, year: 1965.5 })?.year).toBeNull();
    expect(cleanFactInput({ ...GOOD, label: 'x'.repeat(201) })?.label).toBeNull();
    expect(cleanFactInput({ ...GOOD, label: undefined })?.label).toBeNull();
  });
});

describe('factRequest', () => {
  it('uses Haiku 5.5 with the web search tool capped at 3 uses', () => {
    const r = factRequest(GOOD) as Record<string, unknown>;
    expect(r.model).toBe('claude-haiku-5-5');
    expect(r.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
    expect(JSON.stringify(r)).toContain('A Charlie Brown Christmas');
  });
});

describe('searchUrls', () => {
  it('collects every result url', () => {
    expect([...searchUrls([results('https://a.com/1', 'https://b.com/2')])]).toEqual(['https://a.com/1', 'https://b.com/2']);
  });

  it('gives nothing for an error-object block', () => {
    const err = { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } };
    expect(searchUrls([err]).size).toBe(0);
  });
});

describe('factFromMessage', () => {
  it('returns a fact whose source the search returned', () => {
    const m = msg([results(SRC), answer({ fact: ' A fact. ', sourceUrl: SRC })]);
    expect(factFromMessage(m)).toEqual({ fact: 'A fact.', sourceUrl: SRC });
  });

  it('reads the last text block', () => {
    const m = msg([results(SRC), { type: 'text', text: 'Searching...' }, answer({ fact: 'A fact.', sourceUrl: SRC })]);
    expect(factFromMessage(m)?.fact).toBe('A fact.');
  });

  it('refuses a source the search did not return', () => {
    const m = msg([results(SRC), answer({ fact: 'A fact.', sourceUrl: 'https://invented.com/x' })]);
    expect(factFromMessage(m)).toBeNull();
  });

  it('refuses a source when the search failed', () => {
    const err = { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'x' } };
    expect(factFromMessage(msg([err, answer({ fact: 'A fact.', sourceUrl: SRC })]))).toBeNull();
  });

  it('refuses an http source', () => {
    const http = 'http://example.com/story';
    expect(factFromMessage(msg([results(http), answer({ fact: 'A fact.', sourceUrl: http })]))).toBeNull();
  });

  it('refuses a 301-character fact and accepts 300', () => {
    expect(factFromMessage(msg([results(SRC), answer({ fact: 'x'.repeat(301), sourceUrl: SRC })]))).toBeNull();
    expect(factFromMessage(msg([results(SRC), answer({ fact: 'x'.repeat(300), sourceUrl: SRC })]))?.fact).toHaveLength(300);
  });

  it('refuses a refusal, a missing text block, bad JSON and a null fact', () => {
    expect(factFromMessage(msg([results(SRC), answer({ fact: 'A fact.', sourceUrl: SRC })], 'refusal'))).toBeNull();
    expect(factFromMessage(msg([results(SRC)]))).toBeNull();
    expect(factFromMessage(msg([results(SRC), { type: 'text', text: 'not json' }]))).toBeNull();
    expect(factFromMessage(msg([results(SRC), answer({ fact: null, sourceUrl: null })]))).toBeNull();
  });
});
