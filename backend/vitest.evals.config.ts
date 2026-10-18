import { defineConfig } from 'vitest/config';

// LLM-graded evals: real model calls, run several times per case and scored by pass rate. Not part of `npm test`.
export default defineConfig({
  test: {
    include: ['test/evals/**/*.eval.ts'],
    setupFiles: ['./test/evals/setup.ts'],
    testTimeout: 600_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
