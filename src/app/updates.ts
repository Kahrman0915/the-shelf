/** A sheet or confirm dialog is on screen, or a form has unsaved changes, so the person may be halfway through something. */
function somethingOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"], [data-unsaved]') !== null;
}

/**
 * A new version of the app has taken over: reload so the person sees it.
 * Never mid-task: with a sheet, dialog or unsaved form open, wait until the app goes to the background.
 * (Saved changes are already safe in the outbox; this only protects half-typed input.)
 */
export function reloadWhenSafe(reload: () => void = () => window.location.reload()): void {
  if (!somethingOpen()) {
    reload();
    return;
  }
  const onHide = () => {
    if (document.visibilityState !== 'hidden') return;
    document.removeEventListener('visibilitychange', onHide);
    reload();
  };
  document.addEventListener('visibilitychange', onHide);
}
