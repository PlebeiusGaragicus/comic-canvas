import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 5199;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: './e2e/test-results',
  snapshotPathTemplate: '{testDir}/baselines/{arg}-{projectName}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixels: 100 },
  },
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /pwa\.spec\.ts/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } }, testIgnore: /pwa\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
    url: `http://127.0.0.1:${WEB_PORT}`,
    reuseExistingServer: !CI,
    env: { VITE_E2E: '1' },
    timeout: 30_000,
  },
});
