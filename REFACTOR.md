# Refactor: client-only PWA with pi embedded in the browser

Status: **decided, not started**. This document is the brief for the agent
that plans and executes the work. It is written to stand alone: everything
needed to understand the current system, the target system, and why, is here
or pointed at from here. Read it fully before planning.

---

## 1. Decision

comic-canvas becomes a **client-only web application**:

1. **No backend.** The Python/FastAPI server in `api/` is deleted. All domain
   logic moves into the browser. Every "route" becomes a TypeScript service
   function operating on local storage.
2. **Pi embedded via its library, not RPC.** The pi agent loop runs inside the
   browser using `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`.
   No subprocess, no `pi --mode rpc`, no pi binary, no Node 22 requirement.
3. **BYOK for everything.** The user configures their own LLM endpoints (any
   OpenAI-completions or Anthropic-messages compatible server) and their own
   Gemini key for image generation. Keys live only in the browser.
4. **Installed as a PWA.** Static build deployed to GitHub Pages, installable,
   app shell works offline, project data persists in browser storage with a
   first-class export/import path.

Three things motivate this (see §2 for the evidence):

- The backend exists for no recorded reason. Nothing it does requires a server.
- pi's own libraries are TypeScript. A Python host can only reach pi through a
  subprocess and a JSONL protocol; a browser host imports it.
- Packaging today is PyInstaller + a curl installer + a Node 22 + pi
  prerequisite. A static site has zero install.

The reference implementation for the browser-side agent is
`/Users/satoshi/Downloads/PLEBCHAT-PLATFORM/plebchat-me` (SvelteKit, pi-agent-core
0.80.6) and the smaller
`/Users/satoshi/Downloads/pi-web-apps/PiChessBrowser` (React, pi-agent-core
0.80.6, ~200 lines in `src/ai/piPlayer.ts`). Both are on this machine. Both are
BYOK, both run `Agent` in the browser. plebchat is also a PWA (`vite-plugin-pwa`,
`idb`, `workbox-window`) and is the model for §5.7 and §5.1.

---

## 2. Current architecture (what exists today)

### 2.1 Shape

- `api/` — Python 3, FastAPI, ~13,600 lines including tests. Single-user
  local server on `127.0.0.1:8787`, cookie/bearer token auth.
- `webui/` — React 18 + Vite + TypeScript, ~18,400 lines. React Flow canvas.
  Talks to the API through one client module, `webui/src/api.ts`.
- `.pi/skills/*/SKILL.md` — eleven pi skills (behavior contracts per task).
- `.pi/extensions/photo-web.ts` — one pi extension registering domain tools
  that call back into the REST API.
- `api/prompt_guides/gemini-image.md` — the image-prompt authoring guide
  injected into prompt-writing tasks.
- `packaging/`, `install.sh`, `api/cli.py`, `api/appmain.py` — PyInstaller
  binary and curl installer for the `comic-canvas` CLI app.
- `docs/` + `mkdocs.yml` — public docs site, deployed on push to `main`.
- `run` — dev stack launcher (creates `.venv`, starts API + Vite).

### 2.2 Data on disk

Installed app home is `~/.comic-canvas`; dev stack uses repo-local
`dev-library/`. Per project (`projects/<slug>/`):

```
project.json                   ProjectMetadata
canvas.json                    CanvasDocument (nodes = images, groups, layout)
tags.json                      TagRegistryDocument
assets/<ULID>.json             AssetMetadata (one per image; prompt, receipt,
                               provider capture, parents, tags, archive state)
assets/<ULID>.png|.jpg         the image bytes
assets/<ULID>.thumb.*          derived thumbnail
chat-sessions/<ULID>/session.json   ChatSessionDocument (Gemini refinement chat)
chat-sessions/<ULID>/blobs/    attachments
story-panels/panels.json       StoryPanelDocument (panels, pages, captions,
                               image prompts, crops, layout)
adaptation/adaptation.json     AdaptationMetadata
adaptation/book.txt            imported source text
adaptation/characters/*.json   CharacterRecord (structured; variants)
adaptation/locations/*.json    LocationRecord
adaptation/concept-cards/      ConceptCardDocument
adaptation/style-refs/visual-styles.json
adaptation/sessions/agent-sessions/*.json   AgentSessionDocument (task ledger)
adaptation/sessions/pi/*.jsonl              raw pi session files
adaptation/sessions/pi-tasks/<id>.json      task status snapshot
adaptation/sessions/pi-tasks/<id>.events.jsonl
adaptation/sessions/book-session.json       pointer to the read-book session
```

