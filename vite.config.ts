import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
