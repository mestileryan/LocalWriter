import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Version affichée dans l'app : commit court (GITHUB_SHA en CI, git en local).
const commit = process.env.GITHUB_SHA ?? (() => {
  try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'dev' }
})()

// https://vite.dev/config/
export default defineConfig({
  base: '/LocalWriter/',
  define: { __APP_VERSION__: JSON.stringify(commit.slice(0, 7)) },
  plugins: [
    react(),
    VitePWA({
      // « prompt » : la nouvelle version attend que l'utilisateur accepte (bannière), au lieu de
      // s'activer en silence et de n'être visible qu'au lancement suivant.
      registerType: 'prompt',
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png}'] },
      manifest: {
        name: 'LocalWriter',
        short_name: 'LocalWriter',
        description: 'Notes et pages imbriquées, stockées sur votre appareil.',
        lang: 'fr',
        start_url: '/LocalWriter/',
        scope: '/LocalWriter/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
