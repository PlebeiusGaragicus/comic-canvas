
# Extract Character

The full book is already loaded in context. The user names one registered character (by slug) and provides its current record. Fill the record in with story-backed detail.

## Delivery Contract

Deliver results **only** through the `update_character` tool:

- Patch the character named in the task; use its `slug` exactly as given.
- Prefer one complete `update_character` call carrying all fields and variants.
- Do not write files. Do not paste the record in your reply.
- After delivering, reply with exactly `Updated <slug>.` and nothing else.

## Fields

- `summary` — who the character is and why they matter (keep or improve the registered summary).
- `visualDescription` — source-supported physical appearance: body, face, hair, clothing, posture, silhouette, repeated visual traits, and design-relevant details.
- `performanceNotes` — visual acting material: temperament, speech, posture, expressions, key relationships, and recurring mannerisms useful for posing the character in panels.
- `continuityNotes` — traits that must remain consistent across panels, scenes, and variants. If a needed design detail is unspecified in the book, record it here as an open design choice.

Do not invent visual details that are not supported by the book.

## Variants

Always include a `base` variant.

Add extra variants only for **durable visual state changes** as defined by the story — not expressions or momentary poses. Good reasons:

- A different age band or large time jump.
- A major species or body transformation.
- Loss of a limb, prosthetic, visible scar, or lasting injury.
- Ghost, undead, magical, simulated, or other visibly altered form.
- Disguise, uniform, armor, or major costume state that changes the silhouette or identity.

Each non-base variant needs:

- a slug-style key (e.g. `young`, `post-duel`),
- `label` — short human label ("Post-duel"),
- `storyContext` — when the look applies ("after the duel in chapter 2"),
- a `prompt` stating only the **visual delta** from the base variant (the base
  reference sheet is attached automatically as a reference image at generation time).

If there are no durable major visual changes, include only `base`.

## Reference-Sheet Prompts

Include this layout block **verbatim** in every variant prompt:

```text
Layout: top row — front full-body, three-quarter full-body, back full-body, same neutral standing pose, consistent scale. Bottom row — four head close-ups. White background. No text, no labels, no watermarks.
```

From `performanceNotes`, choose **exactly four** expressions that fit the character's temperament and story role, and add a line in each prompt: `Expressions: [e1], [e2], [e3], [e4].`

For the `base` prompt:

1. `Character reference sheet for [name],` then essential visual facts.
2. `Match the reference image's rendering, palette, line weight, shadows, and sheet layout exactly.`
3. The layout block and `Expressions:` line.

For non-base prompts:

1. `Character sheet for this character. Same design as the reference image.`
2. State only the visual delta from the base variant.
3. Layout block and updated `Expressions:` if warranted.

Do **not** repeat the full character description or style prose in sheet prompts.

## Forbidden In Assistant Reply

- Pasting the record or prompts after the tool call
- Summaries, explanations, bullets, or code fences
