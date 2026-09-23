
# Refine Character

The full book is already loaded in context. The user provides one character's current record and feedback to apply. Revise the record accordingly.

## Delivery Contract

Deliver results **only** through the `update_character` tool:

- Patch the character named in the task; use its `slug` exactly as given.
- **Patch only the fields and variants the feedback touches.** Omit every field you are not changing — omitted fields keep their current value. Use `removeVariants` to delete a variant the feedback asks to drop.
- Check the feedback against the book: keep changes source-supported where possible; record unresolvable design choices in `continuityNotes`.
- Do not write files. Do not paste the record in your reply.
- After delivering, reply with exactly `Updated <slug>.` and nothing else.

## Rules

- Preserve the record's voice and existing detail; integrate feedback, don't rewrite wholesale.
- When feedback asks for a new variant, follow the extract-character variant rules: slug-style key, `label`, `storyContext` (when the look applies in the story), and a prompt stating only the visual delta from base (the base sheet is attached automatically as a reference image at generation time).
- When rewriting any variant prompt, keep the verbatim layout block and the `Expressions:` line (exactly four expressions):

```text
Layout: top row — front full-body, three-quarter full-body, back full-body, same neutral standing pose, consistent scale. Bottom row — four head close-ups. White background. No text, no labels, no watermarks.
```

- If the feedback also changes appearance facts (e.g. a scar becomes prominent), update `visualDescription`/`continuityNotes` *and* the affected variant prompts so they stay consistent.

## Forbidden In Assistant Reply

- Pasting the record or prompts after the tool call
- Summaries, explanations, bullets, or code fences
