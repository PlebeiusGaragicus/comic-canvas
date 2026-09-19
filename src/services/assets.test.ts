import { describe, expect, it } from 'vitest';
import { applyEntityTagToAsset, importAsset, importAssetFile, listAssets, patchArchive, patchDisplay, readAsset, readAssetPng, validateAssetMetadata } from './assets';
import { deleteAsset, listTrash } from './trash';
import { DEFAULT_STARTER_DRAFT_NODE_ID, canvasNodeId, readCanvas, readStoredCanvas, writeCanvas } from './canvas';
import { getProjectDetail, patchProjectCover } from './projects';
import { syncEntityTags } from './tags';
import { isServiceError } from './errors';
import { getScopedDoc, putScopedDoc } from '../store/db';
import { blobExists } from '../store/blobs';
import { assetPngPath, assetThumbPath } from './assetBlobs';
import { FARM, generatedDoc, importedDoc, jpegBytes, pngBytes, pngFile, seedAsset, seedProject } from '../test/fixtures';
import type { AssetMetadata, ChatSession } from '../types';

const SEED_NODES = [DEFAULT_STARTER_DRAFT_NODE_ID, 'style_character', 'style_scene'].sort();

describe('asset summaries', () => {
  it('resolves hasPixels, thumbnail and image urls at read time and never persists them', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HIMG', { title: 'Image' }));
    const asset = await readAsset(FARM, '01HIMG');
    expect(asset.hasPixels).toBe(true);
    expect(asset.thumbnailUrl).toMatch(/^blob:/);
    expect(asset.imageUrl).toMatch(/^blob:/);
    expect(asset.isProtected).toBe(false);
    expect(await blobExists(assetThumbPath(FARM, '01HIMG'))).toBe(true);
    const stored = await getScopedDoc<Record<string, unknown>>('assets', FARM, '01HIMG');
    for (const field of ['hasPixels', 'thumbnailUrl', 'imageUrl', 'isProtected']) expect(stored).not.toHaveProperty(field);
    const png = await readAssetPng(FARM, '01HIMG');
    expect(new Uint8Array(await png.arrayBuffer()).slice(0, 4)).toEqual(pngBytes().slice(0, 4));
  });

  it('reports missing pixels and unknown assets', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HNOPIX'), { pixels: false });
    const asset = await readAsset(FARM, '01HNOPIX');
    expect(asset.hasPixels).toBe(false);
    expect(asset.thumbnailUrl).toBeNull();
    expect(asset.imageUrl).toBeNull();
    await expect(readAsset(FARM, 'missing')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
    await expect(readAsset('no-project', 'x')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });

  it('marks assets referenced by chat sessions as protected', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HSRC'));
    await seedAsset(FARM, importedDoc('01HFREE'));
    await putScopedDoc<ChatSession>('chatSessions', FARM, 'sess1', {
      version: 1,
      id: 'sess1',
      projectSlug: FARM,
      status: 'active',
      title: 'Refine',
      source: { assetId: '01HSRC', canvasNodeId: null },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      defaults: { model: 'm', aspectRatio: '1:1', imageSize: '1K', includeThoughts: false },
      protectedAssetIds: ['01HSRC'],
      turns: [],
      provider: { name: 'google-genai', model: 'm', history: [] },
    });
    const byId = Object.fromEntries((await listAssets(FARM)).map((asset) => [asset.id, asset]));
    expect(byId['01HSRC'].isProtected).toBe(true);
    expect(byId['01HFREE'].isProtected).toBe(false);
    await expect(deleteAsset(FARM, '01HSRC')).rejects.toSatisfy(
      (error) => isServiceError(error, 'conflict') && (error.details?.chatSessionIds as string[])[0] === 'sess1',
    );
    expect(await readAsset(FARM, '01HSRC')).toBeTruthy();
  });

  it('enforces the generated-vs-imported document rules', () => {
    expect(() => validateAssetMetadata(importedDoc('a', { prompt: { text: 'x' } }))).toThrow(/imported assets cannot have prompt/);
    expect(() => validateAssetMetadata({ ...generatedDoc('b', 'x'), generation: null })).toThrow(/require generation/);
    expect(() => validateAssetMetadata({ ...generatedDoc('c', 'x'), prompt: null })).toThrow(/require prompt/);
    expect(() => validateAssetMetadata(importedDoc('d', { tags: ['Bad Tag'] }))).toThrow(/Invalid tag slug/);
    expect(validateAssetMetadata(generatedDoc('e', 'x')).id).toBe('e');
  });
});

