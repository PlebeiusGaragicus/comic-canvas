import type { Page } from '@playwright/test';

/**
 * Seeds the fixture project inside the page through the app's services
 * (the app exposes `window.__comicCanvas` when started with VITE_E2E=1).
 * Every test gets a fresh browser context, so this runs per test.
 */
export async function seedFixture(page: Page): Promise<{ slug: string; assetIds: string[] }> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__comicCanvas));
  return page.evaluate(() => window.__comicCanvas!.seedFixture());
}

/** Fixture plus a book and a default text model on the mocked endpoint. */
export async function seedAgentFixture(page: Page): Promise<{ slug: string; assetIds: string[] }> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__comicCanvas));
  return page.evaluate(() => window.__comicCanvas!.seedAgentFixture());
}

export const MOCK_LLM_URL = 'https://mock-llm.test/v1/chat/completions';

declare global {
  interface Window {
    __comicCanvas?: {
      seedFixture: () => Promise<{ slug: string; assetIds: string[] }>;
      seedAgentFixture: () => Promise<{ slug: string; assetIds: string[] }>;
    };
  }
}
