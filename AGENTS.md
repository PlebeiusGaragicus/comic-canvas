# Project Guidance

Comic Canvas is a **client-only web app**: React + Vite + TypeScript, no
server. Every service that used to be a FastAPI route is a TypeScript module
under `src/services/` working on IndexedDB (documents) and OPFS (image bytes)
in the user's browser. The pi agent loop runs in the page with
`@earendil-works/pi-agent-core`; the user brings their own model endpoints
(OpenAI-completions compatible) and Gemini key.

## Branching & releases

- **Day-to-day development happens on `dev`**, not `main`. Commit and iterate
  there freely.
- **`main` is stable-only.** Merge `dev` → `main` when a set of improvements
  is coherent and verified (full gate green).
- **Pushing `main` deploys.** `.github/workflows/pages.yml` builds the app and
  the MkDocs site into one GitHub Pages artifact (app at `/`, docs at
  `/docs/`) served at `abvstudio.net`. There is no release build; a `vX.Y.Z`
  tag is an optional marker and should match `version` in `package.json`.
- CI (`.github/workflows/ci.yml`) runs on pushes to `dev`/`main` and on PRs.
- **Docs live in this repo** (`docs/*.md`, `mkdocs.yml`). Never put
  private/internal-only notes there — it publishes to the public site.

## Data isolation

All user data lives in the browser origin that runs the app. The three ways
the code runs never share storage:

- The deployed app at `abvstudio.net` (and an installed PWA of it) — the
  user's real projects. Backups are per-project zips (landing view) or
  "Export all projects" in Settings.
- `npm run dev` — the `localhost:5173` origin; disposable. Import a real
  project by exporting it from the deployed app and importing the zip.
- vitest — `fake-indexeddb` plus an in-memory OPFS shim, fresh per test.
- Playwright — a fresh browser context per test, seeded in-page through
  `src/e2e/testHooks.ts` (`VITE_E2E=1`), wiped before every seed.

## Breaking Changes Preferred

This project is in active development and does not preserve backwards
compatibility for stored documents, the export zip layout, or UI state.

- Do not add `v1`/`v2` compatibility layers or migrations unless explicitly
  requested for a one-off data rescue.
- When changing a document shape, update `src/types.ts` and the owning
  service directly. Remove obsolete branches instead of carrying them.
- The one bridge that stays: project export/import in the `projects/<slug>/`
  zip layout (`src/store/zip.ts`).

## Gate

After any change:

```bash
npm run typecheck     # tsc for src/ and e2e/
npm test              # vitest (services, agent runtime on the faux model)
npm run build         # typecheck + vite build (PWA manifest + service worker)
npm run test:e2e      # Playwright: chromium + webkit walk, console-error assertion, screenshots
npm run test:pwa      # production build, service worker, offline reload
```

Use `npm run test:watch` while iterating on a service. Run a single e2e
project with `npx playwright test --project=chromium`.

Screenshot baselines (`e2e/baselines/<view>-<project>.png`) are committed
and compared locally on macOS only (CI skips the pixel comparison). A commit
that intentionally changes pixels must refresh them
(`npm run test:e2e:update`) in the same commit and say so in the message.

## Services conventions

- **One module per feature area** under `src/services/` (`projects`,
  `assets`, `tags`, `canvas`, `canvasNodes`, `trash`, `generation`,
  `chatSessions`, `adaptation`, `visualStyles`, `conceptCards`,
  `storyPanels`, `print`, `agentSessions`, `settings`). `src/api.ts` is the
  facade the views call; it holds no logic.
- **`src/store/` is the only storage boundary.** `db.ts` is the one module
  that imports `idb`; `blobs.ts` is the one module that touches
  `navigator.storage`. Feature modules go through their exported functions.
  Object URLs come from `store/objectUrls.ts` and are never persisted.
- **One of each:** `services/common.ts` (`utcNow`, `slugify`),
  `services/ids.ts` (`newUlid`, `newSeed`), `services/errors.ts`
  (`ServiceError` with a human-readable message and a `code`). Throw
  `ServiceError`; `formatRequestError` renders it.
- **Providers** (`src/providers/`) are the only modules that talk to the
  network: `gemini.ts` (image generation, refinement chat, key check) and
  `textModel.ts` (pi-ai model + stream function for a user endpoint). Keys
  come from the settings document and go nowhere else.
- **Agent** (`src/agent/`): `runtime.ts` runs profiles as `Agent` instances;
  `profiles/*` are the control plane (precheck, lazy step plan, prompt
  assembly, state-diff validation); `tools/*` are the only side-effect
  channel and call services directly; `skills/*.md` are system-prompt
  sections. Tests script the model with pi-ai's `fauxProvider`.
- **Import cycles:** the lazy `await import('./adaptation')` pattern breaks
  the documented `adaptation ↔ canvasNodes/visualStyles/conceptCards`
  cycles. Do not introduce new ones.
- **Field names** are camelCase everywhere, including persisted documents.
- **Debug logging** follows `import.meta.env.DEV`.

## Frontend conventions

- **File naming:** PascalCase when the main export is a component
  (`CharactersHubView.tsx`); camelCase for hooks/utils (`useStoryPanelDocument.ts`).
  Apply when creating or moving files; no mass renames.
- **Directory per feature:** `canvas/`, `storyPanels/`, `sessions/`,
  `conceptArt/`, `characters/`, `visualStyles/`; cross-feature helpers in
  `shared/` and `ui.tsx`.
- **Errors:** use `formatRequestError` and surface a view-local error banner;
  no empty `catch {}` — at minimum `console.error` plus a user-visible state.
- **CSS:** per-area files under `src/styles/` loaded in the order declared by
  `styles/index.css` (reset → tokens → base → features). New rules go in the
  owning area file and use the tokens in `styles/tokens.css` instead of raw
  values.
- **Buttons:** the `button` element style in `styles/base.css` is the base;
  variants override the `--btn-*` custom-property hooks rather than
  restating the visual. Active/selected state class is `is-active`.
- **classNames:** use `clsx` for conditional classes in new or touched code.
