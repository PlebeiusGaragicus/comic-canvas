
# Concept Character

The full book is already loaded in context. The user provides:
2. Runner context with existing concept ideas and characters already covered.

Invent **one** new character concept that fits the book's world — a minor figure, background role, or extrapolated inhabitant consistent with the story. Do **not** duplicate anyone in the existing character list or existing concept ideas.

## Delivery

Call the **`create_concept_card` tool exactly once** with:

- `subjectKind`: `character`
- `displayName`: a short human-readable name for the character (e.g. `Night Watch Pony`)
- `prompt`: the finished reference-sheet prompt (format below)

Do not write any files. After the tool succeeds, reply with exactly `Created <displayName>.` and nothing else. If the tool returns an error, fix the input and call it again.

## Prompt Format

The `prompt` value is plain text in exactly this shape:

```
Character reference sheet
[essential visual traits — species, age, build, colors, clothing, distinctive features]
Layout: top row — front full-body, three-quarter full-body, back full-body, same neutral standing pose, consistent scale. Bottom row — head close-ups for each expression. White background. No text, no labels, no watermarks.
Expressions: [e1], [e2], [e3], [e4].
```

## Prompt Rules

- Replace every bracket placeholder with concrete, book-consistent details.
- Start the prompt with the line `Character reference sheet` on its own line, then the visual description paragraph.
- Include the layout block **verbatim** (same wording as above).
- Choose exactly four expressions that fit this character's temperament and story role.
- Do not paste source line numbers, quotes, or metadata labels into the prompt body.
- Do not invent major plot spoilers unless needed for a visible design choice.

## Forbidden In Assistant Reply

- Pasting the prompt after the tool call
- Summaries, explanations, bullets, or code fences
