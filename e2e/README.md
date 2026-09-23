# E2E smoke rig

- Run: `npm run test:e2e` (boots Vite on :5199 with `VITE_E2E=1`; no backend).
- Projects: `chromium` and `webkit`. Baselines are per browser: `e2e/baselines/<name>-<project>.png`.
- Update screenshots after an intentional visual change: `npm run test:e2e:update` and commit `e2e/baselines/`.
- The fixture project is seeded inside the page through the app's services (`src/e2e/testHooks.ts`) before every test; no Gemini or model endpoint needed.
- `e2e/test-results` is disposable and gitignored.
