import { useEffect } from 'react';

/** While a form has changes nobody has saved, mark the page so a new app version waits instead of reloading it away. */
export function useUnsavedMark(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    document.body.dataset.unsaved = 'true';
    return () => {
      delete document.body.dataset.unsaved;
    };
  }, [dirty]);
}
