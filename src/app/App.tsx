import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { BootError } from '@/screens/BootError';
import { PriceCheckScreen } from '@/screens/PriceCheckScreen';
import { ShelfScreen } from '@/screens/ShelfScreen';
import { ShowScreen } from '@/screens/ShowScreen';
import { useBoot } from './useBoot';

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
  const boot = useBoot();
  const { pathname } = useLocation();
  // Read once, before useModeTheme overwrites the stored mode.
  const [startInShow, setStartInShow] = useState(() => readMode() === 'show' && pathname === '/');
  useModeTheme();

  // No band behind the status bar: iOS draws its own frosted edge over home-screen apps and picks
  // light or dark clock text from what's under it. A painted band only turns grey under that blur.
  return (
    <>
      {boot.state === 'error' ? (
        <BootError kind={boot.kind} problems={boot.problems} />
      ) : boot.state === 'loading' ? null : (
        <Routes>
          <Route
            path="/"
            element={startInShow ? <RedirectOnce to="/show" onDone={() => setStartInShow(false)} /> : <ShelfScreen />}
          />
          <Route path="/show" element={<ShowScreen />} />
          <Route path="/price/:id" element={<PriceCheckScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </>
  );
}