describe('display and archive', () => {
  it('display patch keeps generation metadata intact', async () => {
    await seedProject();
    await seedAsset(FARM, generatedDoc('01HAAA', 'original', [], { title: 'Old' }));
    const patched = await patchDisplay(FARM, '01HAAA', { title: 'New', tags: ['scene'] });
    expect(patched.title).toBe('New');
    const stored = (await getScopedDoc<AssetMetadata>('assets', FARM, '01HAAA'))!;
    expect(stored.title).toBe('New');
    expect(stored.prompt?.text).toBe('original');
    expect(stored.generation?.seed).toBe(1);
    expect((stored.provider?.response.usageMetadata as { totalTokenCount: number }).totalTokenCount).toBe(1);
    expect(stored.updatedAt).not.toBe('2026-01-01T00:00:00Z');
  });

  it('display patch validates input and preserves locked entity tags', async () => {
    await seedProject();
    await syncEntityTags(FARM, { characterKeys: ['hero'], locationKeys: [] });
    await seedAsset(FARM, importedDoc('01HLOCK'));
    await applyEntityTagToAsset(FARM, '01HLOCK', 'hero');
    const patched = await patchDisplay(FARM, '01HLOCK', { tags: ['mood'] });
    expect(patched.tags).toEqual(['mood', 'hero']);
    await expect(patchDisplay(FARM, '01HLOCK', { title: '' })).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    await expect(patchDisplay(FARM, '01HLOCK', { tags: ['Bad Tag'] })).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    // Applying the same entity tag twice is a no-op.
    expect((await applyEntityTagToAsset(FARM, '01HLOCK', 'hero')).tags).toEqual(['mood', 'hero']);
  });

  it('archiving hides the asset from lists and the canvas; restoring brings it back', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HARCHIVE', { title: 'Archive me' }));
    const archived = await patchArchive(FARM, '01HARCHIVE', true);
    expect(archived.archivedAt).not.toBeNull();
    expect(await listAssets(FARM)).toEqual([]);
    expect(await listAssets(FARM, true)).toHaveLength(1);
    expect(Object.keys((await readCanvas(FARM)).nodes).sort()).toEqual(SEED_NODES);
    const withArchived = await readCanvas(FARM, true);
    expect(Object.values(withArchived.nodes).some((node) => node.assetIds.includes('01HARCHIVE'))).toBe(true);

    const restored = await patchArchive(FARM, '01HARCHIVE', false);
    expect(restored.archivedAt).toBeNull();
    const nodes = (await readCanvas(FARM)).nodes;
    expect(Object.values(nodes).some((node) => node.assetIds.includes('01HARCHIVE'))).toBe(true);
    // The restore wrote a stored node.
    expect((await readStoredCanvas(FARM)).nodes[canvasNodeId('01HARCHIVE')]).toBeTruthy();
  });

  it('archiving preserves the canvas group name and the project cover', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HGROUPNAME', { title: 'Asset title' }));
    const nodeId = canvasNodeId('01HGROUPNAME');
    const canvas = await readCanvas(FARM);
    canvas.nodes[nodeId] = {
      displayName: 'My scene board',
      x: 420,
      y: 180,
      tags: ['panel'],
      refs: [],
      prompt: '',
      params: { batchCount: 1 },
      assetIds: ['01HGROUPNAME'],
      activeAssetId: '01HGROUPNAME',
    };
    await writeCanvas(FARM, canvas);
    await patchProjectCover(FARM, '01HGROUPNAME');

    await patchArchive(FARM, '01HGROUPNAME', true);
    let stored = (await readStoredCanvas(FARM)).nodes[nodeId];
    expect(stored.displayName).toBe('My scene board');
    expect(stored.assetIds).toEqual(['01HGROUPNAME']);
    expect((await getProjectDetail(FARM)).project.coverAssetId).toBe('01HGROUPNAME');

    await patchArchive(FARM, '01HGROUPNAME', false);
    stored = (await readStoredCanvas(FARM)).nodes[nodeId];
    expect(stored.displayName).toBe('My scene board');
    expect(stored.assetIds).toEqual(['01HGROUPNAME']);
    expect((await getProjectDetail(FARM)).project.coverAssetId).toBe('01HGROUPNAME');
    expect((await readCanvas(FARM)).nodes[nodeId].displayName).toBe('My scene board');
  });
});

