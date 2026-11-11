import { describe, expect, it } from 'vitest';
import { posterPlan, posterSeed } from './poster';

describe('posterPlan', () => {
  it('the same words draw the same poster', () => {
    expect(posterPlan('John Coltrane', 'Ballads', 'jazz')).toEqual(posterPlan('John Coltrane', 'Ballads', 'jazz'));
    // The drawing is the same; only the lettering shows the words as typed.
    expect(posterPlan('John Coltrane', 'Ballads', 'jazz').shapes).toEqual(posterPlan('john coltrane!', 'ballads', 'jazz').shapes);
    expect(posterSeed('John Coltrane', 'Ballads')).toBe(posterSeed('john  COLTRANE', 'Ballads!'));
  });
  it('different titles draw different posters', () => {
    expect(posterPlan('John Coltrane', 'Ballads', 'jazz')).not.toEqual(posterPlan('John Coltrane', 'Blue Train', 'jazz'));
  });
  it('rock never gets a brick accent', () => {
    for (let i = 0; i < 200; i++) {
      const accents = posterPlan(`artist ${i}`, `title ${i}`, 'rock').shapes.filter((s) => s.role === 'accent');
      expect(accents).toHaveLength(2);
      expect(accents.some((s) => s.fill === 'var(--brick)')).toBe(false);
    }
  });
  it('pop/soul never gets a bourbon accent', () => {
    for (let i = 0; i < 200; i++) {
      const accents = posterPlan(`artist ${i}`, `title ${i}`, 'popsoul').shapes.filter((s) => s.role === 'accent');
      expect(accents).toHaveLength(2);
      expect(accents.some((s) => s.fill === 'var(--bourbon)')).toBe(false);
    }
  });
  it('the genre circle uses the genre colour', () => {
    const genre = posterPlan('Bob Marley', 'Exodus', 'reggae').shapes.find((s) => s.role === 'genre');
    expect(genre).toMatchObject({ type: 'circle', fill: 'var(--genre-reggae)' });
  });
  it('a very long artist name stays inside the band', () => {
    const plan = posterPlan('A'.repeat(60), 'Title', 'misc');
    expect(plan.artist.size).toBe(18);
    expect(plan.artist.text).toHaveLength(35);
    expect(plan.artist.text.endsWith('…')).toBe(true);
  });
  it('a short artist name is set large, capped at 40', () => {
    const plan = posterPlan('Yes', 'Fragile', 'rock');
    expect(plan.artist).toEqual({ text: 'YES', size: 40 });
  });
  it('a long title is cut at 40', () => {
    expect(posterPlan('X', 'T'.repeat(41), 'misc').title).toBe('T'.repeat(39) + '…');
    expect(posterPlan('X', 'T'.repeat(40), 'misc').title).toBe('T'.repeat(40));
  });
  it('draws the skyline across the full width, above the band', () => {
    const plan = posterPlan('Miles Davis', 'Kind of Blue', 'jazz');
    const sky = plan.shapes.filter((s) => s.role === 'sky');
    expect(sky.length).toBeGreaterThan(5);
    expect(plan.shapes.some((s) => s.role === 'window')).toBe(true);
  });
});
