import { describe, expect, it } from 'vitest';
import { composeGenerationPrompt, createGeneratedAssets } from './generation';
import { readCanvas, writeCanvas } from './canvas';
import { patchDisplay } from './assets';
import { setTagCanonical, upsertTag } from './tags';
import { isServiceError } from './errors';
import { ImageGenerationError, type GenerateImageParams, type ImageProvider } from '../providers/gemini';
import { FARM, importedDoc, pngBytes, seedAsset, seedProject } from '../test/fixtures';

function fakeProvider(onGenerate?: (params: GenerateImageParams) => void): ImageProvider & { calls: GenerateImageParams[] } {
  const calls: GenerateImageParams[] = [];
  return {
    name: 'google-genai',
    calls,
    async generateImage(params) {
      calls.push(params);
      onGenerate?.(params);
      return { data: pngBytes(calls.length), mimeType: 'image/png', providerResponse: { candidates: [{ finishReason: 'STOP' }] } };
    },
    async sendChatTurn() {
      throw new Error('not used');
    },
    async validateKey() {},
  };
}

describe('generation', () => {
  it('composes prompts like the backend', () => {
    expect(composeGenerationPrompt('a', null)).toBe('a\n');
    expect(composeGenerationPrompt('', 'style')).toBe('style\n');
    expect(composeGenerationPrompt(' a ', ' style ')).toBe('a\n\nstyle\n');
    expect(composeGenerationPrompt('', '')).toBe('');
  });

  it('rejects unsupported model capabilities', async () => {
    await seedProject();
    await expect(
      createGeneratedAssets(FARM, { prompt: 'blue square', refs: [], model: 'gemini-3-pro-image', aspectRatio: '16:9', imageSize: '512', batchCount: 1, tags: [] }, fakeProvider()),
    ).rejects.toThrow(/Unsupported image size/);
  });

  it('persists receipts, seeds per index, shares a run id, and captures the provider response', async () => {
    await seedProject();
    const provider = fakeProvider();
    const { assets } = await createGeneratedAssets(FARM, { prompt: 'blue square', refs: [], seed: 42, batchCount: 2, tags: ['test'] }, provider);
    expect(assets).toHaveLength(2);
    expect(assets[0].generation?.seed).toBe(42);
    expect(assets[1].generation?.seed).toBe(43);
    expect(assets[0].generation?.runId).toBe(assets[1].generation?.runId);
    expect(assets[0].hasPixels).toBe(true);
    expect((assets[0].provider?.response as { response: { candidates: Array<{ finishReason: string }> } }).response.candidates[0].finishReason).toBe('STOP');
    expect(provider.calls[0].prompt).toBe('blue square\n');
    expect(provider.calls[0].referenceImages).toEqual([]);
  });

  it('fills a draft node in place and merges matching prompt+refs groups', async () => {
    await seedProject();
    await writeCanvas(FARM, {
      version: 2,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: {
        draft_1: { displayName: 'Blue square candidates', x: 10, y: 20, tags: [], refs: [], prompt: 'blue square', params: { aspectRatio: '1:1', imageSize: '1K', seed: 7, batchCount: 2 }, assetIds: [], activeAssetId: null },
      },
    });
    await createGeneratedAssets(FARM, { prompt: 'blue square', refs: [], seed: 7, batchCount: 2, tags: [], canvasNodeId: 'draft_1' }, fakeProvider());
    let canvas = await readCanvas(FARM);
    expect(Object.keys(canvas.nodes)).toEqual(['draft_1']);
    expect(canvas.nodes.draft_1.displayName).toBe('Blue square candidates');
    expect(canvas.nodes.draft_1.assetIds).toHaveLength(2);
    expect(canvas.nodes.draft_1.activeAssetId).toBe(canvas.nodes.draft_1.assetIds[0]);

    canvas.nodes.draft_2 = { displayName: 'Draft', x: 50, y: 60, tags: [], refs: [], prompt: 'blue square', params: { aspectRatio: '4:3', imageSize: '1K', seed: 2, batchCount: 1 }, assetIds: [], activeAssetId: null };
    await writeCanvas(FARM, canvas);
    await createGeneratedAssets(FARM, { prompt: 'blue square', refs: [], seed: 2, batchCount: 1, tags: [], canvasNodeId: 'draft_2' }, fakeProvider());
    canvas = await readCanvas(FARM);
    expect(canvas.nodes.draft_2).toBeUndefined();
    expect(canvas.nodes.draft_1.assetIds).toHaveLength(3);
  });

  it('auto-attaches canonical refs for entity tags and applies the visual style', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HREF'));
    await upsertTag(FARM, { id: 'hero', name: 'Hero', color: '#3b82f6', locked: true, entityKind: 'character', canonicalAssetId: null });
    await setTagCanonical(FARM, 'hero', '01HREF');
    await patchDisplay(FARM, '01HREF', { tags: ['hero'] });
    const provider = fakeProvider();
    const { assets } = await createGeneratedAssets(FARM, { prompt: 'hero rides', refs: [], batchCount: 1, tags: ['hero'], visualStyleId: 'crayons' }, provider);
    expect(assets[0].generation?.refs).toEqual(['01HREF']);
    expect(assets[0].generation?.visualStyleId).toBe('crayons');
    expect(provider.calls[0].referenceImages).toHaveLength(1);
    expect(provider.calls[0].prompt.startsWith('hero rides\n\nStyle: Textured')).toBe(true);
  });

  it('surfaces provider failures and leaves no pixels behind', async () => {
    await seedProject();
    const provider: ImageProvider = {
      name: 'google-genai',
      async generateImage() {
        throw new ImageGenerationError('Image generation was blocked by Gemini content safety filters.', 'safety');
      },
      async sendChatTurn() {
        throw new Error('unused');
      },
      async validateKey() {},
    };
    await expect(createGeneratedAssets(FARM, { prompt: 'Blocked prompt', refs: [], batchCount: 1, tags: [] }, provider)).rejects.toThrow(/content safety filters/);
    expect((await readCanvas(FARM)).nodes).not.toHaveProperty('node_undefined');
    await expect(createGeneratedAssets(FARM, { prompt: 'x', refs: ['missing'], batchCount: 1, tags: [] }, fakeProvider())).rejects.toSatisfy((e) => isServiceError(e, 'invalid'));
  });
});
