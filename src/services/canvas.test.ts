import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STARTER_DRAFT_NODE_ID,
  attachChatAssetsToCanvas,
  attachGeneratedAssetsToCanvas,
  canvasNodeId,
  composeGenerationPrompt,
  detachAssetFromProject,
  matchingVariantGroupNodeId,
  normalizeCanvasDocument,
  readCanvas,
  readStoredCanvas,
  restoreAssetToCanvas,
  validateRefs,
  writeCanvas,
} from './canvas';
import { readAsset } from './assets';
import { listProjectTags } from './tags';
import { isServiceError } from './errors';
import { FARM, STAMP, generatedDoc, importedDoc, seedAsset, seedProject } from '../test/fixtures';
import type { CanvasDocument, ChatSession, ChatTurn } from '../types';

function emptyCanvas(): CanvasDocument {
  return { version: 2, viewport: { x: 0, y: 0, zoom: 1 }, nodes: {} };
}

describe('canvas document', () => {
  it('round-trips a stored document and fills node defaults', async () => {
    await seedProject();
    const saved = await writeCanvas(FARM, { version: 2, viewport: { x: 1, y: 2, zoom: 1 }, nodes: {} });
    expect(saved.viewport.x).toBe(1);
    expect((await readCanvas(FARM)).nodes).toEqual({});

    await seedAsset(FARM, importedDoc('01HPARENT', { title: 'Parent' }));
    const canvas = normalizeCanvasDocument({
      nodes: {
        draft_1: {
          displayName: 'Blue square candidates',
          x: 10,
          y: 20,
          refs: ['01HPARENT'],
          prompt: 'make it blue',
          params: { model: 'gemini-3.1-flash-image', aspectRatio: '16:9', imageSize: '1K', seed: null, batchCount: 1 },
        },
      },
    });
    const written = await writeCanvas(FARM, canvas);
    expect(written.nodes.draft_1).toMatchObject({ prompt: 'make it blue', assetIds: [], activeAssetId: null, width: null, tags: [], origin: null });
    expect(written.nodes.draft_1.params.batchCount).toBe(1);
  });

  it('applies the active-asset rule and rejects bad shapes', () => {
    const doc = normalizeCanvasDocument({ nodes: { a: { displayName: 'a', x: 0, y: 0, assetIds: ['x', 'y'], activeAssetId: 'nope' } } });
    expect(doc.nodes.a.activeAssetId).toBe('x');
    const empty = normalizeCanvasDocument({ nodes: { a: { displayName: 'a', x: 0, y: 0, activeAssetId: 'x' } } });
    expect(empty.nodes.a.activeAssetId).toBeNull();
    expect(() => normalizeCanvasDocument({ nodes: { a: { displayName: 'a', x: 'no', y: 0 } } })).toThrow(/numeric x\/y/);
    expect(() => normalizeCanvasDocument({ nodes: { a: { displayName: 'a', x: 0, y: 0, params: { batchCount: 9 } } } })).toThrow(/batchCount/);
    expect(() => normalizeCanvasDocument({ nodes: { a: { displayName: 'a', x: 0, y: 0, visualStyleId: 'Bad Id' } } })).toThrow(/visualStyleId/);
    expect(() => normalizeCanvasDocument({ nodes: { a: { displayName: 'a', x: 0, y: 0, origin: { kind: 'other', id: '1' } } } })).toThrow(/origin/);
  });

  it('validates refs and asset ids against stored assets with pixels', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HOK'));
    await seedAsset(FARM, importedDoc('01HNOPIX'), { pixels: false });
    await expect(validateRefs(FARM, ['01HOK', '01HOK'])).rejects.toSatisfy((error) => isServiceError(error, 'invalid') && /Duplicate ref/.test(error.message));
    await expect(validateRefs(FARM, ['01HNOPIX'])).rejects.toSatisfy((error) => /Invalid same-project ref/.test((error as Error).message));
    await expect(validateRefs(FARM, ['ghost'])).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    const canvas = emptyCanvas();
    canvas.nodes.n = { displayName: 'n', x: 0, y: 0, tags: [], refs: [], prompt: '', params: { batchCount: 1 }, assetIds: ['ghost'] };
    await expect(writeCanvas(FARM, canvas)).rejects.toSatisfy((error) => /Invalid asset in canvas node n/.test((error as Error).message));
  });

  it('adds auto-nodes for unrepresented assets without persisting them', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HAUTO', { title: 'Auto', tags: ['mood'] }));
    await seedAsset(FARM, generatedDoc('01HGEN', 'p'));
    const canvas = await readCanvas(FARM);
    const auto = canvas.nodes[canvasNodeId('01HAUTO')];
    expect(auto).toMatchObject({ displayName: 'Auto', assetIds: ['01HAUTO'], activeAssetId: '01HAUTO', tags: ['mood', 'imported-image'] });
    expect(auto.x).toBeGreaterThanOrEqual(1500);
    expect(canvas.nodes[canvasNodeId('01HGEN')].tags).toEqual(['generated-image']);
    expect((await readStoredCanvas(FARM)).nodes[canvasNodeId('01HAUTO')]).toBeUndefined();
  });

  it('collapses generated variants of the same prompt/refs into one stack', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HREF'));
    await seedAsset(FARM, generatedDoc('01HV1', 'same prompt', ['01HREF']));
    await seedAsset(FARM, generatedDoc('01HV2', 'same prompt', ['01HREF']));
    await seedAsset(FARM, generatedDoc('01HOTHER', 'other prompt', ['01HREF']));
    const canvas = await readCanvas(FARM);
    const stacks = Object.values(canvas.nodes).filter((node) => node.assetIds.length);
    const variantStack = stacks.find((node) => node.assetIds.includes('01HV1'));
    expect(variantStack?.assetIds).toEqual(['01HV1', '01HV2']);
    expect(variantStack?.activeAssetId).toBe('01HV1');
    expect(stacks.find((node) => node.assetIds.includes('01HOTHER'))?.assetIds).toEqual(['01HOTHER']);
    // generated_* nodes are never merge targets.
    const stored = emptyCanvas();
    stored.nodes.generated_1 = { displayName: 'g', x: 0, y: 0, tags: [], refs: [], prompt: '', params: { batchCount: 1 }, assetIds: ['01HV1'] };
    await writeCanvas(FARM, stored);
    const nodes = (await readCanvas(FARM)).nodes;
    expect(nodes.generated_1.assetIds).toEqual(['01HV1']);
    expect(nodes[canvasNodeId('01HV2')].assetIds).toEqual(['01HV2']);
  });
});

