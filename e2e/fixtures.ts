import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * WebKit only exposes OPFS in a persistent (non-ephemeral) browser context,
 * so the webkit project gets a fresh persistent profile per test; the other
 * projects keep Playwright's default ephemeral context.
 */
export const test = base.extend({
  context: async ({ browserName, playwright, context }, use) => {
    if (browserName !== 'webkit') {
      await use(context);
      return;
    }
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comic-canvas-webkit-'));
    const persistent = await playwright.webkit.launchPersistentContext(profileDir, {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await use(persistent);
    await persistent.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  },
});

export { expect };
