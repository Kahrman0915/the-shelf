import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadWhenSafe } from './updates';
import { SAVED_OR_DISCARDED } from './useUnsavedMark';

/** What useUnsavedMark does when a form's changes are saved or thrown away. */
function savedOrDiscarded() {
  delete document.body.dataset.unsaved;
  window.dispatchEvent(new Event(SAVED_OR_DISCARDED));
}

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

  it('never reloads unsaved changes away, even in the background; reloads once they are saved or discarded', () => {
    document.body.dataset.unsaved = 'true';
    const reload = vi.fn();
    reloadWhenSafe(reload);
    expect(reload).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(reload).not.toHaveBeenCalled();
    setVisibility('visible');

    savedOrDiscarded();
    expect(reload).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    savedOrDiscarded();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('with the changes gone but a dialog still open, waits for the next time the app goes to the background', () => {
    document.body.dataset.unsaved = 'true';
    const reload = vi.fn();
    reloadWhenSafe(reload);
    document.body.innerHTML = '<div role="alertdialog">Delete Kind of Blue?</div>';
    savedOrDiscarded();
    expect(reload).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a hide while unsaved, then the changes are discarded in the background, reloads on that discard', () => {
    document.body.dataset.unsaved = 'true';
    const reload = vi.fn();
    reloadWhenSafe(reload);
    setVisibility('hidden');
    expect(reload).not.toHaveBeenCalled();
    savedOrDiscarded();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