describe('detach and restore', () => {
  it('drops emptied nodes, keeps drafts, clears refs, canonicals and the cover', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HGONE'));
    await seedAsset(FARM, importedDoc('01HSTAY'));
    const canvas = emptyCanvas();
    const base = { tags: [], refs: [], prompt: '', params: { batchCount: 1 } };
    canvas.nodes.plain = { displayName: 'plain', x: 0, y: 0, ...base, assetIds: ['01HGONE'] };
    canvas.nodes.draft = { displayName: 'draft', x: 0, y: 0, ...base, prompt: 'keep me', assetIds: ['01HGONE'] };
    canvas.nodes.stack = { displayName: 'stack', x: 0, y: 0, ...base, assetIds: ['01HGONE', '01HSTAY'], activeAssetId: '01HGONE' };
    canvas.nodes.refd = { displayName: 'refd', x: 0, y: 0, ...base, refs: ['01HGONE', '01HSTAY'], assetIds: [] };
    await writeCanvas(FARM, canvas);

    await detachAssetFromProject(FARM, '01HGONE');
    const nodes = (await readStoredCanvas(FARM)).nodes;
    expect(nodes.plain).toBeUndefined();
    expect(nodes.draft).toMatchObject({ assetIds: [], activeAssetId: null, prompt: 'keep me' });
    expect(nodes.stack).toMatchObject({ assetIds: ['01HSTAY'], activeAssetId: '01HSTAY' });
    expect(nodes.refd.refs).toEqual(['01HSTAY']);
  });

  it('restore is a no-op for represented assets and places others at the asset column', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HR', { title: 'R', tags: ['x'] }));
    await restoreAssetToCanvas(FARM, '01HR');
    const first = (await readStoredCanvas(FARM)).nodes[canvasNodeId('01HR')];
    expect(first).toMatchObject({ displayName: 'R', tags: ['x', 'imported-image'], assetIds: ['01HR'] });
    await restoreAssetToCanvas(FARM, '01HR');
    expect(Object.keys((await readStoredCanvas(FARM)).nodes).filter((id) => id.startsWith(canvasNodeId('01HR')))).toHaveLength(1);
  });
});

