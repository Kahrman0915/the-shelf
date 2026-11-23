import { describe, expect, it } from 'vitest';
import { ASK_FOR, MIN_RATED, proposalsFromMessage, ratedCount, suggestRequest, type Taste } from './taste.ts';

const TASTE: Taste = {
  members: [
    { userId: 'u1', name: 'Kahrman' },
    { userId: 'u2', name: 'Sam' },
  ],
  records: [
    { artist: 'Bill Evans', title: 'Waltz for Debby', year: 1962, section: 'Jazz', status: 'owned', ratings: [{ userId: 'u1', value: 5 }, { userId: 'u2', value: 4 }] },
    { artist: 'Metallica', title: 'Load', year: 1996, section: 'Rock', status: 'owned', ratings: [{ userId: 'u2', value: 1 }] },
    { artist: 'Miles Davis', title: 'Kind of Blue', year: 1959, section: 'Jazz', status: 'wanted', ratings: [] },
    { artist: 'Unrated', title: 'Nothing Yet', year: null, section: 'Misc', status: 'new_arrival', ratings: [] },
  ],
  suggested: [{ artist: 'Nina Simone', title: 'Pastel Blues', status: 'dismissed' }],
};

const text = (o: unknown) => ({ type: 'text', text: JSON.stringify(o) });
const msg = (content: { type: string; text?: string }[], stop_reason: string | null = 'end_turn') => ({ stop_reason, content });
const item = (over: Record<string, unknown> = {}) => ({ artist: 'Ahmad Jamal', title: 'But Not for Me', reason: 'Kahrman loved Bill Evans.', ...over });

describe('ratedCount', () => {
  it('counts records, not ratings, and ignores wanted ones', () => {
    expect(MIN_RATED).toBe(5);
    expect(ratedCount(TASTE)).toBe(2);
    const wantedRated = { ...TASTE, records: [{ ...TASTE.records[2], ratings: [{ userId: 'u1', value: 5 }] }] };
    expect(ratedCount(wantedRated)).toBe(0);
  });
});

describe('suggestRequest', () => {
  const req = suggestRequest(TASTE) as Record<string, any>;
  const prompt: string = req.messages[0].content;

  it('uses the exact model, effort, beta and fallbacks', () => {
    expect(req.model).toBe('claude-sonnet-5-5');
    expect(req.max_tokens).toBe(16000);
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(req.fallbacks).toBe('default');
    expect(req.output_config.effort).toBe('medium');
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.output_config.format.schema.required).toEqual(['suggestions']);
    expect(req.output_config.format.schema.additionalProperties).toBe(false);
  });

  it('names each member’s ratings and marks a 1 as disliked', () => {
    expect(prompt).toContain('Kahrman 5');
    expect(prompt).toContain('Sam 4');
    expect(prompt).toContain('Sam 1');
    expect(prompt).toMatch(/1 or 2 means .*disliked/);
  });

  it('lists owned, wanted and dismissed records as off-limits', () => {
    expect(prompt).toContain('Bill Evans - Waltz for Debby');
    expect(prompt).toContain('Miles Davis - Kind of Blue');
    expect(prompt).toContain('Nina Simone - Pastel Blues');
    expect(prompt).toMatch(/Never suggest/);
  });

  it('asks for 12 albums released on vinyl, with a reason of at most 140 characters', () => {
    expect(ASK_FOR).toBe(12);
    expect(prompt).toContain('Suggest 12 albums');
    expect(prompt).toContain('vinyl');
    expect(prompt).toContain('140 characters');
  });
});

describe('proposalsFromMessage', () => {
  it('reads a normal answer, trimming', () => {
    expect(proposalsFromMessage(msg([text({ suggestions: [item({ artist: '  Ahmad Jamal ' })] })]))).toEqual([item()]);
  });

  it('reads the first text block, skipping fallback and thinking blocks', () => {
    const content = [{ type: 'fallback' }, { type: 'thinking' }, text({ suggestions: [item()] })];
    expect(proposalsFromMessage(msg(content))).toEqual([item()]);
  });

  it('gives [] for a refusal, broken JSON, a missing array or no text', () => {
    expect(proposalsFromMessage(msg([text({ suggestions: [item()] })], 'refusal'))).toEqual([]);
    expect(proposalsFromMessage(msg([{ type: 'text', text: '{"suggestions": [' }]))).toEqual([]);
    expect(proposalsFromMessage(msg([text({ other: 1 })]))).toEqual([]);
    expect(proposalsFromMessage(msg([{ type: 'fallback' }]))).toEqual([]);
  });

  it('cuts a long reason at the last space within 139 characters and adds …', () => {
    const long = 'word '.repeat(30).trim(); // 149 characters
    expect(long.length).toBeGreaterThan(140);
    const [p] = proposalsFromMessage(msg([text({ suggestions: [item({ reason: long })] })]));
    expect(p.reason.length).toBeLessThanOrEqual(140);
    expect(p.reason.endsWith('word…')).toBe(true);
  });

  it('drops an item with an empty or over-long title or artist, or an empty reason', () => {
    const items = [
      item({ title: '  ' }),
      item({ artist: 'x'.repeat(201) }),
      item({ title: 'y'.repeat(201) }),
      item({ reason: '' }),
      item({ artist: 'Keeper' }),
    ];
    expect(proposalsFromMessage(msg([text({ suggestions: items })])).map((p) => p.artist)).toEqual(['Keeper']);
  });
});
