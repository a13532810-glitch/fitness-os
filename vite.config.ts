import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
const base = process.env.FITNESS_BASE_PATH ?? '/';
if (!base.startsWith('/') || !base.endsWith('/'))
  throw new Error('FITNESS_BASE_PATH must begin and end with /');
export default defineConfig({
  base,
  plugins: [
    {
      name: 'fitness-build-label',
      transformIndexHtml(html) {
        return html.replace(
          '</head>',
          `<meta name="fitness-build" content="${process.env.FITNESS_BUILD_LABEL ?? '1.1.0'}" /></head>`,
        );
      },
    },
    react(),
    VitePWA({
      registerType: 'prompt',
      scope: base,
      includeAssets: ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Fitness OS · 个人训练空间',
        short_name: 'Fitness OS',
        description: '本地优先的个人训练记录',
        lang: 'zh-CN',
        id: base,
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#f4f6f3',
        theme_color: '#f4f6f3',
        icons: [
          { src: base + 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: base + 'icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: base + 'index.html',
        // Local acceptance tooling must reach the network, never the cached app shell.
        navigateFallbackDenylist: [/^\/__acceptance__(?:\/|$)/],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3000000,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: { environment: 'node', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.ts'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
