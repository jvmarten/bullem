import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

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
          id: '/',
          name: 'Bull \'Em (Dev)',
          short_name: 'Bull \'Em',
          description: 'A multiplayer bluffing card game',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          display_override: ['standalone'],
          orientation: 'portrait',
          background_color: '#1a1a2e',
          theme_color: '#1a1a2e',
          categories: ['games', 'entertainment'],
          icons: [
            { src: '/bull-logo-blue-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/bull-logo-blue-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/bull-logo-blue-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        }, null, 2));
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devBullLogo(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false, // We register manually in main.tsx
      manifest: false, // We already have site.webmanifest in public/
      injectManifest: {
        // Precache built JS/CSS chunks and static assets from public/
        globPatterns: ['**/*.{js,css,html,png,jpg,svg,ico,woff2}'],
      },
      devOptions: {
        enabled: false, // Service worker is production-only; dev uses devBullLogo plugin
      },
    }),
  ],
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
