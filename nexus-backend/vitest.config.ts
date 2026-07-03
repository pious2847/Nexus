import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // DB-gated integration tests are network-bound (Neon); allow generous timeouts.
    testTimeout: 25000,
    hookTimeout: 40000,
    // Integration tests share fixtures (e.g. the "Northern" region/"Tolon" district demo
    // data) and mutate shared subscriber/notification rows. Running test FILES in parallel
    // lets one file's temporary subscriptions leak into another's subscriber-count
    // assertions. Serialize files to keep DB-gated tests deterministic.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // Resolve the shared package to source so tests run without a build step.
      '@nexus/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
});
