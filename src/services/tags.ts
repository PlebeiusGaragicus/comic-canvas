/** Tag registry (ported from api/library.py). Locked entity tags win over
 *  incoming edits, orphan locked tags survive a registry write, and the
 *  registry is kept sorted by name. */
import { getProjectDoc, getScopedDoc, putProjectDoc } from '../store/db';
import { notifyChange } from '../store/changes';
import { TAG_COLOR_RE, TAG_RE } from './common';
import { invalid, notFound } from './errors';
import { assetHasPixels } from './assetBlobs';
import { requireProject } from './projectDocs';
import type { AssetMetadata, EntityKind, TagDefinition, TagRegistryDocument } from '../types';

export const ENTITY_TAG_COLORS: Record<EntityKind, string> = {
  character: '#3b82f6',
  location: '#f59e0b',
  style: '#c084fc',
};

export const STYLE_ENTITY_TAGS: Record<string, string> = {
  'character-style': 'Character Style',
  'scene-style': 'Scene Style',
};

const ENTITY_KINDS: ReadonlySet<string> = new Set<EntityKind>(['character', 'location', 'style']);

export function normalizeTagId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized || !TAG_RE.test(normalized)) throw invalid(`Invalid tag slug: ${value}`);
  return normalized;
}

export function entityDisplayName(key: string): string {
  return key
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function entityTagForKey(key: string, entityKind: EntityKind): TagDefinition {
  const id = normalizeTagId(key);
  return { id, name: entityDisplayName(id), color: ENTITY_TAG_COLORS[entityKind], locked: true, entityKind, canonicalAssetId: null };
}

/** Validate and fill a tag definition (the pydantic `TagDefinition` rules). */
export function coerceTagDefinition(raw: TagDefinition): TagDefinition {
  if (typeof raw.id !== 'string' || !TAG_RE.test(raw.id)) throw invalid(`Invalid tag slug: ${String(raw.id)}`);
  const id = raw.id;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) throw invalid(`Tag name is required: ${id}`);
  if (typeof raw.color !== 'string' || !TAG_COLOR_RE.test(raw.color)) throw invalid(`Invalid tag color: ${String(raw.color)}`);
  const entityKind = raw.entityKind ?? null;
  if (entityKind !== null && !ENTITY_KINDS.has(entityKind)) throw invalid(`Invalid entity kind: ${String(entityKind)}`);
  return {
    id,
    name,
    color: raw.color,
    locked: Boolean(raw.locked),
    entityKind,
    canonicalAssetId: raw.canonicalAssetId ?? null,
  };
}

/** First occurrence of an id wins (`TagRegistryDocument.unique_tags`). */
export function uniqueTags(tags: TagDefinition[]): TagDefinition[] {
  const seen = new Set<string>();
  const unique: TagDefinition[] = [];
  for (const tag of tags) {
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    unique.push(tag);
  }
  return unique;
}

function byName(a: TagDefinition, b: TagDefinition): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export async function readTagRegistry(slug: string): Promise<TagRegistryDocument> {
  await requireProject(slug);
  const doc = await getProjectDoc<TagRegistryDocument>('tags', slug);
  const tags = Array.isArray(doc?.tags) ? doc.tags : [];
  return { tags: uniqueTags(tags.map(coerceTagDefinition)) };
}

export async function listProjectTags(slug: string): Promise<TagDefinition[]> {
  return (await readTagRegistry(slug)).tags;
}

export interface WriteTagRegistryOptions {
  preserveOrphanLockedEntityTags?: boolean;
}

export async function writeTagRegistry(
  slug: string,
  registry: TagRegistryDocument,
  { preserveOrphanLockedEntityTags = true }: WriteTagRegistryOptions = {},
): Promise<TagRegistryDocument> {
  await requireProject(slug);
  if (!registry || !Array.isArray(registry.tags)) throw invalid('Tag registry must contain a tags list');
  const existing = await readTagRegistry(slug);
  const lockedById = new Map(existing.tags.filter((tag) => tag.locked).map((tag) => [tag.id, tag]));
  const incoming = uniqueTags(registry.tags.map(coerceTagDefinition));
  const nextById = new Map<string, TagDefinition>();
  for (const tag of incoming) {
    const existingLocked = lockedById.get(tag.id);
    nextById.set(tag.id, existingLocked && !tag.locked ? existingLocked : tag);
  }
  if (preserveOrphanLockedEntityTags) {
    for (const [id, locked] of lockedById) {
      if (!nextById.has(id)) nextById.set(id, locked);
    }
  }
  const normalized: TagRegistryDocument = { tags: [...nextById.values()].sort(byName) };
  await putProjectDoc('tags', slug, normalized);
  notifyChange('tags', slug);
  return normalized;
}

export async function upsertTag(slug: string, tag: TagDefinition): Promise<TagRegistryDocument> {
  const registry = await readTagRegistry(slug);
  const next = coerceTagDefinition(tag);
  const tags = registry.tags.filter((existing) => existing.id !== next.id);
  tags.push(next);
  return writeTagRegistry(slug, { tags: tags.sort(byName) });
}

