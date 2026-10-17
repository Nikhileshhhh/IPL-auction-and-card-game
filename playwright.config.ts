import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const ORIGIN = `http://localhost:${WEB_PORT}`;
export const E2E_DB = process.env.E2E_DB_NAME ?? 'stumps_e2e';

// Fresh per-run secrets, set on process.env so workers and both servers share them.
for (const key of [
  'BFF_SIGNING_KEY',
  'CSRF_SIGNING_KEY',
  'ACCESS_CODE_PEPPER_V1',
  'ROOM_PASSWORD_PEPPER_V1',
  'INVITE_LOOKUP_HMAC_KEY',
  'DATA_ENCRYPTION_KEY_V1',
]) {
  process.env[`E2E_${key}`] ??= randomBytes(32).toString('base64url');
}
process.env.E2E_LOCAL_AUTH_JWT_SECRET ??= randomBytes(48).toString('base64url');
const secret = (key: string): string => process.env[`E2E_${key}`] ?? '';
const adminDb = new URL(
  process.env.MIGRATION_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres',
);
const runtimeDb = new URL(adminDb.toString());
runtimeDb.pathname = `/${E2E_DB}`;
runtimeDb.username = 'app_runtime';
runtimeDb.password = 'local-dev-only';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: ORIGIN, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } } },
    // Phase 16 visual review: every screen at every target size (docs/design-review.md).
    {
      name: 'visual',
      testDir: 'tests/visual',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @stumps/server build && node apps/server/dist/main.js`,
      url: `http://127.0.0.1:${API_PORT}/health/live`,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        APP_ORIGIN: ORIGIN,
        ALLOWED_ORIGINS: ORIGIN,
        DATABASE_URL: runtimeDb.toString(),
        AUTH_PROVIDER: 'local',
        LOCAL_AUTH_JWT_SECRET: process.env.E2E_LOCAL_AUTH_JWT_SECRET ?? '',
        BFF_SIGNING_KEY: secret('BFF_SIGNING_KEY'),
        ACCESS_CODE_PEPPER_V1: secret('ACCESS_CODE_PEPPER_V1'),
        ROOM_PASSWORD_PEPPER_V1: secret('ROOM_PASSWORD_PEPPER_V1'),
        INVITE_LOOKUP_HMAC_KEY: secret('INVITE_LOOKUP_HMAC_KEY'),
        DATA_ENCRYPTION_KEY_V1: secret('DATA_ENCRYPTION_KEY_V1'),
        MEDIA_DIR: '.local/e2e-media',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @stumps/web build && pnpm --filter @stumps/web exec next start --port ${WEB_PORT}`,
      url: `${ORIGIN}/access`,
      env: {
        INTERNAL_API_URL: `http://127.0.0.1:${API_PORT}`,
        APP_ORIGIN: ORIGIN,
        BFF_SIGNING_KEY: secret('BFF_SIGNING_KEY'),
        CSRF_SIGNING_KEY: secret('CSRF_SIGNING_KEY'),
        CLIENT_IP_HEADER: 'none',
        NEXT_PUBLIC_SOCKET_URL: `http://localhost:${API_PORT}`,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
