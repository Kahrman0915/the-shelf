import { SAVED_OR_DISCARDED } from './useUnsavedMark';

/** A form has changes nobody has saved. */
function unsaved(): boolean {
  return document.querySelector('[data-unsaved]') !== null;
}

/** A sheet or confirm dialog is on screen, or a form has unsaved changes, so the person may be halfway through something. */
function somethingOpen(): boolean {
  return unsaved() || document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * A new version of the app has taken over: reload so the person sees it.
 * Never mid-task: with a sheet or dialog open, wait until the app goes to the background.
 * Unsaved changes are never reloaded away, not even in the background: wait until they are saved or discarded,
 * then reload straight away if nothing else is open, or else the next time the app goes to the background.
 * (Saved changes are already safe in the outbox.)
 */
export function reloadWhenSafe(reload: () => void = () => window.location.reload()): void {
  if (!somethingOpen()) {
    reload();
    return;
  }
  const done = () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener(SAVED_OR_DISCARDED, onSettled);
    reload();
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden' && !unsaved()) done();
  };
  const onSettled = () => {
    if (!somethingOpen() || (document.visibilityState === 'hidden' && !unsaved())) done();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener(SAVED_OR_DISCARDED, onSettled);
}
