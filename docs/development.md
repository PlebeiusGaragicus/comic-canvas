# Development & Release Model

Comic Canvas is a static web app. There is no backend to run, no virtualenv,
and no packaging step: the deploy is a GitHub Pages publish of `dist/`.

## Running it

```bash
npm install
npm run dev
```

Vite serves the app on `http://localhost:5173`. That origin has its own
browser storage, separate from the deployed app's. To work on realistic
data, export a project from the deployed app (landing card → Export) and
import the zip on the dev origin.

## Gate

```bash
npm run typecheck     # tsc for src/ and e2e/
npm test              # vitest: services against fake-indexeddb + an OPFS shim,
                      #         agent runtime against pi-ai's faux model
npm run build         # typecheck + vite build (manifest + service worker)
npm run test:e2e      # Playwright walk of all views on chromium + webkit
npm run test:pwa      # production build: manifest, service worker, offline reload
```

Playwright browsers: `npx playwright install chromium webkit`. The e2e run
seeds a fixture project inside the page through the app's own services
(`src/e2e/testHooks.ts`, enabled by `VITE_E2E=1`), so it needs no model
endpoint or Gemini key; the agent spec mocks the text endpoint with
`page.route`. WebKit gets a persistent browser profile because its OPFS is
unavailable in ephemeral contexts, and the WebKit tests skip themselves on
Playwright's Linux WebKit build, which has no OPFS at all (so CI effectively
covers Chromium; run the WebKit project on macOS).

Screenshot baselines live in `e2e/baselines/<view>-<project>.png` and are
compared locally (macOS). CI runs the same walk with the pixel comparison
skipped. Refresh baselines with `npm run test:e2e:update` in the commit that
intentionally changes pixels.

## Branches and deploys

- **`dev`** is the working branch.
- **`main`** is stable-only. Merge `dev` → `main` when a set of changes is
  coherent and the gate is green.
- **Pushing `main` deploys** (`.github/workflows/pages.yml`): it builds the
  app, builds the MkDocs site into `dist/docs/`, and publishes one Pages
  artifact. The custom domain is `abvstudio.net` (`public/CNAME`); the app
  is at `/`, the docs at `/docs/`.
- Installed PWAs pick up a deploy on their next load and show a "new
  version → Reload" toast.
- Version: `version` in `package.json` (shown in Settings → About). Tags are
  optional markers.

## Docs

`docs/*.md` + `mkdocs.yml`. Build locally with
`pip install mkdocs-material && mkdocs build --strict` (output in
`dist/docs`). The site is public; keep internal notes out of it.
