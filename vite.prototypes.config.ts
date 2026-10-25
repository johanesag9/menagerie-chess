import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Builds the Phase 0 world prototypes into prototypes/dist (served as static files).
export default defineConfig({
  root: resolve(__dirname, 'prototypes'),
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'prototypes/index.html'),
        a: resolve(__dirname, 'prototypes/a-shoreline/index.html'),
        b: resolve(__dirname, 'prototypes/b-whale/index.html'),
        c: resolve(__dirname, 'prototypes/c-giant-table/index.html'),
      },
    },
  },
});
