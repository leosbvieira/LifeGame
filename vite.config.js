import { defineConfig } from 'vite';

// VOIDRIFT is WebGPU-only. No legacy targets, no polyfills.
export default defineConfig({
  root: '.',
  base: './',
  build: {
    target: 'esnext',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    host: true,
    port: 5173,
  },
});
