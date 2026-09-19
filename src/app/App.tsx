import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { db } from '@/data/db';
import { NameScreen } from '@/screens/NameScreen';
import { PriceCheckScreen } from '@/screens/PriceCheckScreen';
import { ShelfScreen } from '@/screens/ShelfScreen';
import { ShowScreen } from '@/screens/ShowScreen';
import { SignInScreen } from '@/screens/SignInScreen';
import { useBackend } from './BackendContext';
import { CurrentShelfProvider } from './CurrentShelf';
import { SyncProvider } from './SyncContext';
import { useSession } from './useSession';

const MODE_KEY = 'shelf:mode';

function readMode(): string | null {
  try {
    return localStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
}

/** Home is midnight; show mode (search and price check) is paper. The last mode is remembered on this phone. */
function useModeTheme() {
  const { pathname } = useLocation();
  const show = pathname !== '/';
  useEffect(() => {
    if (show) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = 'midnight';
    try {
      localStorage.setItem(MODE_KEY, show ? 'show' : 'home');
    } catch {
      // Private browsing: the app still works, it just won't remember the mode.
    }
  }, [show]);
}

/** Sends the app to show mode once at startup, so tapping Home later isn't bounced back. */
function RedirectOnce({ to, onDone }: { to: string; onDone: () => void }) {
  useEffect(() => {
    onDone();
  }, [onDone]);
  return <Navigate to={to} replace />;
}

export default function App() {
  const backend = useBackend();
  const { session, verified, chooseName, retry, signOut } = useSession(backend, db);
  const { pathname } = useLocation();
  // Read once, before useModeTheme overwrites the stored mode.
  const [startInShow, setStartInShow] = useState(() => readMode() === 'show' && pathname === '/');
  useModeTheme();

  if (session.state === 'loading') return null;
  if (session.state === 'signed-out') return <SignInScreen backend={backend} onVerified={verified} />;
  if (session.state === 'needs-name') return <NameScreen onSubmit={chooseName} />;
  if (session.state === 'error') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <h1 className="font-display text-[44px] leading-[44px]">Couldn’t open your shelf</h1>
        <p className="text-ink-muted">{session.message}</p>
        <Button className="h-12 rounded-lg font-display text-[22px] tracking-[0.04em]" onClick={retry}>
          Try again
        </Button>
        <Button variant="ghost" className="h-12" onClick={() => void signOut()}>
          Sign out
        </Button>
      </main>
    );
  }

  return (
    <CurrentShelfProvider value={{ shelfId: session.shelfId, userId: session.user.userId, email: session.user.email, signOut }}>
      <SyncProvider source={backend} shelfId={session.shelfId}>
        <Routes>
          <Route
            path="/"
            element={startInShow ? <RedirectOnce to="/show" onDone={() => setStartInShow(false)} /> : <ShelfScreen />}
          />
          <Route path="/show" element={<ShowScreen />} />
          <Route path="/price/:id" element={<PriceCheckScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SyncProvider>
    </CurrentShelfProvider>
  );
}
