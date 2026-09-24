import { defineConfig, devices } from '@playwright/test';

export const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);
export const BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * End-to-end tests against the real stack: the global setup starts PostgreSQL (with the
 * production role split) and the built API, which serves the built web app.
 * Run `pnpm build` first.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
