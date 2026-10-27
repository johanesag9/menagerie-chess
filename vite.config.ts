/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  server: { host: true },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  // Stream worktrees live under .claude/worktrees; don't run their copies of the tests.
  test: { exclude: [...configDefaults.exclude, '.claude/**', 'steam-scrape/**'] },
});
