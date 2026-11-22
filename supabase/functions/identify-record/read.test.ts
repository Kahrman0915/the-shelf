import { describe, expect, it } from 'vitest';
import { cleanRead, readFromMessage, readRequest, type Read } from './read.ts';

const NONE: Read = { artist: null, title: null, barcode: null, catalog: null, label: null };

describe('cleanRead', () => {
  it('strips spaces and hyphens from a barcode', () => {
    expect(cleanRead({ ...NONE, barcode: '0 25218 84312 3' }).barcode).toBe('025218843123');
    expect(cleanRead({ ...NONE, barcode: '0-25218-84312-3' }).barcode).toBe('025218843123');
  });

  it('nulls a barcode that is too short, too long or not digits', () => {
    expect(cleanRead({ ...NONE, barcode: '1234567' }).barcode).toBeNull();
    expect(cleanRead({ ...NONE, barcode: '123456789012345' }).barcode).toBeNull();
    expect(cleanRead({ ...NONE, barcode: '12345678ABC' }).barcode).toBeNull();
  });

  it('nulls a catalog number over 40 characters', () => {
    expect(cleanRead({ ...NONE, catalog: 'x'.repeat(41) }).catalog).toBeNull();
    expect(cleanRead({ ...NONE, catalog: 'x'.repeat(40) }).catalog).toBe('x'.repeat(40));
  });

  it('trims text and nulls empty or over-long text', () => {
    expect(cleanRead({ ...NONE, artist: '  Vince Guaraldi Trio ' }).artist).toBe('Vince Guaraldi Trio');
    expect(cleanRead({ ...NONE, title: '   ' }).title).toBeNull();
    expect(cleanRead({ ...NONE, label: 'x'.repeat(201) }).label).toBeNull();
  });

  it('gives all-null for a non-object', () => {
    expect(cleanRead(null)).toEqual(NONE);
    expect(cleanRead('text')).toEqual(NONE);
    expect(cleanRead([1])).toEqual(NONE);
  });

  it('ignores extra keys and non-string values', () => {
    const out = cleanRead({ ...NONE, artist: 5, extra: 'x', title: 'A' });
    expect(out).toEqual({ ...NONE, title: 'A' });
  });
});

describe('readFromMessage', () => {
  it('gives all-null for a refusal', () => {
    expect(
      readFromMessage({ stop_reason: 'refusal', content: [{ type: 'text', text: '{"artist":"A"}' }] }),
    ).toEqual(NONE);
  });

  it('gives all-null for a missing text block', () => {
    expect(readFromMessage({ stop_reason: 'end_turn', content: [] })).toEqual(NONE);
  });

  it('gives all-null for invalid JSON', () => {
    expect(readFromMessage({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nope' }] })).toEqual(NONE);
  });

  it('cleans valid JSON', () => {
    const text = JSON.stringify({ ...NONE, artist: ' Miles Davis ', barcode: '0 25218 84312 3' });
    expect(readFromMessage({ stop_reason: 'end_turn', content: [{ type: 'text', text }] })).toEqual({
      ...NONE,
      artist: 'Miles Davis',
      barcode: '025218843123',
    });
  });
});

describe('readRequest', () => {
  type Block = { type: string; source?: { data: string } };
  const blocks = (req: object) => (req as { messages: { content: Block[] }[] }).messages[0].content;

  it('puts the front image first, then the back, then text', () => {
    const c = blocks(readRequest('FRONT', 'BACK'));
    expect(c.map((b) => b.type)).toEqual(['image', 'image', 'text']);
    expect(c[0].source?.data).toBe('FRONT');
    expect(c[1].source?.data).toBe('BACK');
  });

  it('sends one image when there is no back', () => {
    expect(blocks(readRequest('FRONT', null)).map((b) => b.type)).toEqual(['image', 'text']);
  });

  it('uses Haiku 5.5 with the read schema', () => {
    const req = readRequest('F', null) as {
      model: string;
      max_tokens: number;
      output_config: { format: { type: string; schema: { required: string[] } } };
    };
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.max_tokens).toBe(1024);
    expect(req.output_config.format.type).toBe('json_schema');
    expect([...req.output_config.format.schema.required].sort()).toEqual(
      ['artist', 'barcode', 'catalog', 'label', 'title'],
    );
  });
});
