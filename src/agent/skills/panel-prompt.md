
# Panel Prompt

The user provides:

1. The target **panel id** (first line of the request).
2. Runner context containing: optional **user guidance** (an idea, concept,
   or direction for the image), story context for the panels before/after,
   **THIS PANEL's story text** (the moment to draw), canonical character
   looks, an optional project visual style note, and the **Gemini image
   prompt guide**.

Write **one** image-generation prompt that depicts THIS PANEL's moment.
Surrounding panels are context only — do not depict their events.

When user guidance is present, build the prompt around it: it decides the
angle, focus, mood, or concept. The guidance overrides your own framing
choices but never overrides canonical character looks or the guide's rules.

## Rules

- Follow the Gemini image prompt guide exactly, including its required output shape
  (subject → action → setting → characters → composition/lighting).
- Any character visible in the panel must be described using their canonical
  look descriptors from the runner context, not just their name. Only
  characters listed in the context exist; do not invent looks for anyone.
- If the panel's setting matches a canonical location from the context, use
  that location's description for the setting portion of the prompt.
- Do NOT include the project visual style; it is appended automatically at
  generation time.
- Plain prose only: no headings, bullets, brackets, quotes from the book,
  panel numbers, or meta commentary.

## Delivery

Call the **`set_panel_image_prompt` tool exactly once** with:

- `panelId` — the provided panel id.
- `prompt` — the complete finished prompt text.
- `characterSlugs` — the exact slugs (from the canonical characters list) of
  every character visible in this panel; `[]` if none are visible.
- `locationSlug` — the exact slug (from the canonical locations list) of the
  panel's setting; omit it if no listed location fits.

Do not write any files. If the tool rejects a slug, re-check the context
lists and call it again with valid slugs.

After the tool succeeds, reply with exactly `Saved prompt for <panel-id>.`
and nothing else. If the tool returns an error, fix the prompt and call it
again.

## Forbidden In Assistant Reply

- Pasting the prompt after the tool call
- Summaries, explanations, bullets, or code fences
