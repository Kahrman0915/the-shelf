import { useEffect } from 'react';

/** Fired on window once a form's unsaved mark is gone: its changes were saved, thrown away, or typed back. */
export const SAVED_OR_DISCARDED = 'shelf:saved-or-discarded';

/** How many forms are dirty right now; the page stays marked until the last one is clean. */
let dirtyMarks = 0;

/** While a form has changes nobody has saved, mark the page so a new app version waits instead of reloading it away. */
export function useUnsavedMark(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    dirtyMarks++;
    document.body.dataset.unsaved = 'true';
    return () => {
      dirtyMarks--;
      if (dirtyMarks > 0) return;
      delete document.body.dataset.unsaved;
      window.dispatchEvent(new Event(SAVED_OR_DISCARDED));
    };
  }, [dirty]);
}
