import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from '@/app/App';
import { BackendProvider } from '@/app/BackendContext';
import { supabaseBackend } from '@/data/supabaseBackend';
import { BootError } from '@/screens/BootError';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/libre-franklin/400.css';
import '@fontsource/libre-franklin/600.css';
import '@fontsource/libre-franklin/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@/index.css';

let app: ReactNode;
try {
  app = (
    <BackendProvider backend={supabaseBackend()}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </BackendProvider>
  );
} catch (e) {
  // Missing configuration: say exactly what's missing instead of a blank screen.
  app = <BootError problems={[e instanceof Error ? e.message : String(e)]} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
