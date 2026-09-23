import { expect, test } from '@playwright/test';

/** Runs against `vite preview` on the production build (see playwright.pwa.config.ts). */
test('manifest, service worker, and offline reload', async ({ page, context }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = await page.evaluate(async (href) => (await fetch(href!)).json(), manifestHref);
  expect(manifest.name).toBe('Comic Canvas');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(true);

  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  // Give the precache a moment to finish before going offline.
  await page.waitForFunction(async () => (await caches.keys()).length > 0);
  await page.waitForTimeout(500);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Comic Canvas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await context.setOffline(false);
});
