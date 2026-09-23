# User Guide: Adapting a Story into a Comic

## Setup

Comic Canvas runs in your browser and talks only to services you configure.
Open **Settings** (gear icon) once:

- **Text model (agent tasks).** Add an endpoint: any OpenAI-completions
  compatible server. Presets fill in the base URL for OpenAI, OpenRouter,
  LM Studio, Ollama and llama.cpp; paste a key if the server needs one, click
  **Fetch models**, check each model's **context window** (the book must fit
  in it), and pick a **Default model**. Keys are stored in this browser and
  sent only to that endpoint.
- **Local servers must allow this site's origin (CORS):** LM Studio → enable
  CORS in the server settings; Ollama → start it with
  `OLLAMA_ORIGINS=https://abvstudio.net`; llama.cpp → run `llama-server`
  with `--cors` or the matching origin. Without it the browser cannot reach
  the server and "Fetch models" fails with a clear message.
- **Image generation.** Paste a Google AI Studio (Gemini) key; it is checked
  against the API before it is saved. Choose default image model, aspect
  ratio and size.
- **Storage.** Projects live in this browser. Use **Export** on a project
  card (or **Export all projects** here) to back them up as zips, and
  **Import** on the landing page to restore. Installing the app (browser
  install prompt, or the landing page hint) asks for persistent storage so
  the browser will not evict your projects; Safari also stops its seven-day
  cleanup for installed apps. Supported browsers: Chrome, Edge, Firefox,
  Safari 26+; private-browsing windows usually cannot store projects.

The workflow is a pipeline. Each step feeds the next, and some steps are hard-gated
(the app blocks you with an explanation if you skip ahead).

## 1. Import the book — Story view

Upload your manuscript (`book.txt`). Then run **Read book**: the app measures
the book against your default model's context window and prepares it for the
agent. Every later book task sends the whole book with its request (the task
panel shows the token estimate), so a model with a large window and prompt
caching keeps this cheap. If the book does not fit, the task says so — pick a
larger model and run **Read book** again.

## 2. Set the visual style and style anchors — Canvas view

- Pick or create a **visual style** (a short style snippet appended to every
  generation prompt, e.g. "soft watercolor wash, thick ink outlines").
- Generate on the seeded **Character Style** / **Scene Style** anchor nodes on
  the canvas. The take you keep becomes that style tag's **canonical** image,
  used as a style input for later generations.

## 3. Concept art — Concept Art view

Explore look and feel before committing to canonical designs. Create cards (or let
the agent **suggest** character/location concepts), edit them, and generate on the canvas.
Concept art is a *style* input — it does not stand in for canonical references.

## 4. Extract characters and locations — Characters and Locations views

Run **Find characters** to register the cast, then **Extract** each character
(or **Extract all**). This fills each character record: summary, visual
description, performance notes, continuity notes, and reference-sheet prompt
variants (base plus durable looks like young/adult or post-injury, each with a
story context). Review and edit records in the structured editor; use the
**Refine** feedback box to have the agent revise a record ("make her scar more
prominent, add a post-duel variant"). These slugs and look descriptors are what
panel prompts are built from.

Locations work exactly the same way on the **Locations** page: **Find
locations** registers the story's recurring settings, **Extract** fills each
record with a visual description and wide establishing-shot prompt variants
(base plus durable states like "after the fire", each with a story context).

**Gate:** panel prompt drafting is blocked until at least one character with look
text exists.

## 5. Generate canonical reference sheets — Canvas view

Generate the character sheets and location establishing shots (per variant —
each variant's **Draft** button creates a tagged canvas node) from their
prompts. Each variant's active asset becomes that look's canonical reference
image.

**Gate:** drafting a panel to the canvas is blocked for any tagged entity that has
no reference asset yet.

## 6. Create panels — Story view

Highlight passages in the book text to carve them into panels. You decide the
beats, or hand a passage to the agent: highlight a section (a scene or part
of a chapter, not the whole book) and choose **Chunk with pi**. It creates
one panel per visual beat inside the selection, skips text that is already a
panel, and records a shot (establishing, wide, medium, close-up, extreme
close-up, insert, two-shot) and a size hint on each. Both are editable in the
panel editor and feed the prompt drafter's composition. Chunked panels start
unplaced; place them onto pages in the **Layout** view.

## 7. Draft panel prompts — Story or Layout view (panel editor)

Open a panel and use **Draft with pi** (or **Draft with input…** to seed an idea).
The agent writes a generation-ready prompt using the canonical character looks and location
descriptions, and tags the panel with `characterSlugs`/`locationSlug`. Review the
**Who and where** chips and adjust if needed. Iterate with the one-line
**Refine** feedback input.

## 8. Draft to canvas and generate

Per saved prompt, click **Draft to canvas**. This creates a canvas node with the
prompt plus the tagged entities' reference sheets as Gemini reference images.
Generate; the resulting asset **auto-attaches back to the panel** and becomes its
active image.

## 9. Layout and export — Layout view

Fine-tune panel placement, captions, and visible text. Export the finished comic
as a booklet PDF.

## Monitoring

The **Agent** view is a dashboard of all agent tasks: live progress for running
tasks and a history with full traces for past ones. Tasks run inside the page:
closing or reloading the tab stops them (the app warns first), and they are
marked failed on the next load.

```mermaid
flowchart LR
    book[Import + read book] --> style[Visual style + style anchors]
    style --> concept[Concept art]
    concept --> extract[Extract characters/locations]
    extract --> sheets[Generate reference sheets]
    sheets --> panels[Create panels]
    panels --> prompts[Draft panel prompts]
    prompts --> canvas[Draft to canvas + generate]
    canvas --> layout[Layout + booklet PDF]
```
