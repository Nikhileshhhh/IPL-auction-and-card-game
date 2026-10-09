import { defineConfig } from 'vitest/config';

const shared = { environment: 'node' as const, restoreMocks: true };

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: 'unit',
          include: [
            'packages/*/test/**/*.spec.ts',
            'apps/server/test/unit/**/*.spec.ts',
            'apps/web/test/**/*.spec.{ts,tsx}',
            'tests/unit/**/*.spec.ts',
            'tests/property/**/*.spec.ts',
          ],
        },
      },
      {
        test: {
          ...shared,
          name: 'integration',
          include: ['tests/integration/**/*.spec.ts'],
          globalSetup: ['tests/support/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          ...shared,
          name: 'security',
          include: ['tests/security/**/*.spec.ts'],
          globalSetup: ['tests/support/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          ...shared,
          name: 'concurrency',
          include: ['tests/concurrency/**/*.spec.ts'],
          globalSetup: ['tests/support/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
