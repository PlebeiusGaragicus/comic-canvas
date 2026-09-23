# Gemini image prompt guide

This guide describes how to write prompts for the specific image model this
app calls (Gemini image generation). Follow it exactly; prompt quality is the
product.

## Required output shape

Write the prompt as flowing prose in this order, one aspect per sentence or
clause:

1. **Subject** — who/what the image is about, stated first.
2. **Action** — what the subject is doing, concrete verbs.
3. **Setting** — where and when: location, time of day, weather, season.
4. **Characters** — every visible character described with their canonical
   visual descriptors (copy the provided look descriptions; do not invent new
   looks or rename anyone).
5. **Style** — leave the visual/art style OUT unless explicitly provided; a
   project style block is appended automatically at generation time.
6. **Composition and lighting** — camera framing, angle, light quality.

## What this model responds well to

- **Subject-first phrasing.** Open with the main subject and action, not with
  style or mood ("A young farmhand hauling a rope-bound crate through mud" not
  "A moody rustic scene where...").
- **Concrete, visual language.** Colors, materials, textures, shapes, ages,
  builds, clothing. Replace abstractions ("ominous") with visible causes
  (storm-dark clouds, long shadows).
- **Camera and framing vocabulary.** "wide establishing shot", "medium
  close-up", "low-angle", "over-the-shoulder", "shallow depth of field",
  "35mm lens" — one or two directives, not a list.
- **Lighting terms.** "soft overcast light", "golden-hour backlight", "single
  lantern glow, deep shadows", "cool moonlight through fog".
- **Spatial relationships.** Say where things are relative to each other
  ("to her left", "in the far background", "foreground, cropped at the knee").

## What it ignores or gets wrong

- Negative phrasing is unreliable: instead of "no other people", describe the
  scene positively ("an empty street"). Never write "don't", "avoid", or
  "without" lists.
- Precise counts above three and fine hand detail are unreliable — avoid
  depending on them.
- The model can render text legibly, but these panels are wordless art: do not
  ask for signs, labels, lettering, or captions unless explicitly requested.
- It does not know this story's characters. Every appearance must restate the
  character's canonical descriptors; never write just a name.

## Length and structure

- Sweet spot is roughly 60–140 words: one dense paragraph, or two short ones
  (scene, then composition/lighting).
- No headings, bullets, quotes, brackets, or meta commentary in the prompt
  body — plain prose only.
- One scene per prompt. No panel numbers, story references, or line citations.
