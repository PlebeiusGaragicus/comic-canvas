
# Refine Location

The full book is already loaded in context. The user provides one location's current record and feedback to apply. Revise the record accordingly.

## Delivery Contract

Deliver results **only** through the `update_location` tool:

- Patch the location named in the task; use its `slug` exactly as given.
- **Patch only the fields and variants the feedback touches.** Omit every field you are not changing — omitted fields keep their current value. Use `removeVariants` to delete a variant the feedback asks to drop.
- Check the feedback against the book: keep changes source-supported where possible; record unresolvable design choices in `continuityNotes`.
- Do not write files. Do not paste the record in your reply.
- After delivering, reply with exactly `Updated <slug>.` and nothing else.

## Rules

- Preserve the record's voice and existing detail; integrate feedback, don't rewrite wholesale.
- When feedback asks for a new variant, follow the extract-location variant rules: slug-style key, `label`, `storyContext` (when the state applies in the story), and a prompt stating only the visual delta from base (the base sheet is attached automatically as a reference image at generation time).
- Every variant prompt stays a wide establishing shot with a stated camera height and lighting, **no characters in frame, no text, no labels, no watermarks**.
- If the feedback also changes appearance facts (e.g. the tower is now ruined), update `visualDescription`/`continuityNotes` *and* the affected variant prompts so they stay consistent.

## Forbidden In Assistant Reply

- Pasting the record or prompts after the tool call
- Summaries, explanations, bullets, or code fences
