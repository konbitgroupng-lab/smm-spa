import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Several suites start their own database (in-process or a real PostgreSQL
    // server); running at most two files at once keeps memory use within what a
    // typical development machine has free.
    maxWorkers: 2,
  },
});
