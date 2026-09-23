# Architecture

Comic Canvas is a client-only web application. Everything the old FastAPI
backend did now runs in the browser: React + Vite UI, TypeScript services
over IndexedDB and OPFS, the pi agent loop from `@earendil-works/pi-agent-core`,
and direct calls to the user's own model endpoints. There is no Comic Canvas
server; the deploy is static files on GitHub Pages.

```text
browser (installed PWA)
├── React UI (src/*.tsx, canvas/, storyPanels/, characters/, conceptArt/, sessions/)
├── src/api.ts        facade the views call; same method names as the old REST client
├── src/services/     domain logic (was api/*.py)
├── src/store/        IndexedDB documents (idb) + OPFS blobs + object-URL cache + zip
├── src/agent/        pi-agent-core Agent per task step, profiles, tools, traces
├── src/providers/    gemini.ts (@google/genai), textModel.ts (pi-ai openai-completions)
└── src/pwa/          service worker update flow, install prompt, offline state
```

Network calls go only to endpoints the user configured in Settings: their
Gemini key for images, their OpenAI-compatible endpoint for agent tasks.

## Storage

Two stores behind `src/store/`:

| Store | Module | Holds |
|---|---|---|
| IndexedDB `comic-canvas` | `store/db.ts` (the only `idb` importer) | one document per project for `projects`, `canvas`, `tags`, `storyPanels`, `adaptation` (incl. character/location records), `visualStyles`; per-id rows keyed `[slug, id]` for `assets`, `chatSessions`, `conceptCards`, `agentSessions`, `agentTraces`, `trash`; a `settings` document |
| OPFS (`navigator.storage.getDirectory()`) | `store/blobs.ts` (the only OPFS user) | `projects/<slug>/assets/<id>.png` + `<id>.thumb.webp`, `chat-sessions/<id>/blobs/*`, `adaptation/book.txt`, `story-panels/panels.json.bak-*` |

Blob writes use `createWritable()` on the main thread (atomic on close),
which sets the browser floor: Chromium, Firefox 111+, Safari 26+. Images
reach `<img>` through `store/objectUrls.ts`; URLs are computed at read time
and released when a project closes, never persisted.

`store/zip.ts` exports a project as a zip in the old on-disk layout
(`project.json`, `canvas.json`, `tags.json`, `assets/*.json|.png`,
`chat-sessions/`, `story-panels/`, `adaptation/`) and imports the same
layout from a zip or a directory handle. That is the backup story and the
only bridge from the previous file-based app; pi session files are ignored.

Deletion is a soft delete into the `trash` store; "empty trash" removes the
blobs. `navigator.storage.persist()` is requested on the first project and
on install; Settings shows usage and persistence state.

## Services

`src/services/*` mirror the old Python modules one to one and keep their
semantics (tag registry rules, canvas normalisation, story-panel
validators, auto-place, imposition, chat history with blob refs, receipts).
`src/api.ts` re-exports them under the old client's method names so views
changed as little as possible. Errors are `ServiceError` with a
human-readable message and a `code` (`not-found`, `conflict`, `invalid`,
`provider`, `offline`, `storage`).

Cross-tab safety: services post `{store, slug}` on a `BroadcastChannel`
after writes and the app refetches the open project when another tab
touched it.

## Providers

- `providers/gemini.ts` — `@google/genai` in the browser: image generation
  (`responseModalities: ['IMAGE']`, seed, aspect ratio, size, inline
  reference images), the refinement chat (`['TEXT','IMAGE']`, history with
  thought signatures preserved), key validation, and the provider capture
  stripped of image bytes. Behind an `ImageProvider` interface.
- `providers/textModel.ts` — builds a pi-ai `Model<'openai-completions'>`
  from a user endpoint and a stream function that injects the endpoint key.
  The reported context window is used as-is so the book-fits check is honest.

## The agent runtime

`src/agent/runtime.ts` replaces the pi subprocess manager. Each task step
constructs a pi-agent-core `Agent` with:

- a **system prompt** = preamble + the skill markdown (`agent/skills/*.md`)
  (+ the Gemini prompt guide for panel-prompt profiles);
- the **profile's tools only** (`agent/tools/*`), typed with TypeBox and
  calling services directly; a single-call delivery tool returns
  `terminate: true` so the loop ends without an extra model turn;
- an optional **seeded book**: `read-book` no longer calls a model, it
  measures the book against the selected model's window and stores a
  `bookContext`; book-dependent steps prepend the book as a user message
  plus a "Book loaded." reply (the in-memory equivalent of forking the old
  read-book session);
- the app-assembled **user prompt** (`agent/context.ts`).

After `agent.prompt()` the profile validates by **state diff** (did a record
appear / change / a prompt land). If not, up to two repair prompts go to the
same agent before the task fails naming the missing tool. Events are
projected to the same vocabulary the old SSE stream used (`assistant_text`,
`tool_start`, `tool_end`, lifecycle, `task_start`, `task_progress`,
`task_state`) into a per-task ring buffer that `usePiTask` subscribes to.
The full message list of every step is stored in `agentTraces` and
projected to the trace view on read. Tasks die with the page: on load,
ledger rows still `running` are marked failed ("Interrupted by reload").

Profiles: `read-book`, `discover-characters`/`-locations`,
`extract-character`/`-location`, `extract-all-*`, `refine-*`,
`suggest-concept-character`/`-location`, `draft-panel-prompt`,
`refine-panel-prompt`. The record plumbing is one kind-parameterised
implementation (`agent/profiles/entities.ts`).

## Canvas model

`canvas` stores layout + persistent nodes; lineage is derived, never stored.

- **One node type.** A node is an image made from a prompt: `refs` +
  `prompt` + `params` plus an `assetIds` take stack with `activeAssetId`.
  An empty stack is the draft state.
- **Canonical pointers live on entity tags.** Each entity tag carries
  `canonicalAssetId`; `adaptation.status()` seeds character/location
  pointers from their records as defaults only — a starred choice wins.
  Generation auto-attaches each tagged entity's canonical as a reference.
- **Style anchors are ordinary nodes** tagged `character-style` /
  `scene-style`; a style node's first take becomes that tag's canonical.
- **Lineage edges** are derived from each child asset's immutable
  `generation.refs`.

## Frontend map

- `main.tsx` — app shell: view state, adaptation status, PDF export, PWA
  update toast, offline pill. Canvas behaviour lives in
  `canvas/useCanvasWorkspace.ts`.
- `ProjectLanding.tsx` — project list, create, import (zip/folder), export,
  install hint, unsupported-browser banner.
- `SettingsModal.tsx` — text endpoints and default model, Gemini key, image
  defaults, storage (usage, persistence, export all, wipe), version.
- `sessions/` — Agent dashboard on the in-page task manager and stored traces.
- `storyPanels/` — Story + Layout views; the print geometry modules are
  shared with `services/print.ts` (pdf-lib).
- `e2e/testHooks.ts` — in-page seeding for Playwright (`VITE_E2E=1` only).

## History

The client-only design replaced a Python/FastAPI backend, a PyInstaller
desktop package, and a pi subprocess driven over RPC (2026-09). The
methodology in [Pi Agent Methodology](pi-agent-integration.md) still holds;
only the transport changed from a subprocess and JSONL to an in-page
`Agent` with TypeScript tools.
