import type { Page } from '@playwright/test';
import { test } from './fixtures';

/** Playwright's Linux WebKit build ships without OPFS (`navigator.storage`
 *  is undefined); real Safari 26+ and macOS WebKit have it. Skip honestly
 *  instead of failing on a browser that cannot store projects. */
async function requireOpfs(page: Page): Promise<void> {
  const supported = await page.evaluate(
    () => typeof navigator.storage?.getDirectory === 'function' && typeof FileSystemFileHandle?.prototype.createWritable === 'function',
  );
  test.skip(!supported, 'This browser build has no OPFS; the app cannot store projects here.');
}

/**
 * Seeds the fixture project inside the page through the app's services
 * (the app exposes `window.__comicCanvas` when started with VITE_E2E=1).
 * Every test gets a fresh browser context, so this runs per test.
 */
export async function seedFixture(page: Page): Promise<{ slug: string; assetIds: string[] }> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__comicCanvas));
  await requireOpfs(page);
  return page.evaluate(() => window.__comicCanvas!.seedFixture());
}

/** Fixture plus a book and a default text model on the mocked endpoint. */
export async function seedAgentFixture(page: Page): Promise<{ slug: string; assetIds: string[] }> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__comicCanvas));
  await requireOpfs(page);
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