export interface SyncEntityTagsOptions {
  characterKeys: string[];
  locationKeys: string[];
  entityNames?: Record<string, string>;
}

/** Rebuild the locked character/location tags from the adaptation records,
 *  keeping user tags, style tags, display names and canonical pointers. */
export async function syncEntityTags(
  slug: string,
  { characterKeys, locationKeys, entityNames = {} }: SyncEntityTagsOptions,
): Promise<TagRegistryDocument> {
  const registry = await readTagRegistry(slug);
  const entityIds = new Set([...characterKeys, ...locationKeys].map(normalizeTagId));
  const userTags = registry.tags.filter((tag) => !tag.locked && !entityIds.has(tag.id));
  const styleTags = registry.tags.filter((tag) => tag.entityKind === 'style' && !entityIds.has(tag.id));
  const canonicalById = new Map(registry.tags.filter((tag) => tag.canonicalAssetId).map((tag) => [tag.id, tag.canonicalAssetId ?? null]));
  const namesById = new Map<string, string>();
  for (const [key, name] of Object.entries(entityNames)) {
    if (name.trim()) namesById.set(normalizeTagId(key), name.trim());
  }
  const entityTags = [
    ...[...characterKeys].sort().map((key) => entityTagForKey(key, 'character')),
    ...[...locationKeys].sort().map((key) => entityTagForKey(key, 'location')),
  ].map((tag) => ({
    ...tag,
    name: namesById.get(tag.id) ?? tag.name,
    canonicalAssetId: canonicalById.has(tag.id) ? canonicalById.get(tag.id) ?? null : tag.canonicalAssetId ?? null,
  }));
  return writeTagRegistry(slug, { tags: [...userTags, ...styleTags, ...entityTags] }, { preserveOrphanLockedEntityTags: false });
}

/** Point entity tags at their canonical image; writes only on change. With
 *  `defaultOnly`, a tag that already has a canonical keeps it (the user's
 *  explicit choice wins over record-derived defaults). */
export async function updateEntityTagCanonicals(
  slug: string,
  canonicalByTagId: Record<string, string | null>,
  { defaultOnly = false }: { defaultOnly?: boolean } = {},
): Promise<void> {
  const registry = await readTagRegistry(slug);
  let changed = false;
  const nextTags = registry.tags.map((tag) => {
    if (
      tag.entityKind &&
      Object.prototype.hasOwnProperty.call(canonicalByTagId, tag.id) &&
      (tag.canonicalAssetId ?? null) !== canonicalByTagId[tag.id] &&
      !(defaultOnly && tag.canonicalAssetId != null)
    ) {
      changed = true;
      return { ...tag, canonicalAssetId: canonicalByTagId[tag.id] };
    }
    return tag;
  });
  if (changed) await writeTagRegistry(slug, { tags: nextTags });
}

export async function lockedEntityTagIds(slug: string): Promise<Set<string>> {
  return new Set((await listProjectTags(slug)).filter((tag) => tag.locked).map((tag) => tag.id));
}

/** Seed the two style entity tags; their canonicalAssetId anchors visual consistency. */
export async function ensureStyleEntityTags(slug: string): Promise<void> {
  const registry = await readTagRegistry(slug);
  const present = new Set(registry.tags.map((tag) => tag.id));
  const missing = Object.keys(STYLE_ENTITY_TAGS).filter((id) => !present.has(id));
  if (!missing.length) return;
  const seeded: TagDefinition[] = missing.map((id) => ({
    id,
    name: STYLE_ENTITY_TAGS[id],
    color: ENTITY_TAG_COLORS.style,
    locked: true,
    entityKind: 'style',
    canonicalAssetId: null,
  }));
  await writeTagRegistry(slug, { tags: [...registry.tags, ...seeded] });
}

/** Point an entity tag at its canonical reference image. */
export async function setTagCanonical(slug: string, tagId: string, assetId: string | null): Promise<TagDefinition[]> {
  const normalized = normalizeTagId(tagId);
  const tag = (await listProjectTags(slug)).find((item) => item.id === normalized);
  if (!tag || !tag.entityKind) throw notFound(`Unknown entity tag: ${tagId}`);
  if (assetId !== null) {
    const asset = await getScopedDoc<AssetMetadata>('assets', slug, assetId);
    if (!asset) throw notFound(`Asset not found: ${assetId}`);
  }
  await updateEntityTagCanonicals(slug, { [normalized]: assetId });
  return listProjectTags(slug);
}

/** Each entity tag pulls its canonical image in as a generation reference. */
export async function canonicalRefsForTags(slug: string, tags: string[]): Promise<string[]> {
  const byId = new Map((await listProjectTags(slug)).map((tag) => [tag.id, tag]));
  const refs: string[] = [];
  for (const tagId of tags) {
    const tag = byId.get(normalizeTagId(tagId));
    if (!tag || !tag.entityKind || !tag.canonicalAssetId) continue;
    if (await assetHasPixels(slug, tag.canonicalAssetId)) refs.push(tag.canonicalAssetId);
  }
  return [...new Set(refs)];
}
