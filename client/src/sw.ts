/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

// Activate new service worker immediately instead of waiting for all tabs to
// close. Without this, users see the old cached version until they close every
// tab — the exact "works in incognito but not normal browser" symptom.
self.skipWaiting();
clientsClaim();

// ─── Precache & Route ────────────────────────────────────────────────
// vite-plugin-pwa injects the precache manifest here at build time.
// This caches the app shell (HTML, JS, CSS, images) for instant offline loads.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─── Navigation fallback ────────────────────────────────────────────
// SPA: serve the cached index.html for all navigation requests so
// client-side routing works offline (especially /local/* routes).
const navigationHandler = new NetworkFirst({
  cacheName: 'navigations',
  networkTimeoutSeconds: 3,
  plugins: [
    new CacheableResponsePlugin({ statuses: [200] }),
  ],
});
registerRoute(new NavigationRoute(navigationHandler, {
  // Don't intercept API/socket/auth paths — those should hit the network
  denylist: [/^\/api\//, /^\/auth\//, /^\/socket\.io\//, /^\/health/],
}));

// ─── Google Fonts ───────────────────────────────────────────────────
// Cache font stylesheets (stale-while-revalidate) and font files (cache-first).
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'google-fonts-stylesheets' }),
);
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);

// ─── Static asset cache (images, audio) ─────────────────────────────
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);
registerRoute(
  ({ request }) => request.destination === 'audio',
  new CacheFirst({
    cacheName: 'audio',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// ─── Web Push Notifications ─────────────────────────────────────────
// Migrated from the previous standalone sw.js
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data: { title?: string; body?: string; data?: Record<string, unknown> };
  try {
    data = event.data.json();
  } catch {
    return;
  }

  const title = data.title || "Bull 'Em";
  const options: NotificationOptions = {
    body: data.body || "You have a new notification",
    icon: '/bull-logo-red-192.png',
    badge: '/bull-logo-red-32.png',
    data: data.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const roomCode = (event.notification.data as Record<string, unknown>)?.roomCode as string | undefined;
  const targetUrl = roomCode ? `/game/${roomCode}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          if (roomCode) {
            (client as WindowClient).navigate(targetUrl);
          }
          return;
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
