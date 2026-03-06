// Service worker for Web Push notifications.
// Plain JS — not processed by TypeScript/Vite.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }

  const title = data.title || "Bull 'Em";
  const options = {
    body: data.body || "It's your turn!",
    icon: '/icon-192x192.png',
    badge: '/favicon-32x32.png',
    data: data.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const roomCode = event.notification.data?.roomCode;
  const targetUrl = roomCode ? `/game/${roomCode}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab if one is open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          if (roomCode) {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      // Otherwise open a new tab
      return self.clients.openWindow(targetUrl);
    }),
  );
});
