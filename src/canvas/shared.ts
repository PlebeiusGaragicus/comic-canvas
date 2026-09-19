import type { ArtifactKind, Asset, EntityKind, GenerationParams, TagDefinition } from '../types';

export const CONCEPT_TAG = 'concept';

export function isConceptTagged(tags: string[] | undefined): boolean {
  return tags?.includes(CONCEPT_TAG) ?? false;
}

export function conceptSubjectFromTags(tags: string[] | undefined): 'character' | 'location' | null {
  if (tags?.includes('concept-character')) return 'character';
  if (tags?.includes('concept-location')) return 'location';
  return null;
}

export function isCharacterCanvasNode(tags: string[] | undefined, projectTags: TagDefinition[]): boolean {
  if (!tags?.length) return false;
  if (tags.includes('character-sheet')) return true;
  const entityCharacterTagIds = new Set(projectTags.filter((tag) => tag.entityKind === 'character').map((tag) => tag.id));
  return tags.some((tagId) => entityCharacterTagIds.has(tagId));
}

export function isLocationCanvasNode(tags: string[] | undefined, projectTags: TagDefinition[]): boolean {
  if (!tags?.length) return false;
  if (tags.includes('location-prompt')) return true;
  const entityLocationTagIds = new Set(projectTags.filter((tag) => tag.entityKind === 'location').map((tag) => tag.id));
  return tags.some((tagId) => entityLocationTagIds.has(tagId));
}

export function isPromptOnlyImageGroup(node: { assetIds?: string[] }): boolean {
  return !(node.assetIds?.length);
}

export function styleEntityTagsOnNode(tags: string[], projectTags: TagDefinition[]): TagDefinition[] {
  return entityTagsOnAsset(tags, projectTags, 'style');
}

/** Entity tags whose canonical pointer references this asset. */
export function canonicalTagsForAsset(assetId: string | null | undefined, projectTags: TagDefinition[]): TagDefinition[] {
  if (!assetId) return [];
  return projectTags.filter((tag) => tag.canonicalAssetId === assetId);
}

/** Entity tags on this node whose canonical image will be auto-attached as a
 *  generation reference (deduped against the node's explicit refs). */
export function autoCanonicalRefTags(tags: string[], refs: string[], projectTags: TagDefinition[]): TagDefinition[] {
  const tagIds = new Set(tags);
  const explicit = new Set(refs);
  return projectTags.filter((tag) => (
    tag.entityKind != null && tag.canonicalAssetId != null && tagIds.has(tag.id) && !explicit.has(tag.canonicalAssetId)
  ));
}

/** A node is protected iff its active image is some entity tag's canonical image. */
export function canDeleteNode(
  node: { data: { activeAsset?: { id: string } | null } } | null | undefined,
  projectTags: TagDefinition[],
): boolean {
  return canonicalTagsForAsset(node?.data.activeAsset?.id, projectTags).length === 0;
}

export const defaultDraftParams: GenerationParams = { model: 'gemini-3.1-flash-image', aspectRatio: '16:9', imageSize: '1K', seed: null, batchCount: 1 };
export const SYSTEM_TAGS = new Set([
  'adaptation',
  'archetype',
  'character-sheet',
  'character-style',
  'comic-adaptation',
  'concept',
  'concept-character',
  'concept-location',
  'generated',
  'generated-image',
  'imported-image',
  'location',
  'page',
  'panel',
  'scene-style',
  'visual-style',
]);
export const tagColorOptions = [
  { color: '#ef4444', label: 'Red' },
  { color: '#f59e0b', label: 'Orange' },
  { color: '#facc15', label: 'Yellow' },
  { color: '#22c55e', label: 'Green' },
  { color: '#3b82f6', label: 'Blue' },
  { color: '#c084fc', label: 'Purple' },
  { color: '#cbd5e1', label: 'Gray' },
] as const;
export const tagColors = tagColorOptions.map((option) => option.color);

