import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Tests never use the developer's hosted backend from .env.local; suites
    // that need one start their own.
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Several suites start their own database (in-process or a real PostgreSQL
    // server); running at most two files at once keeps memory use within what a
    // typical development machine has free.
    maxWorkers: 2,
  },
});
