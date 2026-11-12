import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadWhenSafe } from './updates';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  document.body.innerHTML = '';
  delete document.body.dataset.unsaved;
  setVisibility('visible');
});

describe('reloadWhenSafe', () => {
  it('reloads straight away when nothing is open', () => {
    const reload = vi.fn();
    reloadWhenSafe(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits while a sheet is open, then reloads once the app goes to the background', () => {
    document.body.innerHTML = '<div role="dialog">Bought it</div>';
    const reload = vi.fn();
    reloadWhenSafe(reload);
    expect(reload).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    setVisibility('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('also waits for a confirm dialog', () => {
    document.body.innerHTML = '<div role="alertdialog">Sign out?</div>';
    const reload = vi.fn();
    reloadWhenSafe(reload);
    expect(reload).not.toHaveBeenCalled();
  });

  it('waits while a form has unsaved changes', () => {
    document.body.dataset.unsaved = 'true';
    const reload = vi.fn();
    reloadWhenSafe(reload);
    expect(reload).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
