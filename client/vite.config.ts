import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function devBullLogo(): Plugin {
  return {
    name: 'dev-bull-logo',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/bull-logo-red/g, 'bull-logo-blue');
    },
    configureServer(server) {
      server.middlewares.use('/site.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(JSON.stringify({
          name: 'Bull \'Em (Dev)',
          short_name: 'Bull \'Em',
          description: 'A multiplayer bluffing card game',
          start_url: '/',
          display: 'standalone',
          background_color: '#1a1a2e',
          theme_color: '#1a1a2e',
          icons: [
            { src: '/bull-logo-blue-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/bull-logo-blue-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/bull-logo-blue-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        }, null, 2));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devBullLogo()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/auth': {
        target: 'http://localhost:3001',
      },
      '/api': {
        target: 'http://localhost:3001',
      },
      '/health': {
        target: 'http://localhost:3001',
      },
    },
  },
});
