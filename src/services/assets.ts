/** Asset documents and imports (ported from api/library.py). Pixels live in
 *  OPFS via `assetBlobs.ts`; `Asset` summaries resolve `hasPixels`,
 *  `thumbnailUrl`, `imageUrl` and `isProtected` at read time and are never
 *  persisted. */
import { getScopedDoc, listScopedDocs, putScopedDoc } from '../store/db';
import { notifyChange } from '../store/changes';
import { readBlob } from '../store/blobs';
import { sha256Hex, sniffImageType } from '../shared/images';
import { TAG_RE, utcNow } from './common';
import { conflict, invalid, notFound } from './errors';
import { newUlid } from './ids';
import { assetHasPixels, assetImageUrl, assetPngPath, assetThumbnailUrl, storeAssetImage } from './assetBlobs';
import { protectedAssetIds } from './chatSessions';
import { requireProject } from './projectDocs';
import { lockedEntityTagIds, normalizeTagId } from './tags';
import type { Asset, AssetMetadata, DisplayPatchPayload } from '../types';

/** Blob-path helpers under their asset-facing names (generation/chat write pixels directly). */
export { assetPngPath as assetImagePath, assetThumbPath as assetThumbnailPath, ensureThumbnail } from './assetBlobs';

const DERIVED_FIELDS = ['hasPixels', 'thumbnailUrl', 'imageUrl', 'isProtected'] as const;

/** Strip the derived summary fields so only `AssetMetadata` is persisted. */
export function toAssetMetadata(value: AssetMetadata | Asset): AssetMetadata {
  const doc = { ...value } as Record<string, unknown>;
  for (const field of DERIVED_FIELDS) delete doc[field];
  return doc as unknown as AssetMetadata;
}

export function validateTagIds(tags: unknown): string[] {
  if (!Array.isArray(tags)) throw invalid('Tags must be a list');
  for (const tag of tags) {
    if (typeof tag !== 'string' || !TAG_RE.test(tag)) throw invalid(`Invalid tag slug: ${String(tag)}`);
  }
  return tags as string[];
}

/** The pydantic `AssetMetadata` rules: valid tags, generated-vs-imported fields. */
export function validateAssetMetadata(metadata: AssetMetadata): AssetMetadata {
  if (!metadata.id || typeof metadata.id !== 'string') throw invalid('Asset id is required');
  if (metadata.kind !== 'imported' && metadata.kind !== 'generated') throw invalid(`Invalid asset kind: ${String(metadata.kind)}`);
  if (typeof metadata.title !== 'string') throw invalid('Asset title is required');
  validateTagIds(metadata.tags);
  if (metadata.kind === 'generated') {
    if (!metadata.generation) throw invalid('generated assets require generation metadata');
    if (!metadata.prompt || !metadata.prompt.text) throw invalid('generated assets require prompt metadata');
  } else {
    if (metadata.generation) throw invalid('imported assets cannot have generation metadata');
    if (metadata.prompt) throw invalid('imported assets cannot have prompt metadata');
    if (metadata.provider) throw invalid('imported assets cannot have provider metadata');
  }
  return metadata;
}

export async function readAssetMetadataOrNull(slug: string, assetId: string): Promise<AssetMetadata | null> {
  return (await getScopedDoc<AssetMetadata>('assets', slug, assetId)) ?? null;
}

export async function readAssetMetadata(slug: string, assetId: string): Promise<AssetMetadata> {
  await requireProject(slug);
  const doc = await readAssetMetadataOrNull(slug, assetId);
  if (!doc) throw notFound(`Asset not found: ${assetId}`);
  return doc;
}

