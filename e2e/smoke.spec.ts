import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedFixture } from './seed';

/** Console messages that are known noise and safe to ignore. Keep empty unless justified. */
const CONSOLE_ERROR_ALLOWLIST: RegExp[] = [];

const errors: string[] = [];

/** Screenshot baselines are a local macOS gate; CI runs the walk and the console assertion only. */
const COMPARE_SCREENSHOTS = !process.env.CI;

async function checkScreenshot(page: Page, name: string): Promise<void> {
  if (!COMPARE_SCREENSHOTS) return;
  await expect(page).toHaveScreenshot(name);
}

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (CONSOLE_ERROR_ALLOWLIST.some((pattern) => pattern.test(message.text()))) return;
    errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    errors.push(String(error));
  });
  await seedFixture(page);
});

test.afterEach(() => {
  expect(errors, 'no console/page errors').toEqual([]);
});

async function openFixtureProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'E2E Fixture', exact: true }).click();
  await expect(page.locator('.project-phase-sidebar')).toBeVisible();
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.dataset.appReady === 'true');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((image) => !image.complete)
        .map((image) => new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        })),
    );
  });
  await page.waitForTimeout(400);
}

test('landing shows the fixture project', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'E2E Fixture', exact: true })).toBeVisible();
  await settle(page);
  await checkScreenshot(page, 'landing.png');
});

test('story view', async ({ page }) => {
  await openFixtureProject(page);
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  await expect(page.locator('.canvas')).toBeVisible();
  await settle(page);
  await checkScreenshot(page, 'story.png');
});

test('layout view', async ({ page }) => {
  await openFixtureProject(page);
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await settle(page);
  await checkScreenshot(page, 'layout.png');
});

test('canvas view with node sidebar interaction', async ({ page }) => {
  await openFixtureProject(page);
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
  await settle(page);
  // One real interaction: open a node's image viewer, then close it with Escape.
  await page.locator('.image-group-node').first().click();
  await expect(page.locator('.image-viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.image-viewer')).toHaveCount(0);
  await page.locator('.react-flow__pane').click({ position: { x: 60, y: 60 } });
  await settle(page);
  await checkScreenshot(page, 'canvas.png');
});

test('concept art view', async ({ page }) => {
  await openFixtureProject(page);
  await page.getByRole('button', { name: 'Concept Art', exact: true }).click();
  await settle(page);
  await checkScreenshot(page, 'concept-art.png');
});

test('characters view', async ({ page }) => {
  await openFixtureProject(page);
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await settle(page);
  await checkScreenshot(page, 'characters.png');
});

test('locations view', async ({ page }) => {
  await openFixtureProject(page);
  await page.getByRole('button', { name: 'Locations', exact: true }).click();
  await settle(page);
  await checkScreenshot(page, 'locations.png');
});

test('agent view', async ({ page }) => {
  await openFixtureProject(page);
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await settle(page);
  await checkScreenshot(page, 'agent.png');
});
