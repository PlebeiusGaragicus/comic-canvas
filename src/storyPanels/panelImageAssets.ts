import {
  characterEntityTags,
  countEntityTagsOnAssets,
  countUserTagsOnAssets,
  locationEntityTags,
  userProjectTags,
} from '../canvas/shared';
import type { Asset, CanvasDocument, TagDefinition } from '../types';

export function canvasRepresentedAssetIds(canvas: CanvasDocument): Set<string> {
  return new Set(Object.values(canvas.nodes).flatMap((node) => node.assetIds));
}

export function basePickableAssets(
  assets: Asset[],
  canvas: CanvasDocument,
  showAllLibrary: boolean,
  showArchived: boolean,
): Asset[] {
  const onCanvas = canvasRepresentedAssetIds(canvas);
  return assets.filter((asset) => {
    if (!asset.hasPixels) return false;
    if (asset.archivedAt && !showArchived) return false;
    if (!showAllLibrary && !onCanvas.has(asset.id)) return false;
    return true;
  });
}

function matchesTagFilters(asset: Asset, activeUserTags: string[], activeEntityTags: string[]): boolean {
  if (activeUserTags.length > 0) {
    const required = new Set(activeUserTags);
    if (!asset.tags.some((tag) => required.has(tag))) return false;
  }
  if (activeEntityTags.length > 0) {
    const required = new Set(activeEntityTags);
    if (!asset.tags.some((tag) => required.has(tag))) return false;
  }
  return true;
}

function matchesSearchQuery(asset: Asset, searchQuery: string): boolean {
  const needle = searchQuery.trim().toLowerCase();
  if (!needle) return true;
  return asset.title.toLowerCase().includes(needle) || asset.id.toLowerCase().includes(needle);
}

export function filterPickableAssets(options: {
  assets: Asset[];
  canvas: CanvasDocument;
  projectTags: TagDefinition[];
  showAllLibrary: boolean;
  showArchived: boolean;
  activeUserTags: string[];
  activeEntityTags: string[];
  searchQuery: string;
}): Asset[] {
  const pool = basePickableAssets(
    options.assets,
    options.canvas,
    options.showAllLibrary,
    options.showArchived,
  );
  return pool.filter(
    (asset) =>
      matchesTagFilters(asset, options.activeUserTags, options.activeEntityTags)
      && matchesSearchQuery(asset, options.searchQuery),
  );
}

export function pickerTagCounts(
  assets: Asset[],
  canvas: CanvasDocument,
  projectTags: TagDefinition[],
  showAllLibrary: boolean,
  showArchived: boolean,
) {
  const pool = basePickableAssets(assets, canvas, showAllLibrary, showArchived);
  return {
    userTagCounts: countUserTagsOnAssets(pool, projectTags, showArchived),
    entityTagCounts: countEntityTagsOnAssets(pool, projectTags, showArchived),
    userAvailableTags: userProjectTags(projectTags),
    characterAvailableTags: characterEntityTags(projectTags),
    locationAvailableTags: locationEntityTags(projectTags),
  };
}

export { assetThumbnailUrl } from '../shared/assetUrls';