All persistent JSON goes through `library.read_json`/`write_json`. IDs are
ULIDs (`api/ids.py`). Field names are camelCase everywhere.

### 2.3 Pydantic models (port list)

All in `api/models.py`, 911 lines. These become TypeScript types:

`Prompt, GenerationReceipt, ProviderCapture, AssetMetadata, AssetSummary,
ProjectCreate, ProjectMetadata, TagDefinition, TagRegistryDocument,
TagCanonicalPatch, ProjectCoverPatch, EntityVariant, CharacterRecord,
CharacterCreate, EntityVariantPatch, CharacterPatch, LocationRecord,
LocationCreate, LocationPatch, AdaptationMetadata, VisualStyleDefinition,
VisualStyleCreate, VisualStylePatch, AdaptationStatus, PiTaskStartRequest,
PiTaskStatus, PiTaskAbortResponse, AgentSessionDocument, AgentSessionPatch,
PiTraceUsage, PiTraceUserStep, PiTraceToolCall, PiTraceAssistantStep,
PiTraceInfoBanner, PiTraceStats, PiTraceDocument,
AdaptationCanvasImportResponse, ConceptCardDocument, ConceptNodeCreate,
ConceptCardPatch, ConceptNodeResponse, ImageGroupNodeCreate,
ImageGroupNodeResponse, StoryPanelRect, StoryPanelPage,
StoryPanelPageSettings, StoryPanelTextStyle, StoryPanelImageCrop,
StoryPanelCaptionTail, StoryPanelCaption, StoryPanelImagePrompt,
StoryPanelImagePromptWrite, StoryPanel, StoryPanelDocument, StoryPanelCreate,
StoryPanelBookmarkCreate, StoryPanelPatch, ProjectDetail, DisplayPatch,
CanvasNodeLayout, GenerationParams, ChatTurnSettings, ChatAttachment,
ChatTurn, ChatSource, ChatProviderState, ChatSessionDocument,
ChatSessionCreate, ChatSessionPatch, ChatTurnRequest, ChatTurnResponse,
ArchivePatch, CanvasNodeOrigin, CanvasNode, CanvasDocument, GenerateRequest,
GenerateResponse`

Many of the `*Create`/`*Patch`/`*Request`/`*Response` wrappers exist only
because there was an HTTP boundary. Collapse them where a plain function
signature suffices. The `Pi*`/`AgentSession*` shapes change materially (§5.5).

### 2.4 Backend modules and what they do

| Module | Lines | Responsibility | Browser destination |
|---|---|---|---|
| `library.py` | 1159 | projects, assets, tags, canvas, trash, thumbnails (Pillow), JSON IO | `src/store/*` + `src/services/{projects,assets,tags,canvas}.ts` |
| `story_panels.py` | 868 | panel document CRUD, chunking, layout resets, auto-place, bookmarks, image prompts | `src/services/storyPanels.ts` |
| `story_panels_print.py` | 781 | reportlab PDF booklet | `src/services/print.ts` (pdf-lib) |
| `pi_profiles.py` | 746 | task profiles: precheck, plan steps, build prompts with app-assembled context, validate results | `src/agent/profiles/*.ts` |
| `pi_runtime.py` | 643 | RPC subprocess manager, events ring buffer, abort, snapshots | `src/agent/runtime.ts` (pi-agent-core) |
| `gemini.py` | 488 | Gemini image generation + chat turns, response parsing, receipts | `src/providers/gemini.ts` (`@google/genai`) |
| `chat_sessions.py` | 431 | persistent refinement chat with attachments | `src/services/chatSessions.ts` |
| `adaptation.py` | 406 | adaptation folder, book import, characters/locations/visual styles CRUD, reset | `src/services/adaptation.ts` |
| `pi_session_trace.py` | 304 | parse pi JSONL into trace docs | `src/agent/trace.ts` (from in-memory messages) |
| `concept_cards.py` | 272 | concept-card CRUD, draft to canvas, upload | `src/services/conceptCards.ts` |
| `canvas_nodes.py` | – | node/group creation helpers | `src/services/canvas.ts` |
| `visual_styles.py` | – | visual style definitions | `src/services/visualStyles.ts` |
| `agent_sessions.py` | – | task ledger | `src/agent/ledger.ts` |
| `pi_env.py`, `pi_events.py`, `preflight.py`, `app_config.py`, `paths.py`, `cli.py`, `appmain.py`, `main.py`, `routes/*` | – | process/env/HTTP plumbing | **deleted** |

