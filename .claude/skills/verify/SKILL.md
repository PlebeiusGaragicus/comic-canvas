---
name: verify
description: Verify comic-canvas changes at the real surface. Runs the client-only app's gate (typecheck, vitest, build, Playwright walk on chromium + webkit, PWA smoke) and shows how to drive the app with a seeded fixture for ad-hoc checks.
---

# Verify comic-canvas changes end-to-end

The app has no backend: everything runs in the browser against IndexedDB +
OPFS. Nothing here touches a real user's data; every Playwright test gets a
fresh browser context and seeds its own fixture in-page.

## The gate (run from the repo root)

```bash
npm run typecheck      # tsc for src/ and e2e/
npm test               # vitest (services + agent runtime on the faux model)
npm run build          # typecheck + vite build (manifest + service worker)
npm run test:e2e       # Playwright walk, chromium + webkit, console-error assertion, screenshots
npm run test:pwa       # production build: manifest, service worker, offline reload
```

Playwright browsers once: `npx playwright install chromium webkit`.
Single project: `npx playwright test --project=chromium`. Screenshot
baselines live in `e2e/baselines/<view>-<project>.png`; refresh them only
for an intentional pixel change (`npm run test:e2e:update`) and say so in
the commit.

## Ad-hoc checks against a seeded app

Start Vite with the test hooks enabled, then seed from Playwright:

```bash
VITE_E2E=1 npx vite --host 127.0.0.1 --port 5199 --strictPort
```

```ts
// in a Playwright script or spec
await page.goto('http://127.0.0.1:5199/');
await page.waitForFunction(() => Boolean(window.__comicCanvas));
await page.evaluate(() => window.__comicCanvas!.seedFixture());       // project + 3 images + 2 panels
// or: seedAgentFixture() → also a book + a default text model on https://mock-llm.test/v1
```

Mock the text endpoint with `page.route('https://mock-llm.test/v1/chat/completions', …)`
returning OpenAI-style SSE chunks (see `e2e/agent.spec.ts`). WebKit needs a
persistent context for OPFS (`e2e/fixtures.ts` does this).

To look at a real project, export it from the deployed app as a zip and
import it on the landing page (`input[type=file]`), or use
`window.showDirectoryPicker` import on Chromium.
