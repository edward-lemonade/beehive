import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', 'dist/**', 'test/live/**'],
    setupFiles: ['./test/setup.ts'],
  },
});
