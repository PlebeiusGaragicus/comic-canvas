/** Comic adaptation: metadata, book text, character/location records
 *  (ported from api/adaptation.py). Records live inside the adaptation doc. */
import type {
  AdaptationCanvasImportResponse,
  AdaptationMetadata,
  AdaptationStatus,
  CharacterCreatePayload,
  CharacterPatchPayload,
  CharacterRecord,
  EntityVariant,
  EntityVariantPatchPayload,
  LocationCreatePayload,
  LocationPatchPayload,
  LocationRecord,
} from '../types';
import { getProjectDoc, getScopedDoc, putProjectDoc } from '../store/db';
import { blobExists, readText, writeBlob } from '../store/blobs';
import { notifyChange } from '../store/changes';
import { SLUG_RE, slugify, utcNow } from './common';
import { ServiceError, conflict, invalid, notFound } from './errors';
import { requireProject } from './projects';
import { ensureStyleEntityTags, normalizeTagId, syncEntityTags, updateEntityTagCanonicals } from './tags';
import { defaultVisualStyles, hasVisualStylesDocument, readVisualStyles, resolveDefaultVisualStyleId, writeVisualStyles } from './visualStyles';
import { spawnFromCharacterVariant, spawnFromLocationVariant } from './canvasNodes';

export type EntityRecord = CharacterRecord | LocationRecord;
type EntityRecords = Record<string, EntityRecord>;

const CHARACTER_PATCH_FIELDS = ['name', 'summary', 'visualDescription', 'performanceNotes', 'continuityNotes'] as const;
const LOCATION_PATCH_FIELDS = ['name', 'summary', 'visualDescription', 'continuityNotes'] as const;

export function bookPath(slug: string): string {
  return `projects/${slug}/adaptation/book.txt`;
}

export function emptyMetadata(): AdaptationMetadata {
  return { version: 4, characters: {}, locations: {}, bookContext: null };
}

export function emptyVariant(): EntityVariant {
  return { label: '', storyContext: '', prompt: '', assetIds: [], activeAssetId: null };
}

export async function assetExists(slug: string, assetId: string): Promise<boolean> {
  const doc = await getScopedDoc('assets', slug, assetId);
  return doc !== undefined && (await blobExists(`projects/${slug}/assets/${assetId}.png`));
}

async function clearStaleVariantGroup(slug: string, group: Record<string, EntityVariant>): Promise<boolean> {
  let changed = false;
  for (const [key, variant] of Object.entries(group)) {
    const assetIds: string[] = [];
    for (const assetId of variant.assetIds) {
      if (await assetExists(slug, assetId)) assetIds.push(assetId);
    }
    const activeAssetId = variant.activeAssetId && assetIds.includes(variant.activeAssetId)
      ? variant.activeAssetId
      : assetIds.length > 0 ? assetIds[assetIds.length - 1] : null;
    if (assetIds.length !== variant.assetIds.length || activeAssetId !== (variant.activeAssetId ?? null)) {
      group[key] = { ...variant, assetIds, activeAssetId };
      changed = true;
    }
  }
  return changed;
}

export function variantStatus(variant: EntityVariant): 'generated' | 'ready' | 'missing' {
  return variant.assetIds.length > 0 ? 'generated' : variant.prompt.trim() ? 'ready' : 'missing';
}

export function variantEntityKey(entitySlug: string, variantKey: string): string {
  return variantKey === 'base' ? entitySlug : `${entitySlug}-${variantKey}`;
}