export function normalizeTagName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function isValidTagName(value: string) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

export function isEntityTag(tagId: string, projectTags: TagDefinition[]): boolean {
  return projectTags.some((tag) => tag.id === tagId && tag.locked);
}

export function lockedEntityTagIds(projectTags: TagDefinition[]): Set<string> {
  return new Set(projectTags.filter((tag) => tag.locked).map((tag) => tag.id));
}

export function userProjectTags(projectTags: TagDefinition[]): TagDefinition[] {
  return projectTags.filter((tag) => !tag.locked);
}

export function characterEntityTags(projectTags: TagDefinition[]): TagDefinition[] {
  return projectTags.filter((tag) => tag.locked && tag.entityKind === 'character');
}

export function locationEntityTags(projectTags: TagDefinition[]): TagDefinition[] {
  return projectTags.filter((tag) => tag.locked && tag.entityKind === 'location');
}

export function entityProjectTags(projectTags: TagDefinition[]): TagDefinition[] {
  return projectTags.filter((tag) => tag.locked);
}

export function partitionAssetTagIds(tagIds: string[], projectTags: TagDefinition[]) {
  const user = userTagsOnAsset(tagIds, projectTags).map((tag) => tag.id);
  const character = characterEntityTagsOnAsset(tagIds, projectTags).map((tag) => tag.id);
  const location = locationEntityTagsOnAsset(tagIds, projectTags).map((tag) => tag.id);
  return { user, character, location, entity: [...character, ...location] };
}

export function visibleVariants(assets: Asset[], assetIds: string[], archivedOnly = false): Asset[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return assetIds
    .map((assetId) => byId.get(assetId))
    .filter((asset): asset is Asset => asset != null && Boolean(asset.archivedAt) === archivedOnly);
}

export function nonArchivedVariants(assets: Asset[], assetIds: string[]): Asset[] {
  return visibleVariants(assets, assetIds, false);
}

export function archivedVariants(assets: Asset[], assetIds: string[]): Asset[] {
  return visibleVariants(assets, assetIds, true);
}

export function mergeAvailableUserTagsOnly(projectTags: TagDefinition[], assets: Asset[]): TagDefinition[] {
  const byId = new Map(userProjectTags(projectTags).map((tag) => [tag.id, tag]));
  assets.forEach((asset) => {
    asset.tags.forEach((tagId) => {
      if (SYSTEM_TAGS.has(tagId)) return;
      const existing = projectTags.find((tag) => tag.id === tagId);
      if (existing?.locked) return;
      if (!byId.has(tagId)) {
        byId.set(tagId, { id: tagId, name: tagId, color: '#64748b' });
      }
    });
  });
  return Array.from(byId.values()).sort((first, second) => first.name.localeCompare(second.name));
}

export function countUserTagsOnAssets(assets: Asset[], projectTags: TagDefinition[], archivedOnly = false): Record<string, number> {
  const lockedIds = lockedEntityTagIds(projectTags);
  const counts: Record<string, number> = {};
  assets.forEach((asset) => {
    if (Boolean(asset.archivedAt) !== archivedOnly) return;
    asset.tags.forEach((tagId) => {
      if (SYSTEM_TAGS.has(tagId) || lockedIds.has(tagId)) return;
      counts[tagId] = (counts[tagId] ?? 0) + 1;
    });
  });
  return counts;
}

export function countEntityTagsOnAssets(assets: Asset[], projectTags: TagDefinition[], archivedOnly = false): Record<string, number> {
  const lockedIds = lockedEntityTagIds(projectTags);
  const counts: Record<string, number> = {};
  assets.forEach((asset) => {
    if (Boolean(asset.archivedAt) !== archivedOnly) return;
    asset.tags.forEach((tagId) => {
      if (!lockedIds.has(tagId)) return;
      counts[tagId] = (counts[tagId] ?? 0) + 1;
    });
  });
  return counts;
}

