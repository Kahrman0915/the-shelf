import { describe, expect, it } from 'vitest';
import { normalise as app } from '../../../src/domain/search.ts';
import { normalise } from './normalise.ts';

const TRICKY = [
  'Björk',
  'Sigur Rós',
  'Mötley Crüe',
  'Æon Flux',
  'ÆTHER',
  'Beyoncé',
  'AC/DC',
  'Guns N’ Roses',
  "Guns N' Roses",
  '  Bill   Evans  ',
  'Sgt. Pepper’s Lonely Hearts Club Band',
  'ＡＢＣ１２３',
  '!!!',
  '',
  'Ça ira — 東京',
];

describe('the shared normalise', () => {
  it('agrees with the app’s on tricky strings', () => {
    for (const s of TRICKY) expect(normalise(s)).toBe(app(s));
  });

  it('folds case, accents, æ and punctuation', () => {
    expect(normalise('  Æon  BJÖRK! ')).toBe('aeon bjork');
  });
});
