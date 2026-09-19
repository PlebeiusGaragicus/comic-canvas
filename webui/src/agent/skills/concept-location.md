
# Concept Location

The full book is already loaded in context. The user provides:
2. Runner context with existing concept ideas and locations already covered.

Invent **one** new location concept that fits the book's world — a minor setting, recurring backdrop, or extrapolated place consistent with the story. Do **not** duplicate any location in the existing location index/prompts or existing concept ideas.

## Delivery

Call the **`create_concept_card` tool exactly once** with:

- `subjectKind`: `location`
- `displayName`: a short human-readable name for the place (e.g. `Harbor Fish Market`)
- `prompt`: the finished image-generation prompt (rules below)

Do not write any files. After the tool succeeds, reply with exactly `Created <displayName>.` and nothing else. If the tool returns an error, fix the input and call it again.

## Prompt Rules

- Write the prompt as direct image-generation instructions, not metadata. Do not start with labels such as `Environment reference for`, `Location prompt for`, or the raw name.
- Write one focused paragraph of 5-8 sentences.
- Use book-supported visual details when available; stay honest when the book is sparse.
- Describe architecture or terrain, spatial relationships, materials, fixed objects, lighting, atmosphere, scale, and color when supported.
- Include this sentence once: `Match the reference image's environmental rendering, palette, lighting, and detail level.`
- End every prompt with `No characters, no text, no labels, no watermarks.`
- Do not paste source line numbers, quotes, or metadata labels into the prompt body.
- Do not include storyboard beats, character action, dialogue, captions, or speech bubbles unless the location state itself requires the detail.

## Forbidden In Assistant Reply

- Pasting the prompt after the tool call
- Summaries, explanations, bullets, or code fences
