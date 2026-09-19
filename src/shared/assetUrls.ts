/** Image URLs for assets. Summaries carry object URLs resolved by the
 *  services at read time; these helpers are the one place views ask for
 *  them, and can resolve on demand when only an id is known. */
import type { Asset } from '../types';
import { assetImageUrl as resolveImageUrl, assetThumbnailUrl as resolveThumbnailUrl } from '../services/assetBlobs';

const EMPTY_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function assetThumbnailUrl(_projectSlug: string, asset: Asset): string {
  return asset.thumbnailUrl ?? asset.imageUrl ?? EMPTY_PIXEL;
}

export function assetImageUrl(_projectSlug: string, asset: Asset): string {
  return asset.imageUrl ?? asset.thumbnailUrl ?? EMPTY_PIXEL;
}

/** Async lookups for the rare sites that only hold an asset id. */
export async function loadAssetImageUrl(projectSlug: string, assetId: string): Promise<string | null> {
  return resolveImageUrl(projectSlug, assetId);
}

export async function loadAssetThumbnailUrl(projectSlug: string, assetId: string): Promise<string | null> {
  return resolveThumbnailUrl(projectSlug, assetId);
}
