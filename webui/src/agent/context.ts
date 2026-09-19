/** Context assemblers for task prompts (ported from pi_profiles.py helpers). */
import type { CharacterRecord, LocationRecord } from '../types';
import { variantEntityKey, type EntityRecord } from '../services/adaptation';
import { existingConceptSummaries, listCards } from '../services/conceptCards';

export type EntityKindId = 'character' | 'location';

export const ENTITY_CONTEXT_FIELDS: Record<EntityKindId, readonly string[]> = {
  character: ['slug', 'name', 'summary', 'visualDescription', 'performanceNotes', 'continuityNotes'],
  location: ['slug', 'name', 'summary', 'visualDescription', 'continuityNotes'],
};

export function clipText(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit).replace(/\s+$/, '') + '…';
}

/** Editable-fields-only view of a record for agent prompts (no asset state). */
export function entityRecordContext(kind: EntityKindId, record: CharacterRecord | LocationRecord): string {
  const loose = record as unknown as Record<string, unknown>;
  const view: Record<string, unknown> = {};
  for (const field of ENTITY_CONTEXT_FIELDS[kind]) view[field] = loose[field];
  view.variants = Object.fromEntries(
    Object.entries(record.variants).map(([key, variant]) => [key, { label: variant.label, storyContext: variant.storyContext, prompt: variant.prompt }]),
  );
  return JSON.stringify(view, null, 2);
}

/** One line per record variant: base look, then flat-key deltas with story context. */
export function entityLookLines(records: Record<string, EntityRecord>): string[] {
  const lines: string[] = [];
  for (const [slug, record] of Object.entries(records)) {
    const base = record.variants.base;
    const look = (base ? base.prompt : '') || record.visualDescription || record.summary;
    if (look.trim()) lines.push(`- ${slug}: ${clipText(look, 400)}`);
    for (const [variantKey, variant] of Object.entries(record.variants)) {
      if (variantKey === 'base') continue;
      const flatKey = variantEntityKey(slug, variantKey);
      const storyContext = variant.storyContext.trim();
      const delta = variant.prompt.trim() || variant.label.trim() || variantKey;
      const prefix = storyContext ? `[${storyContext}] ` : '';
      lines.push(`- ${flatKey}: ${prefix}${clipText(delta, 300)}`);
    }
  }
  return lines;
}

export function registeredRecordLines(records: Record<string, EntityRecord>): string[] {
  return Object.keys(records)
    .sort()
    .map((slug) => {
      const record = records[slug];
      const summary = record.summary.trim();
      return summary ? `- ${record.name || slug}: ${summary}` : `- ${record.name || slug}`;
    });
}

export async function conceptContextLines(slug: string): Promise<string[]> {
  const existing = await existingConceptSummaries(slug);
  return ['Existing concept ideas on the canvas (do not duplicate these):', ...(existing.length ? existing : ['(none)'])];
}

export async function existingCardIds(slug: string): Promise<Set<string>> {
  return new Set((await listCards(slug, true)).map((card) => card.id));
}

// --- panel prompt context -----------------------------------------------------------

import type { StoryPanel, StoryPanelDocument } from '../types';
import { readDocument } from '../services/storyPanels';
import { status as adaptationStatus } from '../services/adaptation';
import { conflict } from '../services/errors';
import geminiImageGuide from './prompts/gemini-image.md?raw';

export function panelStoryText(panel: StoryPanel): string {
  return (panel.storyText || panel.selectedText).trim();
}

export async function findPanel(slug: string, panelId: string): Promise<{ document: StoryPanelDocument; panel: StoryPanel | null }> {
  const document = await readDocument(slug);
  return { document, panel: document.panels.find((item) => item.id === panelId) ?? null };
}

/** Reading order: book-linked panels by offset, then manual panels by order.
 *  Panels without story text carry no context and are excluded. */
export function sortedStoryPanels(document: StoryPanelDocument): StoryPanel[] {
  const panels = document.panels.filter((panel) => panel.sourceKind === 'panel' && panelStoryText(panel));
  const key = (panel: StoryPanel): [number, number, number] =>
    panel.startOffset !== null && panel.startOffset !== undefined ? [0, panel.startOffset, panel.order] : [1, panel.order, 0];
  return [...panels].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
}

export const GEMINI_IMAGE_GUIDE = geminiImageGuide;

/** Small assembled context: panel text, neighbors, cast looks, style. The
 *  image-prompt guide is part of the system prompt for these profiles. */
export async function panelPromptContextLines(slug: string, panel: StoryPanel, document: StoryPanelDocument): Promise<string[]> {
  const lines: string[] = [];
  const ordered = sortedStoryPanels(document);
  const index = ordered.findIndex((item) => item.id === panel.id);
  if (index >= 0) {
    const before = ordered.slice(Math.max(0, index - 2), index);
    const after = ordered.slice(index + 1, index + 3);
    if (before.length) {
      lines.push('Story context — panels just before this one:');
      for (const neighbor of before) lines.push(`- ${clipText(panelStoryText(neighbor), 400)}`);
      lines.push('');
    }
    lines.push("THIS PANEL's story text (draw this moment):", panelStoryText(panel), '');
    if (after.length) {
      lines.push('Story context — panels just after this one:');
      for (const neighbor of after) lines.push(`- ${clipText(panelStoryText(neighbor), 400)}`);
      lines.push('');
    }
  } else {
    lines.push("THIS PANEL's story text (draw this moment):", panelStoryText(panel), '');
  }
  const status = await adaptationStatus(slug);
  const lookLines = entityLookLines(status.characters);
  if (lookLines.length) {
    lines.push(
      'Canonical characters (the slugs before the colon are the ONLY valid characterSlugs ' +
        'values; any character visible in the panel must be described using these look ' +
        'descriptors, never just their name. Variant slugs like hero-young are the same ' +
        "character in a different durable look — when this panel's story moment matches a " +
        "variant's bracketed story context, use the variant slug instead of the base slug):",
      ...lookLines,
      '',
    );
  }
  const locationLines = entityLookLines(status.locations);
  if (locationLines.length) {
    lines.push(
      'Canonical locations (the slugs before the colon are the ONLY valid locationSlug ' +
        "values; pick the one that matches this panel's setting, and use its description for " +
        'the setting portion of the prompt. Variant slugs like castle-after-the-fire are the ' +
        "same place in a different durable state — when this panel's story moment matches a " +
        "variant's bracketed story context, use the variant slug instead of the base slug):",
      ...locationLines,
      '',
    );
  }
  const defaultStyle = status.visualStyles.find((style) => style.id === status.defaultVisualStyleId);
  if (defaultStyle && defaultStyle.prompt.trim()) {
    lines.push('Project visual style (appended automatically at generation time — do NOT restate it in the prompt):', clipText(defaultStyle.prompt, 300), '');
  }
  return lines;
}

/** Process gate: panel prompts need a canonical cast to reference. */
export async function requireExtractedCharacters(slug: string): Promise<void> {
  const status = await adaptationStatus(slug);
  const hasLooks = Object.values(status.characters).some((record) => ((record.variants.base?.prompt ?? '') || record.visualDescription).trim());
  if (!hasLooks) {
    throw conflict('Extract characters (and locations) before drafting panel prompts — there is no canonical cast to reference.');
  }
}
