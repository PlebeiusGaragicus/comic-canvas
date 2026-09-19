/** Asset pixel storage: blob paths, existence checks, thumbnails and object
 *  URLs. Leaf module: only `store/` and `shared/images` below it. */
import { blobExists, deleteBlob, readBlobOrNull, writeBlob } from '../store/blobs';
import { invalidateUrl, urlFor } from '../store/objectUrls';
import { makeThumbnail, normalizeToPng } from '../shared/images';

export function projectBlobDir(slug: string): string {
  return `projects/${slug}`;
}

export function assetsBlobDir(slug: string): string {
  return `${projectBlobDir(slug)}/assets`;
}

export function assetPngPath(slug: string, assetId: string): string {
  return `${assetsBlobDir(slug)}/${assetId}.png`;
}

export function assetThumbPath(slug: string, assetId: string): string {
  return `${assetsBlobDir(slug)}/${assetId}.thumb.webp`;
}

export function assetHasPixels(slug: string, assetId: string): Promise<boolean> {
  return blobExists(assetPngPath(slug, assetId));
}

/** Store already-PNG bytes plus a fresh thumbnail. */
export async function writeAssetPixels(slug: string, assetId: string, png: Blob): Promise<void> {
  await writeBlob(assetPngPath(slug, assetId), png);
  invalidateUrl(assetPngPath(slug, assetId));
  await writeThumbnail(slug, assetId, png);
}

/** Normalise any supported image to PNG, then store it with a thumbnail. */
export async function storeAssetImage(slug: string, assetId: string, image: Blob): Promise<void> {
  const png = await normalizeToPng(image);
  await writeAssetPixels(slug, assetId, png);
}

async function writeThumbnail(slug: string, assetId: string, png: Blob): Promise<void> {
  const thumb = await makeThumbnail(png);
  await writeBlob(assetThumbPath(slug, assetId), thumb);
  invalidateUrl(assetThumbPath(slug, assetId));
}

/** Regenerate the thumbnail when it is missing. Returns false when there are no pixels. */
export async function ensureThumbnail(slug: string, assetId: string): Promise<boolean> {
  if (await blobExists(assetThumbPath(slug, assetId))) return true;
  const png = await readBlobOrNull(assetPngPath(slug, assetId));
  if (!png) return false;
  await writeThumbnail(slug, assetId, png);
  return true;
}

export async function deleteAssetPixels(slug: string, assetId: string): Promise<void> {
  await deleteBlob(assetPngPath(slug, assetId));
  await deleteBlob(assetThumbPath(slug, assetId));
  invalidateUrl(assetPngPath(slug, assetId));
  invalidateUrl(assetThumbPath(slug, assetId));
}

/** Object URL for the thumbnail (generated lazily), or null without pixels. */
export async function assetThumbnailUrl(slug: string, assetId: string): Promise<string | null> {
  if (!(await ensureThumbnail(slug, assetId))) return null;
  return urlFor(assetThumbPath(slug, assetId));
}

export function assetImageUrl(slug: string, assetId: string): Promise<string | null> {
  return urlFor(assetPngPath(slug, assetId));
}