The full REST surface (63 endpoints) is in `api/routes/*.py`; each is the
signature of a service function the browser needs. `test_api.py` (3110 lines)
is the behavioral spec for those services and should be read when porting.

### 2.5 How pi is integrated today

- UI posts `{profile, target?, force?, instructions?}` to `/pi-tasks`.
- `pi_runtime.PiSessionManager` spawns one `pi --mode rpc` subprocess per
  step with `--session-dir`, `--skill .pi/skills`, `--name`, optionally
  `--fork <read-book session id>` and `--extension .pi/extensions/photo-web.ts`.
- The extension registers only tools named in `PHOTO_WEB_ALLOWED_TOOLS`; each
  tool calls the REST API with a bearer token.
- Runtime speaks RPC: `get_state`, `prompt`, `abort`, auto-cancels
  `extension_ui_request`, waits for `agent_end`, then `get_state` to capture
  session id/file.
- Events are projected (`pi_events.py`) into a ring buffer and streamed to the
  UI over SSE; snapshots with PID + process start time recover from restarts.
- The `read-book` profile loads the whole book via pi's `read` tool in
  parallel chunks; every other profile forks that session so the book is
  in context without re-sending it.

Profiles and the tools each may call:

| Profile | Steps | Tools |
|---|---|---|
| `read-book` | 1 | (built-ins: bash, read) |
| `discover-characters` | 1 | `register_character`, `list_characters` |
| `extract-character` | 1 | `update_character`, `list_characters` |
| `extract-all-characters` | discover, then one per character | `register_character`, `update_character`, `list_characters` |
| `refine-character` | 1 (accepts instructions) | `update_character`, `list_characters` |
| `discover-locations` / `extract-location` / `extract-all-locations` / `refine-location` | same shape | `*_location` |
| `suggest-concept-character` / `suggest-concept-location` | 1 | `create_concept_card` |
| `draft-panel-prompt` | 1 (target = panel id) | `set_panel_image_prompt` |
| `refine-panel-prompt` | 1 (target = `panelId/promptId`, accepts instructions) | `replace_panel_image_prompt` |

Known weaknesses of the current integration (all go away or are fixed by
design in the browser version): built-in tools stay enabled for narrow tasks;
the user's global pi extensions and default model leak into every run; the
tool allow-list is enforced only at registration time; single static token.

### 2.6 UI

Six views wired through `webui/src/main.tsx` and `ProjectPhaseSidebar.tsx`:
project landing, canvas (`canvas/`), story setup + book text (`storyPanels/`),
layout editor (`storyPanels/`), characters/locations hub (`characters/`),
concept art (`conceptArt/`), visual styles (`visualStyles/`), agent dashboard
+ task panel + trace view (`sessions/`). Settings modal holds the Gemini key.
All server calls go through `webui/src/api.ts`. Styles are per-area files
under `webui/src/styles/` on a token system (`tokens.css`). Playwright e2e in
`webui/e2e/` boots API + UI against a fixture library and compares screenshots
to committed baselines.

The UI is the part that survives. The goal is to keep every view and swap
`api.ts` for local services with the same shapes, so the React tree changes
as little as possible.

---

## 3. Target architecture

```
browser (installed PWA)
├── React UI (existing views, minimally changed)
├── services/        pure TS domain logic (was api/*.py)
├── store/           IndexedDB (documents) + OPFS (blobs) + optional
│                    File System Access directory mirror
├── agent/           pi-agent-core Agent per task, profiles, tools, ledger,
│                    traces, event bus
├── providers/       pi-ai Model builders for BYO text endpoints;
│                    @google/genai for image generation
└── pwa/             service worker (app shell only), install, update,
                     persistent-storage request
```

Everything the user owns stays on their device. Network calls go only to
endpoints the user configured. There is no comic-canvas server of any kind.

### 3.1 Why `pi-agent-core` and not `createAgentSession`

