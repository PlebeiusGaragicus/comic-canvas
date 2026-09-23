/** Image generation runs (ported from library.create_generated_assets). */
import type { Asset, AssetMetadata, GeneratePayload } from '../types';
import { readBlob, writeBlob, deleteBlob } from '../store/blobs';
import { invalidateUrl } from '../store/objectUrls';
import { newSeed, newUlid } from './ids';
import { utcNow } from './common';
import { ServiceError, invalid } from './errors';
import { requireProject } from './projects';
import { assetImagePath, assetThumbnailPath, writeAssetMetadata } from './assets';
import { canonicalRefsForTags } from './tags';
import { attachGeneratedAssetsToCanvas, validateRefs } from './canvas';
import { visualStylePrompt } from './visualStyles';
import { attachAssetsToPanel } from './storyPanels';
import { readSettings } from './settings';
import { imageOps } from '../shared/images';
import { referenceImageLimit, validateModelCapabilities, type ImageProvider, type ReferenceImage } from '../providers/gemini';

export function composeGenerationPrompt(userPrompt: string, stylePrompt: string | null | undefined): string {
  const user = userPrompt.trim();
  const style = (stylePrompt ?? '').trim();
  if (!style) return user ? `${user}\n` : '';
  if (!user) return `${style}\n`;
  return `${user}\n\n${style}\n`;
}

export async function resolveVisualStylePrompt(slug: string, visualStyleId: string | null | undefined): Promise<string | null> {
  if (!visualStyleId) return null;
  const prompt = (await visualStylePrompt(slug, visualStyleId)).trim();
  return prompt || null;
}

export async function loadReferenceImages(slug: string, refs: string[]): Promise<ReferenceImage[]> {
  const images: ReferenceImage[] = [];
  for (const ref of refs) {
    const file = await readBlob(assetImagePath(slug, ref));
    images.push({ data: new Uint8Array(await file.arrayBuffer()), mimeType: 'image/png' });
  }
  return images;
}

export interface GenerateOptions {
  signal?: AbortSignal;
}

export async function createGeneratedAssets(
  slug: string,
  payload: GeneratePayload,
  provider: ImageProvider,
  options: GenerateOptions = {},
): Promise<{ assets: Asset[] }> {
  if (!payload.prompt.trim()) throw invalid('Prompt is required');
  const batchCount = payload.batchCount ?? 1;
  if (batchCount < 1 || batchCount > 8) throw invalid('batchCount must be between 1 and 8');
  validateModelCapabilities(payload.model, payload.aspectRatio, payload.imageSize);
  await requireProject(slug);
  const settings = await readSettings();
  const tags = payload.tags ?? [];
  // Entity tags auto-attach their canonical image as a reference; the merged
  // list is what lands in each take's generation receipt.
  const autoRefs = (await canonicalRefsForTags(slug, tags)).filter((ref) => !payload.refs.includes(ref));
  const refs = [...payload.refs, ...autoRefs];
  await validateRefs(slug, refs);
  const model = payload.model || settings.imageDefaults.model;
  const limit = referenceImageLimit(model);
  if (refs.length > limit) {
    throw invalid(`${model} accepts at most ${limit} reference images; this generation has ${refs.length}.`);
  }
  const referenceImages = await loadReferenceImages(slug, refs);
  const runId = newUlid();
  const baseSeed = payload.seed ?? newSeed();
  const aspectRatio = payload.aspectRatio || settings.imageDefaults.aspectRatio;
  const imageSize = payload.imageSize || settings.imageDefaults.imageSize;
  const stylePrompt = await resolveVisualStylePrompt(slug, payload.visualStyleId);
  const providerPrompt = composeGenerationPrompt(payload.prompt, stylePrompt);
  const created: Asset[] = [];
  for (let index = 0; index < batchCount; index += 1) {
    const assetId = newUlid();
    const seed = batchCount > 1 ? baseSeed + index : baseSeed;
    const imagePath = assetImagePath(slug, assetId);
    let providerResponse: unknown;
    try {
      const result = await provider.generateImage({
        prompt: providerPrompt,
        referenceImages,
        seed,
        model,
        aspectRatio,
        imageSize,
        signal: options.signal,
      });
      const png = await imageOps.normalizeToPng(new Blob([result.data as BlobPart], { type: result.mimeType }));
      await writeBlob(imagePath, png);
      await writeBlob(assetThumbnailPath(slug, assetId), await imageOps.makeThumbnail(png));
      providerResponse = { imageFile: `${assetId}.png`, response: result.providerResponse };
    } catch (error) {
      await deleteBlob(imagePath);
      await deleteBlob(assetThumbnailPath(slug, assetId));
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(error instanceof Error ? error.message : String(error), { code: 'provider', cause: error });
    }
    invalidateUrl(imagePath);
    const now = utcNow();
    const metadata: AssetMetadata = {
      id: assetId,
      kind: 'generated',
      title: payload.title || `Generated ${assetId}`,
      tags,
      contentHash: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      prompt: { text: payload.prompt },
      generation: {
        refs,
        runId,
        runIndex: index,
        model,
        aspectRatio,
        imageSize,
        seed,
        chatSessionId: null,
        chatTurnId: null,
        visualStyleId: payload.visualStyleId ?? null,
      },
      provider: { name: 'google-genai', response: providerResponse as Record<string, unknown> },
    };
    created.push(await writeAssetMetadata(slug, metadata));
  }
  if (payload.canvasNodeId) {
    const { panelId } = await attachGeneratedAssetsToCanvas(slug, payload.canvasNodeId, created);
    if (panelId) await attachAssetsToPanel(slug, panelId, created.map((asset) => asset.id));
  }
  return { assets: created };
}
