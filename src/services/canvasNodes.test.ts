import { describe, expect, it } from 'vitest';
import { NODE_LAYOUT, createImageGroup, createImageGroupNode, nextCanvasPosition, spawnFromCharacterVariant, spawnFromLocationVariant } from './canvasNodes';
import { readStoredCanvas, writeCanvas } from './canvas';
import { isServiceError } from './errors';
import { putProjectDoc } from '../store/db';
import { FARM, STAMP, importedDoc, seedAsset, seedProject } from '../test/fixtures';
import type { AdaptationMetadata, CharacterRecord, LocationRecord } from '../types';

function character(slug: string, name: string, prompt: string, extra: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    slug,
    name,
    summary: '',
    visualDescription: '',
    performanceNotes: '',
    continuityNotes: '',
    userTags: [],
    variants: { base: { label: 'Base', storyContext: '', prompt, assetIds: [], activeAssetId: null } },
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}

function location(slug: string, name: string, prompt: string): LocationRecord {
  return {
    slug,
    name,
    summary: '',
    visualDescription: '',
    continuityNotes: '',
    userTags: [],
    variants: {
      base: { label: 'Base', storyContext: '', prompt, assetIds: [], activeAssetId: null },
      night: { label: 'At Night', storyContext: '', prompt: `${prompt} at night`, assetIds: ['01HREF'], activeAssetId: null },
    },
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

describe('canvas nodes', () => {
  it('lays new nodes out on a 5-column grid', async () => {
    await seedProject();
    const canvas = await readStoredCanvas(FARM);
    const count = Object.keys(canvas.nodes).length;
    expect(nextCanvasPosition(canvas)).toEqual({
      x: NODE_LAYOUT.startX + (count % 5) * NODE_LAYOUT.xGap,
      y: NODE_LAYOUT.startY + Math.floor(count / 5) * NODE_LAYOUT.yGap,
    });
    await writeCanvas(FARM, { version: 2, viewport: { x: 0, y: 0, zoom: 1 }, nodes: {} });
    expect(nextCanvasPosition(await readStoredCanvas(FARM))).toEqual({ x: 80, y: 320 });
  });

  it('creates an image group with defaults, deduped tags and an active asset only with a stack', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HA'));
    const { nodeId, canvas } = await createImageGroupNode(FARM, { tags: ['a', 'a', 'b'], x: 5, y: 6 });
    expect(nodeId).toMatch(/^node_/);
    expect(canvas.nodes[nodeId]).toMatchObject({ displayName: '', tags: ['a', 'b'], width: 240, prompt: '', refs: [], assetIds: [], activeAssetId: null, params: { batchCount: 1 } });

    const stacked = await createImageGroupNode(FARM, { tags: [], x: 0, y: 0, width: null, assetIds: ['01HA'], activeAssetId: '01HA', origin: { kind: 'conceptCard', id: 'c1' } });
    expect(stacked.canvas.nodes[stacked.nodeId]).toMatchObject({ width: null, assetIds: ['01HA'], activeAssetId: '01HA', origin: { kind: 'conceptCard', id: 'c1' } });

    const response = await createImageGroup(FARM, { displayName: '  Board  ', prompt: 'p', refs: ['01HA'], visualStyleId: 'crayons' });
    expect(response.canvas.nodes[response.nodeId]).toMatchObject({ displayName: 'Board', prompt: 'p', refs: ['01HA'], visualStyleId: 'crayons' });
    await expect(createImageGroup(FARM, { refs: ['ghost'] })).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
  });

  it('spawns an empty image group from a character variant', async () => {
    await seedProject();
    await putProjectDoc<AdaptationMetadata>('adaptation', FARM, {
      version: 4,
      characters: { hero: character('hero', 'Hero', ' Full body character sheet for the farm hero. ', {
        variants: {
          base: { label: 'Base', storyContext: '', prompt: 'Full body character sheet for the farm hero.', assetIds: [], activeAssetId: null },
          armored: { label: '', storyContext: '', prompt: 'Armored hero', assetIds: [], activeAssetId: null },
        },
      }) },
      locations: {},
    });
    const { nodeId, canvas } = await spawnFromCharacterVariant(FARM, 'hero');
    const node = canvas.nodes[nodeId];
    expect(node.assetIds).toEqual([]);
    expect(node).toMatchObject({ displayName: 'Hero', prompt: 'Full body character sheet for the farm hero.', tags: ['comic-adaptation', 'character-sheet', 'hero'] });

    const variant = await spawnFromCharacterVariant(FARM, 'hero', 'armored');
    expect(variant.canvas.nodes[variant.nodeId]).toMatchObject({ displayName: 'Hero (armored)', tags: ['comic-adaptation', 'character-sheet', 'hero', 'hero-armored'] });

    await expect(spawnFromCharacterVariant(FARM, 'nobody')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
    await expect(spawnFromCharacterVariant(FARM, 'hero', 'ghost')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });

  it('spawns from a location variant with the variant refs and label', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HREF'));
    await putProjectDoc<AdaptationMetadata>('adaptation', FARM, { version: 4, characters: {}, locations: { barn: location('barn', '', 'The old barn') } });
    const base = await spawnFromLocationVariant(FARM, 'barn');
    expect(base.canvas.nodes[base.nodeId]).toMatchObject({ displayName: 'Barn', tags: ['comic-adaptation', 'location-prompt', 'barn'], refs: [] });
    const night = await spawnFromLocationVariant(FARM, 'barn', 'night');
    expect(night.canvas.nodes[night.nodeId]).toMatchObject({ displayName: 'Barn (At Night)', prompt: 'The old barn at night', refs: ['01HREF'], tags: ['comic-adaptation', 'location-prompt', 'barn', 'barn-night'] });
    await expect(spawnFromLocationVariant(FARM, 'field')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });
});
