import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles/index.css';

// Register the PWA service worker for offline caching and push notifications.
// In production the build outputs sw.js with workbox precaching + push handlers.
// In development this is a no-op (the file won't exist).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      // When a new service worker activates (via skipWaiting + clientsClaim),
      // reload the page so the user gets fresh assets instead of stale cache.
      // This fires when a new deployment's SW takes control mid-session.
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      // Check for SW updates periodically — catches deployments that happen
      // while a tab is open in the background.
      setInterval(() => { registration.update(); }, 60 * 60 * 1000);
    }).catch(() => {
      // Service worker registration failed — offline caching won't be available
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