describe('attach generated assets', () => {
  it('fills a draft node in place and defaults the style canonical to the first take', async () => {
    await seedProject();
    await seedAsset(FARM, generatedDoc('01HTAKE1', 'style anchor', [], { tags: ['adaptation', 'archetype', 'character-style'] }));
    const first = await readAsset(FARM, '01HTAKE1');
    const result = await attachGeneratedAssetsToCanvas(FARM, 'style_character', [first]);
    expect(result).toEqual({ nodeId: 'style_character', panelId: null });
    let node = (await readCanvas(FARM)).nodes.style_character;
    expect(node.assetIds).toEqual(['01HTAKE1']);
    expect(node.activeAssetId).toBe('01HTAKE1');
    let tags = Object.fromEntries((await listProjectTags(FARM)).map((tag) => [tag.id, tag]));
    expect(tags['character-style'].canonicalAssetId).toBe('01HTAKE1');

    // A second run stacks; the canonical stays with the chosen take.
    await seedAsset(FARM, generatedDoc('01HTAKE2', 'style anchor v2', [], { tags: ['character-style'] }));
    await attachGeneratedAssetsToCanvas(FARM, 'style_character', [await readAsset(FARM, '01HTAKE2')]);
    node = (await readCanvas(FARM)).nodes.style_character;
    expect(node.assetIds).toEqual(['01HTAKE1', '01HTAKE2']);
    expect(node.activeAssetId).toBe('01HTAKE2');
    tags = Object.fromEntries((await listProjectTags(FARM)).map((tag) => [tag.id, tag]));
    expect(tags['character-style'].canonicalAssetId).toBe('01HTAKE1');
  });

  it('routes results to an existing variant group and creates a node for unknown ids', async () => {
    await seedProject();
    await seedAsset(FARM, generatedDoc('01HA', 'dawn', []));
    await seedAsset(FARM, generatedDoc('01HB', 'dawn', []));
    const stored = emptyCanvas();
    stored.nodes.existing = { displayName: 'e', x: 0, y: 0, tags: [], refs: [], prompt: '', params: { batchCount: 1 }, assetIds: ['01HA'] };
    stored.nodes.draft = { displayName: 'd', x: 0, y: 0, tags: [], refs: [], prompt: 'dawn', params: { batchCount: 1 }, assetIds: [] };
    await writeCanvas(FARM, stored);
    expect(await matchingVariantGroupNodeId(FARM, stored, [await readAsset(FARM, '01HB')])).toBe('existing');

    const routed = await attachGeneratedAssetsToCanvas(FARM, 'draft', [await readAsset(FARM, '01HB')]);
    expect(routed.nodeId).toBe('existing');
    let nodes = (await readStoredCanvas(FARM)).nodes;
    expect(nodes.existing.assetIds).toEqual(['01HA', '01HB']);
    expect(nodes.draft).toBeUndefined();

    await seedAsset(FARM, generatedDoc('01HC', 'dusk', [], { title: 'Dusk' }));
    await attachGeneratedAssetsToCanvas(FARM, 'node_new', [await readAsset(FARM, '01HC')]);
    nodes = (await readStoredCanvas(FARM)).nodes;
    expect(nodes.node_new).toMatchObject({ displayName: 'Dusk', x: 120, y: 120, assetIds: ['01HC'], activeAssetId: '01HC' });
  });

  it('keeps origin-linked nodes and reports the panel id', async () => {
    await seedProject();
    await seedAsset(FARM, generatedDoc('01HP', 'panel'));
    const stored = emptyCanvas();
    stored.nodes.panelNode = {
      displayName: 'p',
      x: 0,
      y: 0,
      tags: [],
      refs: [],
      prompt: 'panel',
      params: { batchCount: 1 },
      assetIds: [],
      origin: { kind: 'panel', id: 'panel-001' },
    };
    await writeCanvas(FARM, stored);
    const result = await attachGeneratedAssetsToCanvas(FARM, 'panelNode', [await readAsset(FARM, '01HP')]);
    expect(result).toEqual({ nodeId: 'panelNode', panelId: 'panel-001' });
    expect((await readStoredCanvas(FARM)).nodes.panelNode.assetIds).toEqual(['01HP']);
  });
});

