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
