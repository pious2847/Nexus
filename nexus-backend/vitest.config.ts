import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // DB-gated integration tests are network-bound (Neon); allow generous timeouts.
    testTimeout: 25000,
    hookTimeout: 40000,
  },
  resolve: {
    alias: {
      // Resolve the shared package to source so tests run without a build step.
      '@nexus/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
});
