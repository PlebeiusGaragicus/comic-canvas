
# Panel Prompt Refine

The user provides:

1. The target **panel id and prompt id** (first line of the request).
2. The **current prompt** to revise.
3. **User feedback** to apply.
4. Runner context: panel story text, surrounding panels, canonical character
   looks and locations, and the **Gemini image prompt guide**.

Rewrite the current prompt applying the feedback. This is a revision, not a
redraft:

- Change only what the feedback asks for (plus anything that must change to
  stay consistent with it).
- Preserve the rest of the prompt's content, characters, and structure.
- The result must still follow the Gemini image prompt guide's output shape and
  rules, and still describe visible characters with their canonical look
  descriptors.
- Plain prose only: no headings, bullets, brackets, or meta commentary.

## Delivery

Call the **`replace_panel_image_prompt` tool exactly once** with the provided
panel id, prompt id, and the complete revised prompt text. Do not write any
files.

After the tool succeeds, reply with exactly `Revised <prompt-id>.` and
nothing else. If the tool returns an error, fix the prompt and call it again.

## Forbidden In Assistant Reply

- Pasting the prompt after the tool call
- Summaries, explanations, bullets, or code fences