/** Every stored asset document, sorted by id (the old on-disk glob order). */
export async function listAssetMetadata(slug: string): Promise<AssetMetadata[]> {
  const rows = await listScopedDocs<AssetMetadata>('assets', slug);
  return rows.map((row) => row.doc).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function writeAssetMetadata(slug: string, metadata: AssetMetadata | Asset): Promise<Asset> {
  const doc = validateAssetMetadata(toAssetMetadata(metadata));
  await putScopedDoc('assets', slug, doc.id, doc);
  notifyChange('assets', slug);
  return metadataToSummary(slug, doc);
}

export async function metadataToSummary(slug: string, metadata: AssetMetadata, protectedIds?: Set<string>): Promise<Asset> {
  const hasPixels = await assetHasPixels(slug, metadata.id);
  const isProtected = (protectedIds ?? (await protectedAssetIds(slug))).has(metadata.id);
  return {
    ...toAssetMetadata(metadata),
    hasPixels,
    thumbnailUrl: hasPixels ? await assetThumbnailUrl(slug, metadata.id) : null,
    imageUrl: hasPixels ? await assetImageUrl(slug, metadata.id) : null,
    isProtected,
  };
}

export async function listAssets(slug: string, includeArchived = false): Promise<Asset[]> {
  await requireProject(slug);
  const protectedIds = await protectedAssetIds(slug);
  const items: Asset[] = [];
  for (const metadata of await listAssetMetadata(slug)) {
    if (metadata.archivedAt != null && !includeArchived) continue;
    items.push(await metadataToSummary(slug, metadata, protectedIds));
  }
  return items;
}

export async function readAsset(slug: string, assetId: string): Promise<Asset> {
  return metadataToSummary(slug, await readAssetMetadata(slug, assetId));
}

export async function matchingImportByHash(slug: string, contentHash: string): Promise<AssetMetadata | null> {
  for (const metadata of await listAssetMetadata(slug)) {
    if (metadata.archivedAt != null) continue;
    if (metadata.kind === 'imported' && metadata.contentHash === contentHash) return metadata;
  }
  return null;
}

export async function assetsForEntityTag(slug: string, tagId: string): Promise<string[]> {
  const normalized = normalizeTagId(tagId);
  return (await listAssets(slug)).filter((asset) => asset.tags.includes(normalized)).map((asset) => asset.id);
}

export async function applyEntityTagToAsset(slug: string, assetId: string, entityKey: string): Promise<Asset> {
  const metadata = await readAssetMetadata(slug, assetId);
  const entityTag = normalizeTagId(entityKey);
  if (!metadata.tags.includes(entityTag)) {
    return writeAssetMetadata(slug, { ...metadata, tags: [...metadata.tags, entityTag], updatedAt: utcNow() });
  }
  return metadataToSummary(slug, metadata);
}

/** Requested tags first, then any locked entity tags the asset already carries. */
export async function mergeAssetTagsPreservingLocked(slug: string, assetId: string, requestedTags: string[]): Promise<string[]> {
  const metadata = await readAssetMetadata(slug, assetId);
  const lockedIds = await lockedEntityTagIds(slug);
  const preserved = metadata.tags.filter((tag) => lockedIds.has(tag));
  return [...new Set([...requestedTags, ...preserved])];
}

export async function patchDisplay(slug: string, assetId: string, payload: DisplayPatchPayload): Promise<Asset> {
  const metadata = await readAssetMetadata(slug, assetId);
  const next: AssetMetadata = { ...metadata };
  if (payload.title != null) {
    if (typeof payload.title !== 'string' || !payload.title.length) throw invalid('Title must not be empty');
    next.title = payload.title;
  }
  if (payload.tags != null) {
    next.tags = await mergeAssetTagsPreservingLocked(slug, assetId, validateTagIds(payload.tags));
  }
  next.updatedAt = utcNow();
  return writeAssetMetadata(slug, next);
}

export async function patchArchive(slug: string, assetId: string, archived: boolean): Promise<Asset> {
  const metadata = await readAssetMetadata(slug, assetId);
  const now = utcNow();
  const summary = await writeAssetMetadata(slug, { ...metadata, archivedAt: archived ? now : null, updatedAt: now });
  if (!archived) {
    // Lazy import: the sanctioned break for the assets <-> canvas cycle.
    const canvas = await import('./canvas');
    await canvas.restoreAssetToCanvas(slug, assetId);
  }
  return summary;
}

export interface ImportAssetOptions {
  title?: string | null;
  canvasX?: number | null;
  canvasY?: number | null;
}

function fileStem(file: Blob): string {
  const name = file instanceof File ? file.name : '';
  return name.replace(/\.[^.]+$/, '');
}

async function readUploadBytes(file: Blob): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImageType(bytes)) throw invalid('Only PNG, JPEG, and WebP imports are supported');
  return bytes;
}

/** UI import: rejects duplicates (by hash of the uploaded bytes) with `conflict`. */
export async function importAsset(slug: string, file: Blob, options: ImportAssetOptions = {}): Promise<Asset> {
  await requireProject(slug);
  const bytes = await readUploadBytes(file);
  const contentHash = await sha256Hex(bytes);
  const duplicate = await matchingImportByHash(slug, contentHash);
  if (duplicate) throw conflict(`Already imported: ${duplicate.title}`);
  const assetId = newUlid();
  await storeAssetImage(slug, assetId, file);
  const now = utcNow();
  const summary = await writeAssetMetadata(slug, {
    id: assetId,
    kind: 'imported',
    title: options.title || fileStem(file) || assetId,
    tags: [],
    contentHash,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    prompt: null,
    generation: null,
    provider: null,
  });
  if (options.canvasX != null && options.canvasY != null) {
    const canvas = await import('./canvas');
    await canvas.placeImportedAsset(slug, assetId, summary.title, options.canvasX, options.canvasY);
  }
  return summary;
}

/** File-path import (concept-card uploads, zip import): a duplicate returns the existing asset. */
export async function importAssetFile(slug: string, file: Blob, title: string): Promise<Asset> {
  await requireProject(slug);
  const bytes = await readUploadBytes(file);
  const contentHash = await sha256Hex(bytes);
  const duplicate = await matchingImportByHash(slug, contentHash);
  if (duplicate) return metadataToSummary(slug, duplicate);
  const assetId = newUlid();
  await storeAssetImage(slug, assetId, file);
  const now = utcNow();
  return writeAssetMetadata(slug, {
    id: assetId,
    kind: 'imported',
    title,
    tags: [],
    contentHash,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    prompt: null,
    generation: null,
    provider: null,
  });
}

/** The stored PNG bytes of an asset. */
export async function readAssetPng(slug: string, assetId: string): Promise<File> {
  await requireProject(slug);
  return readBlob(assetPngPath(slug, assetId));
}
