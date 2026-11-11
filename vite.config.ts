import { defineConfig, type Plugin } from 'vite';

// Content-Security-Policy for the built site. GitHub Pages can't send headers, so it goes in a
// <meta> tag. Scripts only come from the site itself, so even if a name from crowd-edited data
// slipped past escaping it couldn't run code. Map tiles, terrain, satellite imagery and photos come
// from several HTTPS hosts, hence the https: sources for images and fetches. MapLibre starts its
// workers from blob: URLs. Added on build only: the dev server needs inline scripts and websockets.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' data: blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'atlas-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

// `base` is relative so the built site works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [csp()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2500 },
  // In the dev container, edits made on the Windows side don't raise file events inside Linux,
  // so poll there (set in .devcontainer/devcontainer.json).
  server: process.env.ATLAS_WATCH_POLL ? { watch: { usePolling: true, interval: 300 } } : {},
});
