import { createContext, useContext, type ReactNode } from 'react';

export type CurrentShelf = { shelfId: string; userId: string; email: string; signOut: () => Promise<void> };

const CurrentShelfContext = createContext<CurrentShelf | null>(null);

export function CurrentShelfProvider({ value, children }: { value: CurrentShelf; children: ReactNode }) {
  return <CurrentShelfContext.Provider value={value}>{children}</CurrentShelfContext.Provider>;
}

export function useCurrentShelf(): CurrentShelf {
  const shelf = useContext(CurrentShelfContext);
  if (!shelf) throw new Error('useCurrentShelf() needs a signed-in shelf around it.');
  return shelf;
}
