import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', 'dist/**', 'test/live/**', 'test/evals/**'],
    setupFiles: ['./test/setup.ts'],
  },
});
