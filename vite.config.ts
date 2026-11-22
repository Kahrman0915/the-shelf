/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { onlyJavaScript } from './src/photo/opencvCache';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: 'The Shelf',
        short_name: 'The Shelf',
        description: 'What you own, what it’s worth, what to play tonight.',
        theme_color: '#111a26',
        background_color: '#111a26',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        // OpenCV (~10 MB) isn't part of the install: it's fetched when the camera is first used, then kept.
        globIgnores: ['**/opencv*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/opencv[^/]*\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'opencv', expiration: { maxEntries: 2 }, plugins: [onlyJavaScript] },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // PGlite boots a whole Postgres per test file; under a full parallel run the defaults (5s/10s) can time out.
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // OpenCV.js exports an Emscripten Module with a `then` method. Vitest's default CJS interop exposes
    // it on the import's namespace, which makes the import itself loop forever (see src/photo/loadCv.ts).
    deps: { interopDefault: false },
  },
});
