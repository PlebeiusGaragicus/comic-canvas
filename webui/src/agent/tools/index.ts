/** Domain tools for task agents (ported from .pi/extensions/photo-web.ts).
 *  Each factory closes over the project slug and calls the services directly. */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type, type Static, type TSchema } from 'typebox';
import type { CharacterPatchPayload, LocationPatchPayload } from '../../types';
import { createCharacter, createLocation, listCharacters, listLocations, updateCharacter, updateLocation } from '../../services/adaptation';
import { createCard } from '../../services/conceptCards';

/** Models sometimes emit the arguments object as a JSON string; unwrap it. */
export function repairArguments(args: unknown): unknown {
  if (typeof args === 'string') {
    try {
      return JSON.parse(args);
    } catch {
      return args;
    }
  }
  return args;
}

export function textResult(text: string, terminate = false): { content: [{ type: 'text'; text: string }]; details: Record<string, never>; terminate?: boolean } {
  return terminate ? { content: [{ type: 'text', text }], details: {}, terminate: true } : { content: [{ type: 'text', text }], details: {} };
}

function defineTool<T extends TSchema>(tool: Omit<AgentTool<T>, 'prepareArguments'> & { execute: (toolCallId: string, params: Static<T>) => Promise<ReturnType<typeof textResult>> }): AgentTool<T> {
  return { ...tool, prepareArguments: (args) => repairArguments(args) as Static<T> } as AgentTool<T>;
}

const VARIANT_PATCH = Type.Object({
  label: Type.Optional(Type.String({ description: 'Short human label, e.g. "Post-duel"' })),
  storyContext: Type.Optional(Type.String({ description: 'When this look applies in the story, e.g. "after the duel in chapter 2"' })),
  prompt: Type.Optional(Type.String({ description: 'Complete reference-sheet prompt with layout block and Expressions line' })),
});

function recordLines(records: Array<{ slug: string; name: string; visualDescription: string; variants: Record<string, { prompt: string }> }>, empty: string): string {
  const lines = records.map((record) => {
    const extracted = record.visualDescription.trim() && record.variants.base?.prompt?.trim();
    const variantKeys = Object.keys(record.variants).join(', ') || 'none';
    return `${record.slug} | ${record.name || record.slug} | ${extracted ? 'extracted' : 'empty'} | variants: ${variantKeys}`;
  });
  return lines.length ? lines.join('\n') : empty;
}

export function registerCharacterTool(slug: string): AgentTool {
  return defineTool({
    name: 'register_character',
    label: 'Register character',
    description:
      'Register one character from the book as a new character record. ' +
      'Call exactly once per character; use update_character afterwards to fill in details.',
    parameters: Type.Object({
      name: Type.String({ description: 'Canonical display name, e.g. "Pinkie Pie"' }),
      summary: Type.String({ description: 'One-to-three sentence summary: who they are and why they matter in the story' }),
    }),
    executionMode: 'sequential',
    async execute(_id, params) {
      const record = await createCharacter(slug, { name: params.name, summary: params.summary });
      return textResult(`Registered: ${JSON.stringify(record)}`);
    },
  });
}

export function listCharactersTool(slug: string): AgentTool {
  return defineTool({
    name: 'list_characters',
    label: 'List characters',
    description:
      'List every registered character record: slug, name, extraction state, and variant keys. ' +
      'Use the returned slugs when calling update_character.',
    parameters: Type.Object({}),
    async execute() {
      return textResult(recordLines(await listCharacters(slug), '(no characters registered)'));
    },
  });
}

export function updateCharacterTool(slug: string): AgentTool {
  return defineTool({
    name: 'update_character',
    label: 'Update character',
    description:
      'Patch one registered character record: any of the description fields and/or variants. ' +
      'Only include the fields you are changing; omitted fields keep their current value. ' +
      "Variants are upserted by key ('base' plus optional durable-look variants like 'aged' or 'post-duel').",
    parameters: Type.Object({
      slug: Type.String({ description: 'Character slug from the task context or list_characters' }),
      name: Type.Optional(Type.String({ description: 'Canonical display name' })),
      summary: Type.Optional(Type.String({ description: 'Who they are and why they matter' })),
      visualDescription: Type.Optional(Type.String({ description: 'Source-supported appearance: body, face, clothing, silhouette, recurring visual traits' })),
      performanceNotes: Type.Optional(Type.String({ description: 'Visual acting: temperament, speech, posture, recurring mannerisms and expressions' })),
      continuityNotes: Type.Optional(Type.String({ description: 'Traits that must stay consistent across panels and variants; open design choices' })),
      variants: Type.Optional(Type.Record(Type.String(), VARIANT_PATCH, { description: "Variant patches keyed by variant slug; 'base' is required for a complete character" })),
      removeVariants: Type.Optional(Type.Array(Type.String(), { description: 'Variant keys to delete from the record' })),
    }),
    executionMode: 'sequential',
    async execute(_id, params) {
      const { slug: characterSlug, ...patch } = params;
      const record = await updateCharacter(slug, characterSlug, patch as CharacterPatchPayload);
      return textResult(`Updated: ${JSON.stringify(record)}`);
    },
  });
}

