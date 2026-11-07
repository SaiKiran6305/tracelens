import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

const root = createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
});

// Establish an example-only workspace before concurrent example queries race to set its cookie.
async function bootstrap() {
  try {
    if (/^\/(examples|journeys|runs|compare|demo)(\/|$)/.test(location.pathname)) {
      await fetch(`${import.meta.env.BASE_URL}api/journeys`, { credentials: 'same-origin' });
    }
  } catch (error) {
    console.error("Recorder connection unavailable; the app will show connection errors.", error);
  }
  root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
  );
}
void bootstrap();
