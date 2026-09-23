/** Shared vitest fixtures: a project plus assets written straight to the
 *  stores, the way the Python tests wrote `assets/<id>.json` + `.png`. */
import { putScopedDoc } from '../store/db';
import { writeBlob } from '../store/blobs';
import { assetPngPath } from '../services/assetBlobs';
import { createProject } from '../services/projects';
import type { AssetMetadata, Project } from '../types';

export const FARM = 'farm-comic';
export const STAMP = '2026-01-01T00:00:00Z';

/** PNG-signed bytes; `variant` makes distinct content (and hashes). */
export function pngBytes(variant = 0): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, variant & 0xff, (variant >> 8) & 0xff]);
}

export function jpegBytes(variant = 0): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, variant & 0xff]);
}

export function pngFile(name: string, variant = 0): File {
  return new File([pngBytes(variant)], name, { type: 'image/png' });
}

export async function seedProject(slug = FARM, name = 'Farm Comic'): Promise<Project> {
  return createProject({ slug, name, settings: {} });
}

export function importedDoc(id: string, overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id,
    kind: 'imported',
    title: `Asset ${id}`,
    tags: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

export function generatedDoc(id: string, promptText: string, refs: string[] = [], overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id,
    kind: 'generated',
    title: `Generated ${id}`,
    tags: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    prompt: { text: promptText },
    generation: { refs, runId: '01HRUN', runIndex: 0, model: 'gemini-3.1-flash-image', aspectRatio: '16:9', imageSize: '1K', seed: 1 },
    provider: { name: 'google-genai', response: { usageMetadata: { totalTokenCount: 1 } } },
    ...overrides,
  };
}

export interface SeedAssetOptions {
  pixels?: boolean;
  variant?: number;
}

/** Write an asset document (and PNG bytes unless `pixels: false`) directly to the stores. */
export async function seedAsset(slug: string, doc: AssetMetadata, { pixels = true, variant }: SeedAssetOptions = {}): Promise<AssetMetadata> {
  await putScopedDoc('assets', slug, doc.id, doc);
  if (pixels) {
    const seed = variant ?? [...doc.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    await writeBlob(assetPngPath(slug, doc.id), pngBytes(seed));
  }
  return doc;
}