export function entityDisplayName(record: EntityRecord): string {
  const name = record.name.trim();
  if (name) return name;
  return record.slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Flat entity-tag keys for every record variant, plus display names. */
export function entityKeysAndNames(records: EntityRecords): { keys: string[]; names: Record<string, string> } {
  const keys: string[] = [];
  const names: Record<string, string> = {};
  for (const [slugKey, record] of Object.entries(records)) {
    const display = entityDisplayName(record);
    keys.push(slugKey);
    if (record.name.trim()) names[slugKey] = record.name;
    for (const [variantKey, variant] of Object.entries(record.variants)) {
      if (variantKey === 'base') continue;
      const flatKey = variantEntityKey(slugKey, variantKey);
      keys.push(flatKey);
      names[flatKey] = `${display} (${variant.label.trim() || variantKey})`;
    }
  }
  return { keys, names };
}

/** Every valid flat key (slug for base, slug-<variant> otherwise). */
export function entityFlatKeys(records: EntityRecords): Set<string> {
  const keys = new Set<string>(Object.keys(records));
  for (const [slugKey, record] of Object.entries(records)) {
    for (const variantKey of Object.keys(record.variants)) keys.add(variantEntityKey(slugKey, variantKey));
  }
  return keys;
}

export function characterIsExtracted(record: CharacterRecord): boolean {
  const base = record.variants.base;
  return Boolean(record.visualDescription.trim() && base && base.prompt.trim());
}

export function locationIsExtracted(record: LocationRecord): boolean {
  const base = record.variants.base;
  return Boolean(record.visualDescription.trim() && base && base.prompt.trim());
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function createEntityRecord<T extends EntityRecord>(
  records: Record<string, T>,
  payload: CharacterCreatePayload,
  make: (slug: string, now: string) => T,
  kindLabel: string,
): T {
  const entitySlug = payload.slug || slugify(payload.name, kindLabel);
  if (!SLUG_RE.test(entitySlug)) throw invalid(`Invalid ${kindLabel} slug: ${entitySlug}`);
  if (entitySlug in records) throw conflict(`${capitalize(kindLabel)} already exists: ${entitySlug}`);
  const record = make(entitySlug, utcNow());
  records[entitySlug] = record;
  return record;
}

function updateEntityRecord<T extends EntityRecord>(
  records: Record<string, T>,
  entitySlug: string,
  patch: CharacterPatchPayload | LocationPatchPayload,
  fields: readonly string[],
  kindLabel: string,
): T {
  const record = records[entitySlug];
  if (!record) throw notFound(`${capitalize(kindLabel)} not found: ${entitySlug}`);
  const updates: Record<string, unknown> = {};
  const loosePatch = patch as Record<string, unknown>;
  for (const field of fields) {
    const value = loosePatch[field];
    if (value !== undefined && value !== null) updates[field] = value;
  }
  if (patch.userTags !== undefined && patch.userTags !== null) updates.userTags = [...patch.userTags];
  const variants: Record<string, EntityVariant> = { ...record.variants };
  for (const [variantKey, variantPatch] of Object.entries(patch.variants ?? {})) {
    if (!SLUG_RE.test(variantKey)) throw invalid(`Invalid variant key: ${variantKey}`);
    const existing = variants[variantKey] ?? emptyVariant();
    const cleaned: Partial<EntityVariantPatchPayload> = {};
    for (const [k, v] of Object.entries(variantPatch)) if (v !== undefined && v !== null) (cleaned as Record<string, unknown>)[k] = v;
    variants[variantKey] = { ...existing, ...cleaned };
  }
  for (const variantKey of patch.removeVariants ?? []) delete variants[variantKey];
  updates.variants = variants;
  const nextSlug = patch.slug || entitySlug;
  if (nextSlug !== entitySlug) {
    if (!SLUG_RE.test(nextSlug)) throw invalid(`Invalid ${kindLabel} slug: ${nextSlug}`);
    if (nextSlug in records) throw conflict(`${capitalize(kindLabel)} already exists: ${nextSlug}`);
    updates.slug = nextSlug;
  }
  updates.updatedAt = utcNow();
  const nextRecord = { ...record, ...updates } as T;
  if (nextSlug !== entitySlug) delete records[entitySlug];
  records[nextSlug] = nextRecord;
  return nextRecord;
}

// --- metadata IO ---------------------------------------------------------------

/** Create the adaptation document, default visual styles and style tags when missing. */
export async function ensureAdaptation(slug: string): Promise<AdaptationMetadata> {
  await requireProject(slug);
  let metadata = await getProjectDoc<AdaptationMetadata>('adaptation', slug);
  if (!metadata) {
    metadata = emptyMetadata();
    await putProjectDoc('adaptation', slug, metadata);
  }
  if (!(await hasVisualStylesDocument(slug))) {
    await writeVisualStyles(slug, defaultVisualStyles());
  }
  await ensureStyleEntityTags(slug);
  return metadata;
}

export async function readMetadata(slug: string): Promise<AdaptationMetadata> {
  const metadata = await ensureAdaptation(slug);
  return {
    ...emptyMetadata(),
    ...metadata,
    characters: { ...(metadata.characters ?? {}) },
    locations: { ...(metadata.locations ?? {}) },
  };
}

export async function writeMetadata(slug: string, metadata: AdaptationMetadata): Promise<AdaptationMetadata> {
  await putProjectDoc('adaptation', slug, metadata);
  const characters = entityKeysAndNames(metadata.characters);
  const locations = entityKeysAndNames(metadata.locations);
  await syncEntityTags(slug, {
    characterKeys: characters.keys,
    locationKeys: locations.keys,
    entityNames: { ...characters.names, ...locations.names },
  });
  notifyChange('adaptation', slug);
  return metadata;
}

// --- characters ----------------------------------------------------------------

export async function listCharacters(slug: string): Promise<CharacterRecord[]> {
  const metadata = await readMetadata(slug);
  return Object.keys(metadata.characters)
    .sort()
    .map((key) => metadata.characters[key]);
}

export async function createCharacter(slug: string, payload: CharacterCreatePayload): Promise<CharacterRecord> {
  const metadata = await readMetadata(slug);
  const record = createEntityRecord(
    metadata.characters,
    payload,
    (entitySlug, now) => ({
      slug: entitySlug,
      name: payload.name.trim(),
      summary: payload.summary ?? '',
      visualDescription: '',
      performanceNotes: '',
      continuityNotes: '',
      userTags: [],
      variants: {},
      createdAt: now,
      updatedAt: now,
    }),
    'character',
  );
  await writeMetadata(slug, metadata);
  return record;
}

export async function updateCharacter(slug: string, characterSlug: string, patch: CharacterPatchPayload): Promise<CharacterRecord> {
  const metadata = await readMetadata(slug);
  const record = updateEntityRecord(metadata.characters, characterSlug, patch, CHARACTER_PATCH_FIELDS, 'character');
  await writeMetadata(slug, metadata);
  return record;
}

export async function deleteCharacter(slug: string, characterSlug: string): Promise<AdaptationStatus> {
  const metadata = await readMetadata(slug);
  if (!(characterSlug in metadata.characters)) throw notFound(`Character not found: ${characterSlug}`);
  delete metadata.characters[characterSlug];
  await writeMetadata(slug, metadata);
  return status(slug);
}

// --- locations -----------------------------------------------------------------

export async function listLocations(slug: string): Promise<LocationRecord[]> {
  const metadata = await readMetadata(slug);
  return Object.keys(metadata.locations)
    .sort()
    .map((key) => metadata.locations[key]);
}

export async function createLocation(slug: string, payload: LocationCreatePayload): Promise<LocationRecord> {
  const metadata = await readMetadata(slug);
  const record = createEntityRecord(
    metadata.locations,
    payload,
    (entitySlug, now) => ({
      slug: entitySlug,
      name: payload.name.trim(),
      summary: payload.summary ?? '',
      visualDescription: '',
      continuityNotes: '',
      userTags: [],
      variants: {},
      createdAt: now,
      updatedAt: now,
    }),
    'location',
  );
  await writeMetadata(slug, metadata);
  return record;
}

export async function updateLocation(slug: string, locationSlug: string, patch: LocationPatchPayload): Promise<LocationRecord> {
  const metadata = await readMetadata(slug);
  const record = updateEntityRecord(metadata.locations, locationSlug, patch, LOCATION_PATCH_FIELDS, 'location');
  await writeMetadata(slug, metadata);
  return record;
}

export async function deleteLocation(slug: string, locationSlug: string): Promise<AdaptationStatus> {
  const metadata = await readMetadata(slug);
  if (!(locationSlug in metadata.locations)) throw notFound(`Location not found: ${locationSlug}`);
  delete metadata.locations[locationSlug];
  await writeMetadata(slug, metadata);
  return status(slug);
}

// --- shared ----------------------------------------------------------------------

export async function clearStaleArtifactAssets(slug: string, metadata: AdaptationMetadata): Promise<boolean> {
  let changed = false;
  for (const records of [metadata.characters, metadata.locations] as EntityRecords[]) {
    for (const [entitySlug, record] of Object.entries(records)) {
      const variants = { ...record.variants };
      if (await clearStaleVariantGroup(slug, variants)) {
        records[entitySlug] = { ...record, variants };
        changed = true;
      }
    }
  }
  return changed;
}

async function draftVariant(
  slug: string,
  records: EntityRecords,
  entitySlug: string,
  variantKey: string,
  kindLabel: 'character' | 'location',
  spawn: (slug: string, entitySlug: string, variantKey: string) => Promise<{ nodeId: string; canvas: AdaptationCanvasImportResponse['canvas'] }>,
): Promise<AdaptationCanvasImportResponse> {
  const record = records[entitySlug];
  if (!record) throw notFound(`${capitalize(kindLabel)} not found: ${entitySlug}`);
  const variant = record.variants[variantKey];
  if (!variant) throw notFound(`Unknown ${kindLabel} variant: ${entitySlug}/${variantKey}`);
  if (!variant.prompt.trim()) throw invalid(`Missing prompt for ${kindLabel} variant: ${entitySlug}/${variantKey}`);
  const { nodeId, canvas } = await spawn(slug, entitySlug, variantKey);
  return { canvas, importedNodeCount: 1, nodeId };
}

export async function draftCharacterVariantToCanvas(slug: string, characterSlug: string, variantKey: string): Promise<AdaptationCanvasImportResponse> {
  const metadata = await readMetadata(slug);
  return draftVariant(slug, metadata.characters, characterSlug, variantKey, 'character', spawnFromCharacterVariant);
}

export async function draftLocationVariantToCanvas(slug: string, locationSlug: string, variantKey: string): Promise<AdaptationCanvasImportResponse> {
  const metadata = await readMetadata(slug);
  return draftVariant(slug, metadata.locations, locationSlug, variantKey, 'location', spawnFromLocationVariant);
}

export async function resetCharacterData(slug: string): Promise<AdaptationStatus> {
  const metadata = await readMetadata(slug);
  metadata.characters = {};
  await writeMetadata(slug, metadata);
  return status(slug);
}

export async function hasBook(slug: string): Promise<boolean> {
  return blobExists(bookPath(slug));
}

export async function status(slug: string): Promise<AdaptationStatus> {
  const { listCards } = await import('./conceptCards');
  let metadata = await readMetadata(slug);
  if (await clearStaleArtifactAssets(slug, metadata)) {
    metadata = await writeMetadata(slug, metadata);
  }
  // Seed entity-tag canonicals from records; a manually starred canonical always wins.
  const canonicalByTagId: Record<string, string | null> = {};
  for (const records of [metadata.characters, metadata.locations] as EntityRecords[]) {
    for (const [entitySlug, record] of Object.entries(records)) {
      for (const [variantKey, variant] of Object.entries(record.variants)) {
        const assetId = variant.activeAssetId || variant.assetIds[0] || null;
        if (assetId) canonicalByTagId[normalizeTagId(variantEntityKey(entitySlug, variantKey))] = assetId;
      }
    }
  }
  await updateEntityTagCanonicals(slug, canonicalByTagId, { defaultOnly: true });
  const styles = await readVisualStyles(slug);
  const characters = Object.values(metadata.characters);
  const locations = Object.values(metadata.locations);
  return {
    projectSlug: slug,
    hasBook: await hasBook(slug),
    hasBookSession: Boolean(metadata.bookContext?.fits),
    counts: {
      characters: characters.length,
      charactersExtracted: characters.filter(characterIsExtracted).length,
      locations: locations.length,
      locationsExtracted: locations.filter(locationIsExtracted).length,
      conceptArt: (await listCards(slug)).length,
    },
    visualStyles: styles,
    defaultVisualStyleId: resolveDefaultVisualStyleId(styles),
    characters: metadata.characters,
    locations: metadata.locations,
  };
}

/** Python read the book with universal newlines; panel offsets were recorded
 *  against that text, so the browser must see the same characters. */
export function normalizeBookText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export async function readBook(slug: string): Promise<string> {
  await ensureAdaptation(slug);
  if (!(await blobExists(bookPath(slug)))) throw notFound('No book.txt uploaded');
  return normalizeBookText(await readText(bookPath(slug)));
}

export async function optionalBookText(slug: string): Promise<string | null> {
  try {
    return await readBook(slug);
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'not-found') return null;
    throw error;
  }
}

export async function importBook(slug: string, upload: File | Blob | string): Promise<AdaptationStatus> {
  await ensureAdaptation(slug);
  if (upload instanceof Blob) {
    const type = upload.type;
    if (type && type !== 'text/plain' && type !== 'application/octet-stream') {
      throw invalid('Book import expects a text file');
    }
  }
  const text = typeof upload === 'string' ? upload : await upload.text();
  await writeBlob(bookPath(slug), normalizeBookText(text));
  const metadata = await readMetadata(slug);
  if (metadata.bookContext) {
    // The book changed: the prepared context no longer applies.
    await writeMetadata(slug, { ...metadata, bookContext: null });
  }
  notifyChange('adaptation', slug);
  return status(slug);
}
