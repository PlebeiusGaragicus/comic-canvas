import { defineConfig, devices } from '@playwright/test';

const PORT = 5198;

/** PWA smoke against the production build: `npm run test:pwa` (builds first). */
export default defineConfig({
  testDir: './e2e',
  testMatch: /pwa\.spec\.ts/,
  workers: 1,
  retries: 0,
  outputDir: './e2e/test-results-pwa',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
