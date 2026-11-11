import { describe, expect, it } from 'vitest';
import { isShowPath } from './routes';

describe('isShowPath', () => {
  it('is paper for show mode only', () => {
    expect(isShowPath('/show')).toBe(true);
    expect(isShowPath('/price/abc')).toBe(true);
    expect(isShowPath('/')).toBe(false);
    expect(isShowPath('/arrivals')).toBe(false);
    expect(isShowPath('/record/abc')).toBe(false);
    expect(isShowPath('/settings')).toBe(false);
  });
});