pi ships three packages. `pi-ai` is the multi-provider LLM client. `pi-agent-core`
is the `Agent` class: the tool-calling loop, state, events, abort.
`pi-coding-agent` is the CLI plus the `createAgentSession` SDK, which adds
filesystem sessions, skill discovery, extension loading via jiti, and the
built-in coding tools. `pi-coding-agent` depends on Node APIs (fs, child
processes) and cannot run in a browser. `pi-agent-core` + `pi-ai` can, and is
what plebchat and PiChessBrowser use. That is "the proper SDK" for a browser
host. We reimplement the small parts of the harness we need (session
persistence, skill text, compaction if needed) using the pure modules
`pi-agent-core` exports (`memory-repo`, `session`, `compaction`).

Pin to the current release (0.85.1 on npm as of 2026-09-18; both packages
share a version). plebchat and PiChessBrowser pin 0.80.6, so check the
`Agent`/`AgentTool` API against 0.85.1 rather than copying their code
blindly. Verify: `AgentTool.execute(toolCallId, params, signal?)` return shape
`{content, details, terminate?}`, `Agent.subscribe`, `Agent.prompt`,
`Agent.abort`, `Agent.state.messages`, `Agent.state.errorMessage`.

---

## 4. Constraints and non-goals

- **Breaking changes preferred** (AGENTS.md). No compatibility layers. The
  on-disk formats in §2.2 are replaced by the browser store; the only bridge
  is a one-off import of a `~/.comic-canvas`-style folder or zip (§6).
- **No server, ever.** No "tiny proxy for CORS" either. If an endpoint does
  not allow browser requests, the user configures a gateway; document it.
- **Single user, single device** is still the model. No sync, no accounts.
- **Do not change the domain model or the six views** beyond what the
  storage/agent swap requires. This is a platform refactor, not a redesign.
- **Keep the frontend conventions** in AGENTS.md (file naming, per-feature
  directories, `formatRequestError`, styles/tokens, `clsx`, `is-active`).
- **Baselines**: Playwright screenshots will change (settings modal gains
  endpoints; task panel loses PID-era fields). Refresh them in the commit
  that changes pixels and say so.

---

## 5. Detailed design

### 5.1 Storage

Two stores plus an optional mirror.

**Documents → IndexedDB** via `idb` (as plebchat). One database
`comic-canvas`, object stores keyed as today's file paths were:

| Store | Key | Value |
|---|---|---|
| `projects` | slug | ProjectMetadata |
| `canvas` | slug | CanvasDocument |
| `tags` | slug | TagRegistryDocument |
| `assets` | `[slug, assetId]` | AssetMetadata |
| `chatSessions` | `[slug, sessionId]` | ChatSessionDocument |
| `storyPanels` | slug | StoryPanelDocument |
| `adaptation` | slug | AdaptationMetadata + book text pointer |
| `characters` | `[slug, characterSlug]` | CharacterRecord |
| `locations` | `[slug, locationSlug]` | LocationRecord |
| `conceptCards` | `[slug, cardId]` | ConceptCardDocument |
| `visualStyles` | slug | VisualStyleDefinition[] |
| `agentSessions` | `[slug, sessionId]` | AgentSessionDocument (ledger) |
| `agentTraces` | `[slug, sessionId]` | serialized AgentMessage[] |
| `settings` | key | endpoints, keys, preferences |

Index by slug on the compound stores. Writes are per-document, atomic. Keep
the "one `read_json`/`write_json`" rule as one `store/db.ts` module; no
feature module touches IndexedDB directly.

**Blobs → OPFS** (`navigator.storage.getDirectory()`), mirroring today's
paths: `projects/<slug>/assets/<id>.png`, `.thumb.webp`,
`chat-sessions/<id>/blobs/…`, `adaptation/book.txt`, style refs. Read via
`FileSystemFileHandle.getFile()` and serve to `<img>` through
`URL.createObjectURL` with a small LRU cache that revokes URLs. Thumbnails
are generated in the browser with `createImageBitmap` + `OffscreenCanvas`
(replaces Pillow) on import/generate and stored alongside.

**Persistence**: call `navigator.storage.persist()` on first project
creation and surface the result. Show `navigator.storage.estimate()` in
settings. Safari evicts non-persisted data after seven days without use;
installing the PWA is the mitigation and the onboarding should say so.

**Optional directory mirror (Chromium)**: `window.showDirectoryPicker()` lets
the app keep a real folder on disk as the source of truth, restoring the
"my projects are files" property. Design the store behind an interface
(`ProjectStore`) with two implementations: `OpfsStore` (default) and
`DirectoryStore` (when a handle is granted and persisted in IndexedDB).
Ship `OpfsStore` first; `DirectoryStore` is a follow-up but the interface
must allow it from the start.