export function countUserTagAssignments(assets: Asset[], projectTags: TagDefinition[]): Record<string, number> {
  return countUserTagsOnAssets(assets, projectTags, true);
}

function entityTagsOnAsset(tagIds: string[], projectTags: TagDefinition[], entityKind: EntityKind): TagDefinition[] {
  const byId = new Map(projectTags.map((tag) => [tag.id, tag]));
  return tagIds
    .filter((tagId) => {
      const tag = byId.get(tagId);
      return tag?.locked && tag.entityKind === entityKind;
    })
    .map((tagId) => byId.get(tagId)!);
}

export function userTagsOnAsset(tagIds: string[], projectTags: TagDefinition[]): TagDefinition[] {
  const byId = new Map(projectTags.map((tag) => [tag.id, tag]));
  return tagIds
    .filter((tagId) => !SYSTEM_TAGS.has(tagId) && !byId.get(tagId)?.locked)
    .map((tagId) => byId.get(tagId) ?? { id: tagId, name: tagId, color: '#64748b' });
}

export function characterEntityTagsOnAsset(tagIds: string[], projectTags: TagDefinition[]): TagDefinition[] {
  return entityTagsOnAsset(tagIds, projectTags, 'character');
}

export function locationEntityTagsOnAsset(tagIds: string[], projectTags: TagDefinition[]): TagDefinition[] {
  return entityTagsOnAsset(tagIds, projectTags, 'location');
}

export function mergeAvailableUserTags(projectTags: TagDefinition[], assets: Asset[]): TagDefinition[] {
  const byId = new Map(projectTags.map((tag) => [tag.id, tag]));
  assets.forEach((asset) => {
    asset.tags.forEach((tagId) => {
      if (!SYSTEM_TAGS.has(tagId) && !byId.has(tagId)) {
        byId.set(tagId, { id: tagId, name: tagId, color: '#64748b' });
      }
    });
  });
  return Array.from(byId.values()).sort((first, second) => first.name.localeCompare(second.name));
}

export const modelCapabilities: Record<string, { aspectRatios: string[]; imageSizes: string[] }> = {
  'gemini-2.5-flash-image': {
    aspectRatios: ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    imageSizes: ['1K', '2K', '4K'],
  },
  'gemini-3.1-flash-image': {
    aspectRatios: ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
    imageSizes: ['512', '1K', '2K', '4K'],
  },
  'gemini-3.1-flash-lite-image': {
    aspectRatios: ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    imageSizes: ['1K'],
  },
  'gemini-3-pro-image': {
    aspectRatios: ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    imageSizes: ['1K', '2K', '4K'],
  },
};

export function visibleDisplayName(displayName: string) {
  return /^(Draft|Generated\s+[0-9A-Z]+)$/i.test(displayName.trim()) ? '' : displayName;
}

export function assetLabel(asset: Asset | null | undefined, fallback = 'Untitled image') {
  return asset?.title?.trim() || fallback;
}

export function uniqueOptions(options: string[], current: string | null | undefined) {
  return Array.from(new Set(current ? [...options, current] : options));
}

export function capabilitiesForModel(model: string | null | undefined) {
  return modelCapabilities[model ?? ''] ?? modelCapabilities[defaultDraftParams.model ?? 'gemini-3.1-flash-image'];
}

export function normalizedParamsForModel(params: GenerationParams, model: string) {
  const capabilities = capabilitiesForModel(model);
  return {
    ...params,
    model,
    aspectRatio: capabilities.aspectRatios.includes(params.aspectRatio ?? '') ? params.aspectRatio : capabilities.aspectRatios[0],
    imageSize: capabilities.imageSizes.includes(params.imageSize ?? '') ? params.imageSize : capabilities.imageSizes[0],
  };
}

export function artifactKindLabel(kind: ArtifactKind) {
  const labels: Record<ArtifactKind, string> = {
    'character-sheet': 'Character Sheet',
    'location-prompt': 'Location Prompt',
    'concept-art': 'Concept Art',
  };
  return labels[kind];
}
