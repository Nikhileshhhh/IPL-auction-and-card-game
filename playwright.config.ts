import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } } },
  ],
  webServer: [
    {
      command: `pnpm --filter @stumps/server build && node apps/server/dist/main.js`,
      url: `http://127.0.0.1:${API_PORT}/health/live`,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        APP_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @stumps/web build && pnpm --filter @stumps/web exec next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/access`,
      env: {
        INTERNAL_API_URL: `http://127.0.0.1:${API_PORT}`,
        APP_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