**Export / import**: zip per project (`fflate` or `client-zip`), exact layout
of §2.2, so an export from the browser app is byte-compatible with a
`~/.comic-canvas/projects/<slug>` folder and vice versa. This is the backup
story and the migration path. It is a launch requirement, not a nicety.

**Trash**: today `library.py` moves deleted assets to a system trash.
Replace with a soft-delete flag plus "empty trash" that deletes OPFS files.

### 5.2 Services (replacing routes)

One module per feature area under `src/services/`, exporting plain async
functions with the same semantics as the endpoints in §2.4. Map 1:1 from
`api/routes/*.py` + the service module it calls. Errors: throw a typed
`ServiceError` with a human-readable message; `formatRequestError` keeps
working on it. Concurrency: IndexedDB transactions per operation; document
version fields are unnecessary in a single-tab app but guard against two
tabs by listening for `storage`/`BroadcastChannel` updates and refetching.

`webui/src/api.ts` is replaced by `src/api.ts` that re-exports the services
with identical function names and return types wherever possible, so view
code diffs stay small. Where the old client returned URLs for images
(`/assets/{id}/image`), return object URLs from the blob cache.

### 5.3 Image generation and refinement chat

`gemini.py` → `src/providers/gemini.ts` using `@google/genai` (browser
build). The Gemini API accepts browser requests with an API key. Keep:

- `generateImage(prompt, {model, aspectRatio, imageSize, seed, parentImages})`
  with reference images loaded from OPFS as inline data.
- `sendChatTurn(...)` for the refinement chat with attachments and
  `ChatProviderState` carried across turns.
- Receipt/provider-capture serialization exactly as today
  (`GenerationReceipt`, `ProviderCapture`), minus provider payload stripping
  that only existed to keep files small — keep it anyway, storage is finite.
- Failure classification (`describe_generation_failure`) with the same
  categories so the UI banners stay meaningful.

Reference-image limits per model, default model/aspect/size come from
settings, not env vars. Design the provider behind an interface so a second
image provider can be added later, but implement only Gemini now.

### 5.4 Text model endpoints (BYOK)

Port plebchat's pattern (`app/src/lib/ai/model.ts`, `providers.ts`,
`stores/settings`): the user defines endpoints
`{id, name, baseUrl, api: "openai-completions" | "anthropic-messages",
apiKey, models: [{id, name, reasoning, thinkingLevelMap?, contextWindow,
input}]}` and a default model. Build a `pi-ai` `Model` object per run exactly
as `buildModel` does there. Notes from plebchat's comments that matter:

- pi subtracts a fixed 4096-token margin from `contextWindow` and clamps
  output to at least one token. Do not report a tiny window.
- For reasoning models supply a `thinkingLevelMap`; the "off" wire value is
  endpoint-specific.
- Anthropic requires the `anthropic-dangerous-direct-browser-access` header
  for browser calls; pi-ai sets it for `anthropic-messages`. Verify at 0.85.1.
- Local servers (LM Studio, Ollama, llama.cpp) need CORS enabled. Document
  the flags in the user guide.

The read-book + adaptation tasks need long context (a novel is 100k+ tokens).
Settings must show the model's context window and warn when the book will
not fit. Prompt caching on Anthropic makes repeated prefixes cheap; note this
in docs.

### 5.5 Pi agent runtime in the browser

Replace `pi_runtime.py` + `pi_profiles.py` + `photo-web.ts` + `.pi/skills`
with `src/agent/`:

```
agent/
  runtime.ts        TaskManager: start/abort/list tasks, one Agent per step,
                    event bus, ledger writes, trace persistence
  profiles/         one file per profile (same ids as §2.5), each exporting
                    {id, title, precheck, plan, acceptsTarget,
                     acceptsInstructions, tools}
  tools/            AgentTool factories closing over the services:
                    registerCharacter, listCharacters, updateCharacter,
                    registerLocation, listLocations, updateLocation,
                    createConceptCard, setPanelImagePrompt,
                    replacePanelImagePrompt
  skills/*.md       the eleven SKILL.md bodies, imported with `?raw`
  prompts/gemini-image.md   the prompt guide, imported with `?raw`
  context.ts        the context assemblers from pi_profiles.py
                    (_entity_record_context, _panel_prompt_context_lines, …)
  book.ts           book-context strategy (below)
  trace.ts          AgentMessage[] → PiTraceDocument
  ledger.ts         AgentSessionDocument writes
```

