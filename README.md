# Comic Canvas

Build comic books with AI assistance: an image-generation canvas with
parent → child lineage, a story/panel layout editor with booklet PDF export,
and narrow **agent tasks** that extract characters, locations, and concept
art from a source book.

![Example canvas showing image lineage from sketches to final illustrations](docs/assets/example-canvas.jpg)

**Use it:** <https://abvstudio.net/> — it runs entirely in your browser and
can be installed as an app. **Documentation:** <https://abvstudio.net/docs/>.
Project conventions for contributors and agents live in [AGENTS.md](AGENTS.md).

## What you need

- **A browser with private file storage.** Chrome, Edge, Firefox, or
  Safari 26+. Private-browsing windows usually cannot store projects.
- **A Gemini key** (Google AI Studio) for image generation, pasted into
  Settings. Everything except generation works without one.
- **A text model endpoint** for agent tasks: any OpenAI-completions
  compatible server (OpenAI, OpenRouter, LM Studio, Ollama, llama.cpp, …).
  Local servers must allow this site's origin (CORS). Configure it in
  Settings; keys never leave your device except to the endpoint you chose.

## Your data

Projects live in your browser's storage on this device. Back them up with
**Export** on a project card (a zip in the `projects/<slug>/` layout) or
**Export all projects** in Settings, and bring them back with **Import**.
Installing the app asks the browser for persistent storage so it is not
evicted.

## Workspace views

| View | Purpose |
|------|---------|
| **Story** | Upload `book.txt`, prepare it for the agent, highlight passages into panel chunks, or write panels manually. |
| **Layout** | Place panels on comic pages; captions, crops, spreads, page numbering, PDF export. |
| **Canvas** | Infinite canvas of image assets; draft prompts, generate with Gemini, track lineage. |
| **Concept Art** | Concept cards drafted by hand or suggested by the agent from the book. |
| **Characters / Locations** | Structured records extracted by the agent; edit prompts/variants, publish to canvas. |
| **Agent** | Task dashboard: live task streams and full traces. |

## Development

```bash
npm install
npm run dev          # Vite on :5173
```

Gate before committing:

```bash
npm run typecheck && npm test && npm run build && npm run test:e2e && npm run test:pwa
```

Playwright needs its browsers once: `npx playwright install chromium webkit`.
The docs site builds with `pip install mkdocs-material && mkdocs build --strict`
into `dist/docs`, which the Pages workflow publishes next to the app.
