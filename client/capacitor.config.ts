const config = {
  appId: 'cards.bullem.app',
  appName: "Bull 'Em",
  webDir: 'dist',
  server: {
    // The native app loads from the production server so that same-origin
    // Socket.io connections and API calls work without any client code changes.
    // TODO(scale): Switch to bundled local assets once the client's socket/API
    // URLs are environment-aware (detect Capacitor and use absolute URLs).
    url: 'https://bullem.cards',
  },
};

export default config;
