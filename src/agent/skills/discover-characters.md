
# Discover Characters

The full book is already loaded in context. Identify the complete cast of the story and register each character.

## Delivery Contract

Deliver results **only** through the `register_character` tool:

- Call `register_character` exactly once per character, with `name` (canonical display name) and `summary` (one to three sentences: who they are and why they matter).
- Do not write files. Do not call any other tool.
- If the task context lists characters that are already registered, do not register them again.
- After the last call, reply with exactly `Registered N characters.` (N = number of calls you made) and nothing else.

## Who Counts As A Character

- Include every named character.
- Include important unnamed recurring characters only if they function like characters.
- Do not include locations, factions, companies, props, objects, technologies, abstract concepts, or settings unless they are personified characters in the story.
- Use the most canonical character name; put a well-known alias in parentheses after it when useful, e.g. `Dixie Flatline (McCoy Pauley)`.
- **One logical character per registration.** If the same person appears under multiple names or visual states, register them once. Merge alternate identities, disguises, age states, transformed or alternate forms, and costumes into that single character — visual states become variants later, during extraction.
- Do not split one person into separate registrations such as `Dr Jekyll` and `Mr Hyde`, or `Anna` and `Anna as a child`.

## Summary Quality

Each summary should name the character's role and their most important identifying traits, concisely. Example:

> Molly Millions: A street samurai and razorgirl hired as Case's bodyguard, defined by mirrored lenses, retractable blades, professionalism, cynicism, and independence.

## Forbidden In Assistant Reply

- Pasting the character list as text
- Summaries, explanations, bullets, or code fences