**Per-step agent.** Each `TaskStep` constructs `new Agent({initialState:
{systemPrompt, model, tools, messages?}, getApiKey})`, subscribes for events,
calls `agent.prompt(stepPrompt)` under a timeout, and validates by state
diff exactly as `on_success` does today. Tools are the only side-effect
channel; a tool that completes the step's delivery returns
`terminate: true` (as PiChessBrowser's `submit_move`) so the loop ends
without an extra model turn where the skill's contract allows it. Register
only the profile's tools. There are no built-in tools in the browser, so the
sandboxing weaknesses in §2.5 disappear by construction.

**Skills become system-prompt sections.** The `/skill:name args` convention
is gone. Each profile's system prompt = persona/task preamble + the skill
markdown + (for prompt-writing profiles) the gemini-image guide. The user
message = the app-assembled context (what `build_prompt` emits today after
the skill line). Keep the "Delivery contract" phrasing from the skills; it is
what makes state-diff validation work.

**Repair prompts.** If a step ends without delivering, send up to two
follow-up prompts on the same agent ("You did not call X …") before failing,
as both chess apps do. Today's runtime has no repair path; this is a
deliberate improvement.

**Book context strategy** (replaces `read-book` + `--fork`). The `read`
tool, the 50 KB tool-result cap, and session forking do not exist here. The
book is a string in OPFS. Approach:

1. `read-book` becomes "prepare book context": load `book.txt`, compute the
   token estimate, check it against the selected model's context window,
   and persist a `BookContext` record `{bookHash, tokenEstimate, chunks?}`.
   No model call is needed. Keep the profile id so the UI flow is unchanged.
2. Every book-dependent step seeds its agent with `messages: [userMessage(
   bookText), assistantMessage("Book loaded.")]` before the task prompt.
   This is the in-memory equivalent of forking the read-book session. It is
   cheap on providers with prompt caching and honest on local models
   (they re-read the book per task; show the cost).
3. If the book exceeds the window, refuse the step with a clear message
   (today's precheck behavior). A chunked/summarized fallback is out of
   scope for this refactor; leave a hook.

**Events and UI.** Replace SSE with an in-memory event bus per task (same
projected shapes as `pi_events.py`: `assistant_text`, `tool_start`,
`tool_end`, `retry`, lifecycle, `task_state`, `task_progress`) and a ring
buffer, feeding `sessions/usePiTask.ts` unchanged. Persist the full
`AgentMessage[]` of each step to `agentTraces` so `PiTraceView` renders from
storage after reload. `trace.ts` replaces `pi_session_trace.py` and parses
in-memory messages instead of JSONL.

**Lifecycle.** `TaskHandle` states stay `starting | running | aborting |
done | failed | cancelled`. Abort = `agent.abort()` on the active step.
Timeouts per step (keep 2 h ceiling; local models are slow). One active task
per `(profile, target)`; tasks run in the page, so a reload kills them: on
startup mark any ledger entry still `running` as `failed: "Interrupted by
reload"` (replaces the PID sweep). Warn on `beforeunload` while a task runs.

**Ledger.** `AgentSessionDocument` keeps `{id, kind, title, status, source,
error, createdAt, completedAt}`; drop `piSessionId`/`piSessionFile`, add
`traceId`. Update `models` accordingly (breaking change, fine).

**Multi-step plans** (`extract-all-*`) stay lazy generators so step N+1 can
read records step N registered.

### 5.6 Settings and secrets

One `settings` document: endpoints (§5.4), default text model, Gemini key,
image defaults (model/aspect/size), storage mode (OPFS vs directory),
directory handle id, UI prefs. Stored in IndexedDB (plebchat uses
localStorage for settings; IndexedDB is fine and keeps everything in one
place; either is acceptable). Keys are never sent anywhere but the
configured endpoint. Provide "wipe all local data".

### 5.7 PWA

- `vite-plugin-pwa` with `registerType: "prompt"`; `workbox-window` for the
  update flow (toast "update available → reload"), as plebchat's
  `lib/pwa/update*.ts`.
- Precache the app shell (HTML, JS, CSS, fonts, icons). **Never** cache LLM
  or Gemini requests. Runtime caching: none beyond the shell.
- `manifest.webmanifest`: name "Comic Canvas", standalone display, icons
  (192/512 + maskable), theme colors from `tokens.css`.
- Install prompt: capture `beforeinstallprompt`, show an install affordance
  in the landing view, remember dismissal (plebchat `lib/pwa/install`).
- Offline: the UI, canvas, layout editor, and all local edits work offline.
  Generation and agent tasks show a clear "offline" state
  (`navigator.onLine` + fetch failure), not a spinner.
- Request persistent storage on install and on first project.
- GitHub Pages base path: set Vite `base` to the repo path or serve from a
  custom domain; the site already lives at `plebchat.me/comic-canvas`
  (docs). Decide whether the app takes that path and docs move, or the app
  gets its own path. Recommendation: app at `/comic-canvas/`, docs at
  `/comic-canvas/docs/`.

### 5.8 Print / PDF

`story_panels_print.py` (reportlab) → `src/services/print.ts` with
`pdf-lib`. Reproduce the booklet: page size from
`StoryPanelPageSettings`, panel rects, image crops (`StoryPanelImageCrop`),
captions with tails, page numbers, spreads (`spansSpread` invariants from
the layout editor memory). Images come from OPFS as bytes. Output a Blob
and trigger a download; the "print" endpoint goes away. Compare output
against a PDF produced by the current backend for the fixture project
before deleting reportlab.

### 5.9 Image ops

Pillow uses in `library.py`, `chat_sessions.py`, `gemini.py`: thumbnail
generation, format sniffing, size reads, attachment normalization. All move
to `createImageBitmap`/`OffscreenCanvas` (`src/shared/images.ts`). Keep the
thumbnail size and format constants.

### 5.10 Deployment and repo shape

Delete: `api/`, `.pi/`, `packaging/`, `install.sh`, `run`, `dev-library/`
handling, `.venv` references, `api/requirements.txt`, `.vscode` Python
settings, `.github/workflows/release.yml` (tag-only PyInstaller release),
`docs/packaging.md`, `docs/release-checklist.md` content about binaries.

Hoist `webui/` to the repo root as the last step of the refactor (after
everything works), so the app is `src/`, `e2e/`, `package.json` at root.
Doing it last keeps diffs reviewable.

Add `.github/workflows/pages.yml` that builds the app and deploys it with
the docs (MkDocs output under `/docs/`) in one Pages artifact. CI runs
`typecheck`, `vitest`, `playwright`.

Versioning: `api/version.py` → `package.json` version; the "release" is a
Pages deploy from `main`; tags become optional markers. Update AGENTS.md
branching/release section accordingly.

### 5.11 Testing

- **Unit (vitest)**: every service module against `fake-indexeddb` and an
  in-memory OPFS shim; port the assertions from `test_api.py` that concern
  domain behavior (not HTTP status codes). Agent profiles tested with a fake
  `Model`/stubbed `pi-ai` stream that emits scripted tool calls, replacing
  `testdata/fake_pi.py` (39 runtime tests + 9 profile tests today: keep
  their intent).
- **E2E (Playwright)**: replace the API boot with a seeded IndexedDB/OPFS
  (a `seed.ts` that builds the fixture project through the services) and a
  mock LLM endpoint served by Playwright's `route()` so agent tasks run
  deterministically. Keep the six-view walk, zero-console-error assertion,
  and screenshot baselines (refresh once, in the commit that changes them).
- Add a PWA smoke: manifest present, service worker registers, app loads
  offline after first visit.

---

## 6. Migration of existing data

Per AGENTS.md, no migrations. Provide exactly one bridge: **Import project
folder/zip** in the landing view that reads the §2.2 layout (via
`showDirectoryPicker` on Chromium, or a zip anywhere) and writes it into the
store. `adaptation/sessions/pi*` is ignored (pi session JSONL has no
equivalent). That is enough to carry `~/.comic-canvas` and `dev-library/`
projects over. Export produces the same layout, so the format is
round-trippable and remains human-browsable.

---

## 7. Phased plan (suggested order, each phase green before the next)

Each phase ends with typecheck + vitest + e2e passing and a commit on
`refactor`.

**Phase 0 — Scaffold.** Add `idb`, `@earendil-works/pi-agent-core@0.85.1`,
`@earendil-works/pi-ai@0.85.1`, `@google/genai`, `pdf-lib`, `fflate`,
`vite-plugin-pwa`, `workbox-window`, `vitest`, `fake-indexeddb`. Create
`src/store/db.ts`, `src/store/blobs.ts`, `src/store/ProjectStore.ts`
interface + `OpfsStore`. Port `models.py` to `src/types.ts`. No UI change.

**Phase 1 — Projects, assets, tags, canvas.** Port `library.py` +
`canvas_nodes.py` to services; thumbnails in browser; object-URL cache.
Swap `api.ts` for these areas. Landing + Canvas views work with no backend.
Import (folder/zip) and export shipped here so the fixture project can be
loaded. E2E seeding moves to the store.

**Phase 2 — Image generation + chat sessions.** `providers/gemini.ts`,
`services/chatSessions.ts`, settings modal gains Gemini key + image
defaults. Generate and refine from the canvas.

**Phase 3 — Story panels + print.** Port `story_panels.py` and the PDF.
Story setup, book text, layout editor, booklet download.

**Phase 4 — Adaptation records.** `adaptation.py`, `visual_styles.py`,
`concept_cards.py` → services. Characters/locations hub, concept art,
visual styles views.

**Phase 5 — Agent runtime.** `src/agent/*` per §5.5: endpoints settings,
runtime, tools, first profile (`discover-characters`), then the rest.
Dashboard, task panel, trace view on the in-memory bus + stored traces.
Fake-model tests. This is the phase with the most judgment calls; read
`pi_profiles.py` and the eleven skills before starting.

**Phase 6 — PWA.** Manifest, service worker, install/update flow, offline
states, persistent storage, storage usage in settings.

**Phase 7 — Delete the backend.** Remove everything in §5.10, hoist
`webui/` to root, rewrite AGENTS.md (data isolation, Python sections,
release process are obsolete), rewrite `docs/architecture.md`,
`docs/development.md`, `docs/pi-agent-integration.md` (the thesis still
holds; the transport section changes), `docs/user-guide.md` (BYOK setup,
CORS for local servers, storage/backup), `README.md`. New Pages workflow.

**Phase 8 — Optional: `DirectoryStore`** (File System Access mirror).

---

## 8. Decisions already made (do not re-litigate)

- Client-only; no proxy, no optional backend mode.
- `pi-agent-core` + `pi-ai` in-browser is "the proper SDK" for this host.
  Not RPC, not a Node sidecar, not `pi-coding-agent`.
- BYOK: user-configured OpenAI/Anthropic-compatible endpoints for text,
  Gemini key for images. No bundled credentials of any kind.
- PWA, installable, GitHub Pages.
- Storage: IndexedDB documents + OPFS blobs, export/import zip in the §2.2
  layout as a launch requirement; directory mirror as a follow-up behind an
  interface designed now.
- Book context is seeded as a message prefix per task, not chunk-read by a
  tool.
- Keep all six views and the domain model; keep frontend conventions.
- React stays (do not port to Svelte to share plebchat code; copy patterns,
  not files).

## 9. Open questions for the executing agent to settle while planning

- Whether `agentTraces` should store raw `AgentMessage[]` or the projected
  `PiTraceDocument` (recommendation: raw, project on read).
- Exact `pi-agent-core` 0.85.1 API surface vs 0.80.6 (check before writing
  `runtime.ts`).
- Whether the print module reproduces reportlab output exactly or the
  layout editor's own preview (`printLayout.ts`, `singlePagePreview.ts`)
  becomes the single source for both screen and PDF. Recommendation: the
  latter, if it removes duplicated layout math.
- Pages path layout for app vs docs (§5.7).

## 10. References on this machine

- plebchat agent layer: `/Users/satoshi/Downloads/PLEBCHAT-PLATFORM/plebchat-me/app/src/lib/ai/`
  (`runner.svelte.ts`, `model.ts`, `providers.ts`, `tools.ts`, `retry-feedback.ts`)
- plebchat storage/PWA: `…/app/src/lib/db/`, `…/app/src/lib/pwa/`, `…/app/package.json`
- PiChessBrowser minimal runner: `/Users/satoshi/Downloads/pi-web-apps/PiChessBrowser/src/ai/piPlayer.ts`
- pi monorepo source: `/Users/satoshi/Downloads/pi-web-apps/pi/packages/{ai,agent,coding-agent}`
- pi docs (installed CLI): `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/`
  (`sdk.md`, `rpc.md`, `extensions.md`, `skills.md`, `session-format.md`)
- Current integration thesis: `docs/pi-agent-integration.md` (sections 0–2 still apply)