describe('delete', () => {
  it('moves the document to the trash, keeps the bytes, and drops the canvas node', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HIMAGE', { title: 'Image' }));
    expect(Object.keys((await readCanvas(FARM)).nodes)).toContain(canvasNodeId('01HIMAGE'));

    await deleteAsset(FARM, '01HIMAGE');
    expect(await getScopedDoc('assets', FARM, '01HIMAGE')).toBeUndefined();
    expect(await blobExists(assetPngPath(FARM, '01HIMAGE'))).toBe(true);
    const trash = await listTrash();
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ kind: 'asset', id: '01HIMAGE', slug: FARM });
    expect(trash[0].blobPaths).toEqual([assetPngPath(FARM, '01HIMAGE'), assetThumbPath(FARM, '01HIMAGE')]);
    expect((trash[0].doc as AssetMetadata).title).toBe('Image');
    expect(Object.keys((await readCanvas(FARM)).nodes).sort()).toEqual(SEED_NODES);
    await expect(deleteAsset(FARM, '01HIMAGE')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });
});

describe('import', () => {
  it('imports a png, hashes the uploaded bytes and normalises to png with a thumbnail', async () => {
    await seedProject();
    const asset = await importAsset(FARM, pngFile('same.png', 1));
    expect(asset.kind).toBe('imported');
    expect(asset.title).toBe('same');
    expect(asset.contentHash).toHaveLength(64);
    expect(asset.hasPixels).toBe(true);
    expect(await blobExists(assetPngPath(FARM, asset.id))).toBe(true);
    expect(await blobExists(assetThumbPath(FARM, asset.id))).toBe(true);
    expect(await listAssets(FARM)).toHaveLength(1);
  });

  it('rejects duplicates with a conflict and unsupported bytes as invalid', async () => {
    await seedProject();
    await importAsset(FARM, pngFile('same.png', 1));
    await expect(importAsset(FARM, pngFile('same-again.png', 1))).rejects.toSatisfy(
      (error) => isServiceError(error, 'conflict') && /Already imported: same/.test(error.message),
    );
    expect(await listAssets(FARM)).toHaveLength(1);
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], 'x.gif', { type: 'image/gif' });
    await expect(importAsset(FARM, gif)).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    await expect(importAsset('missing', pngFile('a.png'))).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });

  it('accepts jpeg input and honours an explicit title and canvas position', async () => {
    await seedProject();
    const jpeg = new File([jpegBytes(3)], 'photo.jpg', { type: 'image/jpeg' });
    const asset = await importAsset(FARM, jpeg, { title: 'Photo', canvasX: 33, canvasY: 44 });
    expect(asset.title).toBe('Photo');
    const node = (await readStoredCanvas(FARM)).nodes[canvasNodeId(asset.id)];
    expect(node).toMatchObject({ x: 33, y: 44, tags: ['imported-image'], assetIds: [asset.id], activeAssetId: asset.id });
  });

  it('file import returns the existing asset for duplicates', async () => {
    await seedProject();
    const first = await importAssetFile(FARM, pngFile('a.png', 9), 'Hero sheet');
    const second = await importAssetFile(FARM, pngFile('b.png', 9), 'Other title');
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Hero sheet');
    expect(await listAssets(FARM)).toHaveLength(1);
  });
});