describe('attach chat assets', () => {
  function session(canvasNodeId: string | null, modelTurns: number): ChatSession {
    const turns: ChatTurn[] = [];
    for (let i = 0; i < modelTurns; i += 1) {
      turns.push({ id: `t${i}`, role: 'model', createdAt: STAMP, text: '', settings: { model: 'm', aspectRatio: '1:1', imageSize: '1K', includeThoughts: false }, attachments: [], generatedAssetIds: [] });
    }
    return {
      version: 1,
      id: 'sess',
      projectSlug: FARM,
      status: 'active',
      title: 'Refine hero',
      source: { assetId: '01HSRC', canvasNodeId },
      createdAt: STAMP,
      updatedAt: STAMP,
      defaults: { model: 'm', aspectRatio: '1:1', imageSize: '1K', includeThoughts: false },
      protectedAssetIds: [],
      turns,
      provider: { name: 'google-genai', model: 'm', history: [] },
    };
  }

  it('joins the source node stack when present, else places a node per turn', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HSRC'));
    await seedAsset(FARM, generatedDoc('01HOUT1', 'x'));
    await seedAsset(FARM, generatedDoc('01HOUT2', 'y'));
    const stored = emptyCanvas();
    stored.nodes.src = { displayName: 's', x: 0, y: 0, tags: [], refs: [], prompt: '', params: { batchCount: 1 }, assetIds: ['01HSRC'] };
    await writeCanvas(FARM, stored);
    const out1 = await readAsset(FARM, '01HOUT1');
    const out2 = await readAsset(FARM, '01HOUT2');

    const withSource = session('src', 1);
    await attachChatAssetsToCanvas(FARM, withSource, withSource.turns[0], [out1]);
    expect((await readStoredCanvas(FARM)).nodes.src).toMatchObject({ assetIds: ['01HSRC', '01HOUT1'], activeAssetId: '01HOUT1' });

    const detached = session(null, 3);
    await attachChatAssetsToCanvas(FARM, detached, detached.turns[2], [out2]);
    const node = (await readStoredCanvas(FARM)).nodes['chat_sess_t2'];
    expect(node).toMatchObject({ displayName: 'Refine hero turn 3', x: 120, y: 120 + 2 * 260, width: null, assetIds: ['01HOUT2'], activeAssetId: '01HOUT2' });
    await attachChatAssetsToCanvas(FARM, detached, detached.turns[2], []);
  });
});

describe('composeGenerationPrompt', () => {
  it('joins user and style prompts with newline terminators', () => {
    expect(composeGenerationPrompt(' hero ', null)).toBe('hero\n');
    expect(composeGenerationPrompt('', ' crayons ')).toBe('crayons\n');
    expect(composeGenerationPrompt('hero', 'crayons')).toBe('hero\n\ncrayons\n');
    expect(composeGenerationPrompt('', '')).toBe('');
  });
});
