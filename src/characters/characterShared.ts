import type { CharacterRecord, LocationRecord } from '../types';

/** Characters and locations share the record shape the hub cares about;
 *  performanceNotes is the one character-only field. */
export type EntityRecord = CharacterRecord | LocationRecord;
export type EntityRecordKind = 'character' | 'location';

export function slugifyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function entityDisplayName(record: EntityRecord): string {
  return record.name.trim() || record.slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function entityIsExtracted(record: EntityRecord): boolean {
  const base = record.variants.base;
  return Boolean(record.visualDescription.trim() && base && base.prompt.trim());
}

export type EntityHubState = 'Empty' | 'Extracted' | 'Generated';

export function entityHubState(record: EntityRecord): EntityHubState {
  if (record.variants.base?.assetIds?.length) return 'Generated';
  if (entityIsExtracted(record)) return 'Extracted';
  return 'Empty';
}
