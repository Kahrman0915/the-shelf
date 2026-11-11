import { createContext, useContext, type ReactNode } from 'react';

export type CurrentShelf = {
  shelfId: string;
  userId: string;
  email: string;
  /** Sends waiting changes, then signs out; if some couldn't be sent, returns how many and stays signed in. */
  signOut: () => Promise<{ unsent: number } | null>;
  /** Signs out and clears the phone, unsent changes included. */
  signOutAndDelete: () => Promise<void>;
};

const CurrentShelfContext = createContext<CurrentShelf | null>(null);

export function CurrentShelfProvider({ value, children }: { value: CurrentShelf; children: ReactNode }) {
  return <CurrentShelfContext.Provider value={value}>{children}</CurrentShelfContext.Provider>;
}

export function useCurrentShelf(): CurrentShelf {
  const shelf = useContext(CurrentShelfContext);
  if (!shelf) throw new Error('useCurrentShelf() needs a signed-in shelf around it.');
  return shelf;
}
