
# Extract Location

The full book is already loaded in context. The user names one registered location (by slug) and provides its current record. Fill the record in with story-backed detail.

## Delivery Contract

Deliver results **only** through the `update_location` tool:

- Patch the location named in the task; use its `slug` exactly as given.
- Prefer one complete `update_location` call carrying all fields and variants.
- Do not write files. Do not paste the record in your reply.
- After delivering, reply with exactly `Updated <slug>.` and nothing else.

## Fields

- `summary` — what the place is and why it matters (keep or improve the registered summary).
- `visualDescription` — source-supported appearance: architecture or landscape, scale, materials, palette, lighting character, layout, and repeated visual features.
- `continuityNotes` — features that must remain consistent across panels, scenes, and variants. If a needed design detail is unspecified in the book, record it here as an open design choice.

Do not invent visual details that are not supported by the book.

## Variants

Always include a `base` variant.

Add extra variants only for **durable visual state changes** as defined by the story — not weather, time of day, or momentary staging. Good reasons:

- Destruction or rebuilding (after the fire, in ruins, restored).
- A large time jump that visibly ages or transforms the place.
- A permanent seasonal or magical state the story treats as a distinct look.
- Occupation, abandonment, or repurposing that changes the visible character of the place.

Each non-base variant needs:

- a slug-style key (e.g. `after-the-fire`, `in-ruins`),
- `label` — short human label ("After the fire"),
- `storyContext` — when the state applies ("after the fire in chapter 5"),
- a `prompt` stating only the **visual delta** from the base variant (the base
  reference sheet is attached automatically as a reference image at generation time).

If there are no durable major visual changes, include only `base`.

## Establishing-Shot Prompts

Every variant prompt describes a single reference image of the place:

- A **wide establishing shot** that shows the location's overall layout and character; state the camera height (e.g. eye level, slight aerial) and framing.
- Specify the dominant lighting and palette.
- **No characters in frame. No text, no labels, no watermarks.**

For the `base` prompt:

1. `Location reference for [name],` then essential visual facts (structure, scale, materials, palette, lighting).
2. `Match the reference image's rendering, palette, line weight, and shadows exactly.`
3. Camera/framing line and the no-characters/no-text constraints.

For non-base prompts:

1. `Same location as the reference image.`
2. State only the visual delta from the base variant.
3. Keep the same camera/framing intent and the no-characters/no-text constraints.

Do **not** repeat the full location description or style prose in variant prompts.

## Forbidden In Assistant Reply

- Pasting the record or prompts after the tool call
- Summaries, explanations, bullets, or code fences
