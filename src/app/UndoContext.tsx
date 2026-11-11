import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export const UNDO_WINDOW_MS = 8000;

type Offer = { label: string; undo: () => Promise<void> };
type UndoValue = { current: Offer | null; error: string | null; offer(label: string, undo: () => Promise<void>): void; run(): Promise<void> };

const UndoContext = createContext<UndoValue>({ current: null, error: null, offer() {}, async run() {} });

export function UndoProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = useRef(false);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const offer = useCallback(
    (label: string, undo: () => Promise<void>) => {
      clear();
      setError(null);
      setCurrent({ label, undo });
      timer.current = setTimeout(() => setCurrent(null), UNDO_WINDOW_MS);
    },
    [clear],
  );

  const run = useCallback(async () => {
    if (!current || running.current) return;
    running.current = true;
    clear();
    try {
      await current.undo();
      setCurrent(null);
    } catch (e) {
      // Keep the bar up so the failure is seen; it stays until the next offer replaces it.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
    }
  }, [current, clear]);

  useEffect(() => clear, [clear]);

  const value = useMemo(() => ({ current, error, offer, run }), [current, error, offer, run]);
  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>;
}

export function useUndo(): { offer(label: string, undo: () => Promise<void>): void } {
  const { offer } = useContext(UndoContext);
  return { offer };
}

export function UndoBar() {
  const { current, error, run } = useContext(UndoContext);
  if (!current) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div
        role={error ? 'alert' : 'status'}
        className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-4 rounded-xl bg-ink py-1 pr-1 pl-4 text-surface shadow-lg"
      >
        <span className="text-[15px] font-semibold">{error ?? current.label}</span>
        <Button
          variant="ghost"
          className="h-12 rounded-lg px-4 text-[15px] font-semibold text-surface hover:bg-surface/15 hover:text-surface"
          onClick={() => void run()}
        >
          Undo
        </Button>
      </div>
    </div>
  );
}