export function registerLocationTool(slug: string): AgentTool {
  return defineTool({
    name: 'register_location',
    label: 'Register location',
    description:
      'Register one location from the book as a new location record. ' +
      'Call exactly once per location; use update_location afterwards to fill in details.',
    parameters: Type.Object({
      name: Type.String({ description: 'Canonical display name, e.g. "Sugarcube Corner"' }),
      summary: Type.String({ description: 'One-to-three sentence summary: what this place is and why it matters in the story' }),
    }),
    executionMode: 'sequential',
    async execute(_id, params) {
      const record = await createLocation(slug, { name: params.name, summary: params.summary });
      return textResult(`Registered: ${JSON.stringify(record)}`);
    },
  });
}

export function listLocationsTool(slug: string): AgentTool {
  return defineTool({
    name: 'list_locations',
    label: 'List locations',
    description:
      'List every registered location record: slug, name, extraction state, and variant keys. ' +
      'Use the returned slugs when calling update_location.',
    parameters: Type.Object({}),
    async execute() {
      return textResult(recordLines(await listLocations(slug), '(no locations registered)'));
    },
  });
}

export function updateLocationTool(slug: string): AgentTool {
  return defineTool({
    name: 'update_location',
    label: 'Update location',
    description:
      'Patch one registered location record: any of the description fields and/or variants. ' +
      'Only include the fields you are changing; omitted fields keep their current value. ' +
      "Variants are upserted by key ('base' plus optional durable-state variants like 'after-the-fire').",
    parameters: Type.Object({
      slug: Type.String({ description: 'Location slug from the task context or list_locations' }),
      name: Type.Optional(Type.String({ description: 'Canonical display name' })),
      summary: Type.Optional(Type.String({ description: 'What this place is and why it matters' })),
      visualDescription: Type.Optional(Type.String({ description: 'Source-supported appearance: architecture, landscape, scale, palette, recurring visual features' })),
      continuityNotes: Type.Optional(Type.String({ description: 'Features that must stay consistent across panels and variants; open design choices' })),
      variants: Type.Optional(
        Type.Record(
          Type.String(),
          Type.Object({
            label: Type.Optional(Type.String({ description: 'Short human label, e.g. "After the fire"' })),
            storyContext: Type.Optional(Type.String({ description: 'When this state applies in the story, e.g. "after the fire in chapter 5"' })),
            prompt: Type.Optional(Type.String({ description: 'Complete establishing-shot reference prompt for this state' })),
          }),
          { description: "Variant patches keyed by variant slug; 'base' is required for a complete location" },
        ),
      ),
      removeVariants: Type.Optional(Type.Array(Type.String(), { description: 'Variant keys to delete from the record' })),
    }),
    executionMode: 'sequential',
    async execute(_id, params) {
      const { slug: locationSlug, ...patch } = params;
      const record = await updateLocation(slug, locationSlug, patch as LocationPatchPayload);
      return textResult(`Updated: ${JSON.stringify(record)}`);
    },
  });
}

export function createConceptCardTool(slug: string): AgentTool {
  return defineTool({
    name: 'create_concept_card',
    label: 'Create concept card',
    description: 'Create one new concept-art card with a finished image-generation prompt. Call exactly once per invented concept.',
    parameters: Type.Object({
      subjectKind: StringEnum(['character', 'location'] as const),
      displayName: Type.String({ description: 'Short human-readable name for the concept' }),
      prompt: Type.String({ description: 'The complete concept-art prompt text' }),
    }),
    executionMode: 'sequential',
    async execute(_id, params) {
      const card = await createCard(slug, { subjectKind: params.subjectKind, displayName: params.displayName, prompt: params.prompt });
      return textResult(`Created: ${JSON.stringify(card)}`, true);
    },
  });
}
