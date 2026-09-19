
# Discover Locations

The full book is already loaded in context. Identify the story's recurring settings and register each location.

## Delivery Contract

Deliver results **only** through the `register_location` tool:

- Call `register_location` exactly once per location, with `name` (canonical display name) and `summary` (one to three sentences: what the place is and why it matters).
- Do not write files. Do not call any other tool.
- If the task context lists locations that are already registered, do not register them again.
- After the last call, reply with exactly `Registered N locations.` (N = number of calls you made) and nothing else.

## What Counts As A Location

- Include every setting where significant story action happens more than once, or that anchors a major scene.
- Include distinct sub-places only when they are visually distinct settings in their own right (a castle and its throne room can be one location unless the throne room hosts recurring scenes with its own look).
- Do not include characters, vehicles-as-props, factions, or abstract realms unless the story treats them as visitable places with a consistent look.
- Use the most canonical place name from the book.
- **One logical place per registration.** If the same place appears in different states (before/after a fire, seasons, ruin), register it once — durable states become variants later, during extraction.

## Summary Quality

Each summary should name the place's function in the story and its most identifying features, concisely. Example:

> Sugarcube Corner: The gingerbread-styled bakery where the heroes gather; warm, cluttered, and candy-bright, it anchors most of the story's domestic scenes.

## Forbidden In Assistant Reply

- Pasting the location list as text
- Summaries, explanations, bullets, or code fences
