import { assetLabel } from './canvas/shared';
import { readBlobOrNull } from './store/blobs';
import { assetPngPath } from './services/assetBlobs';
import type { Asset } from './types';

function sanitizePathSegment(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim();
  return cleaned || 'untitled';
}

function uniqueFileName(used: Set<string>, base: string): string {
  const stem = sanitizePathSegment(base);
  let candidate = `${stem}.png`;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem}-${counter}.png`;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

async function assetPngBlob(projectSlug: string, asset: Asset): Promise<Blob> {
  const file = await readBlobOrNull(assetPngPath(projectSlug, asset.id));
  if (!file) {
    throw new Error(`Missing image for ${assetLabel(asset)}`);
  }
  return new Blob([file], { type: 'image/png' });
}

export async function exportProjectAssetsToFolder(projectSlug: string, projectName: string, assets: Asset[]) {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('Folder export requires Chrome or Edge. This browser cannot choose a save folder.');
  }
  const imageAssets = assets.filter((asset) => asset.hasPixels);
  if (!imageAssets.length) {
    throw new Error('This project has no image assets to export.');
  }
  const parent = await window.showDirectoryPicker();
  const directory = await parent.getDirectoryHandle(sanitizePathSegment(projectName), { create: true });
  const used = new Set<string>();
  for (const asset of imageAssets) {
    const blob = await assetPngBlob(projectSlug, asset);
    const fileName = uniqueFileName(used, asset.title || asset.id);
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }
}

export async function saveAssetImageToDisk(
  projectSlug: string,
  asset: Asset,
  suggestedName?: string,
) {
  if (!asset.hasPixels) {
    throw new Error('This asset has no image to save.');
  }
  const blob = await assetPngBlob(projectSlug, asset);
  const baseName = sanitizePathSegment(suggestedName?.trim() || asset.title || asset.id);
  const fileName = `${baseName}.png`;
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      throw err;
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
