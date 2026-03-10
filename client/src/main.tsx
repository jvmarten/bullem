import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles/index.css';

// Register the PWA service worker for offline caching and push notifications.
// In production the build outputs sw.js with workbox precaching + push handlers.
// In development this is a no-op (the file won't exist).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker registration failed — offline caching won't be available
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
