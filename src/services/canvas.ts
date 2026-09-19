/** Canvas document (ported from api/library.py). A read returns the stored
 *  document plus auto-nodes for assets not yet represented, with generated
 *  variants of the same prompt/refs collapsed into one stack. */
import { getProjectDoc, putProjectDoc } from '../store/db';
import { notifyChange } from '../store/changes';
import { TAG_RE } from './common';
import { invalid } from './errors';
import { newUlid } from './ids';
import { assetHasPixels } from './assetBlobs';
import { listAssetMetadata, listAssets, metadataToSummary, readAssetMetadata, readAssetMetadataOrNull } from './assets';
import { readProjectMetadata, requireProject, writeProjectMetadata } from './projectDocs';
import { STYLE_ENTITY_TAGS, ensureStyleEntityTags, listProjectTags, updateEntityTagCanonicals } from './tags';
import type { Asset, AssetMetadata, CanvasDocument, CanvasNode, ChatSession, ChatTurn, GenerationParams } from '../types';

export const DEFAULT_STARTER_DRAFT_NODE_ID = 'draft_seed';

// ---------------------------------------------------------------------------
// Seed prompts and default documents

const seedFiles = import.meta.glob('./seedDefaults/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface SeedDefaultPrompt {
  displayName: string;
  prompt: string;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function listSeedDefaultPrompts(): SeedDefaultPrompt[] {
  const seeds: SeedDefaultPrompt[] = [];
  for (const path of Object.keys(seedFiles).sort()) {
    const prompt = seedFiles[path].trim();
    if (!prompt) continue;
    const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
    seeds.push({ displayName: titleCase(stem.replace(/[-_]/g, ' ').trim()), prompt });
  }
  return seeds;
}

export function pickRandomSeedDefaultPrompt(): SeedDefaultPrompt | null {
  const seeds = listSeedDefaultPrompts();
  if (!seeds.length) return null;
  return seeds[Math.floor(Math.random() * seeds.length)];
}

export function defaultGenerationParams(): GenerationParams {
  return { model: null, aspectRatio: null, imageSize: null, seed: null, batchCount: 1 };
}

/** A full-shape node from a partial (the pydantic defaults). */
export function makeCanvasNode(partial: Partial<CanvasNode> & Pick<CanvasNode, 'displayName' | 'x' | 'y'>): CanvasNode {
  const assetIds = [...(partial.assetIds ?? [])];
  const node: CanvasNode = {
    displayName: partial.displayName,
    x: partial.x,
    y: partial.y,
    width: partial.width ?? null,
    tags: [...(partial.tags ?? [])],
    refs: [...(partial.refs ?? [])],
    prompt: partial.prompt ?? '',
    params: { ...defaultGenerationParams(), ...(partial.params ?? {}) },
    visualStyleId: partial.visualStyleId ?? null,
    assetIds,
    activeAssetId: partial.activeAssetId ?? null,
    origin: partial.origin ?? null,
  };
  return applyActiveAssetRule(node);
}

/** `CanvasNode.active_asset_defaults_to_first`. */
function applyActiveAssetRule(node: CanvasNode): CanvasNode {
  if (!node.assetIds.length) node.activeAssetId = null;
  else if (node.activeAssetId == null || !node.assetIds.includes(node.activeAssetId)) node.activeAssetId = node.assetIds[0];
  return node;
}

export function emptyCanvasDocument(): CanvasDocument {
  return { version: 2, viewport: { x: 0, y: 0, zoom: 1 }, nodes: {} };
}

/** Ordinary style-anchor nodes: generate, pick a take, it becomes the style canonical. */
export function styleSeedNodes(): Record<string, CanvasNode> {
  return {
    style_character: makeCanvasNode({
      displayName: 'Character Style',
      x: 80,
      y: -220,
      width: 240,
      tags: ['adaptation', 'archetype', 'character-style'],
      params: { aspectRatio: '1:1', imageSize: '1K', batchCount: 1 },
    }),
    style_scene: makeCanvasNode({
      displayName: 'Scene Style',
      x: 400,
      y: -220,
      width: 240,
      tags: ['adaptation', 'archetype', 'scene-style'],
      params: { aspectRatio: '1:1', imageSize: '1K', batchCount: 1 },
    }),
  };
}

export function defaultCanvasForNewProject(): CanvasDocument {
  const nodes: Record<string, CanvasNode> = styleSeedNodes();
  const seed = pickRandomSeedDefaultPrompt();
  if (seed) {
    nodes[DEFAULT_STARTER_DRAFT_NODE_ID] = makeCanvasNode({
      displayName: seed.displayName,
      x: 120,
      y: 120,
      refs: [],
      prompt: seed.prompt,
      params: { model: 'gemini-3.1-flash-image', aspectRatio: '16:9', imageSize: '1K', batchCount: 1 },
    });
  }
  return { ...emptyCanvasDocument(), nodes };
}

export function nodeTags(...tags: string[]): string[] {
  return [...new Set(tags)];
}

export function canvasNodeId(assetId: string): string {
  return `node_${assetId}`;
}

// ---------------------------------------------------------------------------
// Input validation (the pydantic shape rules)

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normalizeNode(nodeId: string, raw: unknown): CanvasNode {
  if (!raw || typeof raw !== 'object') throw invalid(`Invalid canvas node: ${nodeId}`);
  const node = raw as Record<string, unknown>;
  if (typeof node.displayName !== 'string') throw invalid(`Canvas node ${nodeId} needs a displayName`);
  if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) throw invalid(`Canvas node ${nodeId} needs numeric x/y`);
  if (node.width != null && !isFiniteNumber(node.width)) throw invalid(`Canvas node ${nodeId} has an invalid width`);
  for (const field of ['tags', 'refs', 'assetIds'] as const) {
    if (node[field] != null && !isStringList(node[field])) throw invalid(`Canvas node ${nodeId} has an invalid ${field} list`);
  }
  if (node.prompt != null && typeof node.prompt !== 'string') throw invalid(`Canvas node ${nodeId} has an invalid prompt`);
  if (node.visualStyleId != null && (typeof node.visualStyleId !== 'string' || !TAG_RE.test(node.visualStyleId))) {
    throw invalid(`Canvas node ${nodeId} has an invalid visualStyleId`);
  }
  const params = (node.params ?? {}) as Record<string, unknown>;
  if (typeof params !== 'object') throw invalid(`Canvas node ${nodeId} has invalid params`);
  const batchCount = params.batchCount ?? 1;
  if (!Number.isInteger(batchCount) || (batchCount as number) < 1 || (batchCount as number) > 8) {
    throw invalid(`Canvas node ${nodeId} batchCount must be between 1 and 8`);
  }
  if (params.seed != null && (!Number.isInteger(params.seed) || (params.seed as number) < 0)) {
    throw invalid(`Canvas node ${nodeId} seed must be a non-negative integer`);
  }
  const origin = node.origin as CanvasNode['origin'];
  if (origin != null) {
    if (typeof origin !== 'object' || (origin.kind !== 'panel' && origin.kind !== 'conceptCard') || typeof origin.id !== 'string') {
      throw invalid(`Canvas node ${nodeId} has an invalid origin`);
    }
  }
  return makeCanvasNode({
    displayName: node.displayName,
    x: node.x,
    y: node.y,
    width: (node.width as number | null | undefined) ?? null,
    tags: (node.tags as string[] | undefined) ?? [],
    refs: (node.refs as string[] | undefined) ?? [],
    prompt: (node.prompt as string | undefined) ?? '',
    params: {
      model: (params.model as string | null | undefined) ?? null,
      aspectRatio: (params.aspectRatio as string | null | undefined) ?? null,
      imageSize: (params.imageSize as string | null | undefined) ?? null,
      seed: (params.seed as number | null | undefined) ?? null,
      batchCount: batchCount as number,
    },
    visualStyleId: (node.visualStyleId as string | null | undefined) ?? null,
    assetIds: (node.assetIds as string[] | undefined) ?? [],
    activeAssetId: (node.activeAssetId as string | null | undefined) ?? null,
    origin: origin ?? null,
  });
}

/** Fill defaults and apply the node validators; throws `invalid` on bad shape. */
export function normalizeCanvasDocument(raw: unknown): CanvasDocument {
  if (!raw || typeof raw !== 'object') throw invalid('Canvas document must be an object');
  const doc = raw as Record<string, unknown>;
  const viewport = (doc.viewport ?? {}) as Record<string, unknown>;
  const x = viewport.x ?? 0;
  const y = viewport.y ?? 0;
  const zoom = viewport.zoom ?? 1;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom)) throw invalid('Canvas viewport must be numeric');
  const rawNodes = (doc.nodes ?? {}) as Record<string, unknown>;
  if (typeof rawNodes !== 'object' || Array.isArray(rawNodes)) throw invalid('Canvas nodes must be a map');
  const nodes: Record<string, CanvasNode> = {};
  for (const [nodeId, node] of Object.entries(rawNodes)) nodes[nodeId] = normalizeNode(nodeId, node);
  return { version: 2, viewport: { x, y, zoom }, nodes };
}

// ---------------------------------------------------------------------------
// Stored document

export async function readStoredCanvas(slug: string): Promise<CanvasDocument> {
  await requireProject(slug);
  const doc = await getProjectDoc<CanvasDocument>('canvas', slug);
  return doc ? normalizeCanvasDocument(doc) : emptyCanvasDocument();
}

export async function writeCanvas(slug: string, canvas: CanvasDocument): Promise<CanvasDocument> {
  await requireProject(slug);
  const normalized = normalizeCanvasDocument(canvas);
  await validateCanvas(slug, normalized);
  await putProjectDoc('canvas', slug, normalized);
  notifyChange('canvas', slug);
  return normalized;
}

async function assetIsUsable(slug: string, assetId: string): Promise<boolean> {
  return (await readAssetMetadataOrNull(slug, assetId)) !== null && (await assetHasPixels(slug, assetId));
}

export async function validateRefs(slug: string, refs: string[]): Promise<void> {
  await requireProject(slug);
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) throw invalid(`Duplicate ref: ${ref}`);
    seen.add(ref);
    if (!(await assetIsUsable(slug, ref))) throw invalid(`Invalid same-project ref: ${ref}`);
  }
}

export async function validateCanvas(slug: string, canvas: CanvasDocument): Promise<void> {
  await requireProject(slug);
  for (const [nodeId, node] of Object.entries(canvas.nodes)) {
    await validateRefs(slug, node.refs);
    for (const assetId of node.assetIds) {
      if (!(await assetIsUsable(slug, assetId))) throw invalid(`Invalid asset in canvas node ${nodeId}: ${assetId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Read model: stored + auto-nodes + variant groups

export async function readCanvas(slug: string, includeArchived = false): Promise<CanvasDocument> {
  await requireProject(slug);
  const canvas = await defaultCanvasForAssets(slug, await readStoredCanvas(slug), includeArchived);
  return normalizeVariantGroups(slug, canvas);
}

function representedAssetIds(canvas: CanvasDocument): Set<string> {
  const represented = new Set<string>();
  for (const node of Object.values(canvas.nodes)) for (const id of node.assetIds) represented.add(id);
  return represented;
}

function assetStartX(canvas: CanvasDocument): number {
  let maxStoryX = 80;
  for (const node of Object.values(canvas.nodes)) {
    if (!node.assetIds.length) maxStoryX = Math.max(maxStoryX, node.x + (node.width || 240) + 80);
  }
  return Math.max(1500, maxStoryX);
}

function autoNodeFor(asset: Pick<Asset, 'id' | 'title' | 'tags' | 'kind'>, index: number, startX: number): CanvasNode {
  return makeCanvasNode({
    displayName: asset.title,
    x: startX + (index % 3) * 280,
    y: 80 + Math.floor(index / 3) * 240,
    tags: nodeTags(...asset.tags, asset.kind === 'generated' ? 'generated-image' : 'imported-image'),
    assetIds: [asset.id],
    activeAssetId: asset.id,
  });
}

/** Add visible image groups for assets not yet represented on the canvas. */
export async function defaultCanvasForAssets(slug: string, canvas: CanvasDocument, includeArchived = false): Promise<CanvasDocument> {
  const next = structuredClone(canvas);
  const represented = representedAssetIds(next);
  let index = Object.keys(next.nodes).length;
  const startX = assetStartX(next);
  for (const asset of await listAssets(slug, includeArchived)) {
    if (represented.has(asset.id)) continue;
    let nodeId = canvasNodeId(asset.id);
    while (nodeId in next.nodes) {
      nodeId = `${canvasNodeId(asset.id)}_${index}`;
      index += 1;
    }
    next.nodes[nodeId] = autoNodeFor(asset, index, startX);
    index += 1;
  }
  return next;
}

/** Give an unrepresented asset a stored node (used when un-archiving). */
export async function restoreAssetToCanvas(slug: string, assetId: string): Promise<void> {
  const canvas = await readStoredCanvas(slug);
  if (representedAssetIds(canvas).has(assetId)) return;
  const asset = await metadataToSummary(slug, await readAssetMetadata(slug, assetId));
  let index = Object.keys(canvas.nodes).length;
  const startX = assetStartX(canvas);
  let nodeId = canvasNodeId(asset.id);
  while (nodeId in canvas.nodes) {
    nodeId = `${canvasNodeId(asset.id)}_${index}`;
    index += 1;
  }
  canvas.nodes[nodeId] = autoNodeFor(asset, index, startX);
  await writeCanvas(slug, canvas);
}

/** Drop an imported asset at an explicit canvas position (`import_asset` with canvasX/Y). */
export async function placeImportedAsset(slug: string, assetId: string, title: string, x: number, y: number): Promise<void> {
  const canvas = await readStoredCanvas(slug);
  canvas.nodes[canvasNodeId(assetId)] = makeCanvasNode({
    displayName: title,
    x,
    y,
    tags: nodeTags('imported-image'),
    assetIds: [assetId],
    activeAssetId: assetId,
  });
  await writeCanvas(slug, canvas);
}

// ---------------------------------------------------------------------------
// Variant groups

export type VariantKey = string;

async function assetIndex(slug: string): Promise<Map<string, AssetMetadata>> {
  return new Map((await listAssetMetadata(slug)).map((metadata) => [metadata.id, metadata]));
}

function variantKeyOf(metadata: AssetMetadata | null | undefined): VariantKey | null {
  if (!metadata || metadata.kind !== 'generated' || !metadata.prompt || !metadata.generation) return null;
  return JSON.stringify([metadata.prompt.text, metadata.generation.refs]);
}

export async function variantKeyForAsset(slug: string, assetId: string): Promise<VariantKey | null> {
  // A node pointing at a missing asset yields no key instead of failing the read.
  return variantKeyOf(await readAssetMetadataOrNull(slug, assetId));
}

function variantKeyForNodeFrom(node: CanvasNode, assets: Map<string, AssetMetadata>): VariantKey | null {
  for (const assetId of node.assetIds) {
    const key = variantKeyOf(assets.get(assetId));
    if (key !== null) return key;
  }
  return null;
}

export async function variantKeyForNode(slug: string, node: CanvasNode): Promise<VariantKey | null> {
  return variantKeyForNodeFrom(node, await assetIndex(slug));
}

/** Collapse generated image groups that are variants of the same prompt/refs. */
export async function normalizeVariantGroups(slug: string, canvas: CanvasDocument): Promise<CanvasDocument> {
  const next = structuredClone(canvas);
  const assets = await assetIndex(slug);
  const nodeByKey = new Map<VariantKey, string>();
  for (const [nodeId, node] of Object.entries(next.nodes)) {
    if (nodeId.startsWith('generated_')) continue;
    const key = variantKeyForNodeFrom(node, assets);
    if (key === null) continue;
    const targetId = nodeByKey.get(key);
    if (targetId === undefined) {
      nodeByKey.set(key, nodeId);
      continue;
    }
    const target = next.nodes[targetId];
    target.assetIds = [...new Set([...target.assetIds, ...node.assetIds])];
    if (target.activeAssetId == null || !target.assetIds.includes(target.activeAssetId)) target.activeAssetId = target.assetIds[0];
    delete next.nodes[nodeId];
  }
  return next;
}

export async function matchingVariantGroupNodeId(slug: string, canvas: CanvasDocument, assets: Asset[]): Promise<string | null> {
  if (!assets.length) return null;
  const key = variantKeyOf(assets[0]);
  if (key === null) return null;
  const index = await assetIndex(slug);
  for (const [nodeId, node] of Object.entries(canvas.nodes)) {
    if (nodeId.startsWith('generated_')) continue;
    for (const assetId of node.assetIds) {
      if (variantKeyOf(index.get(assetId)) === key) return nodeId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detach / attach

/** Remove every reference to an asset: node stacks and refs, tag canonicals, the project cover. */
export async function detachAssetFromProject(slug: string, assetId: string): Promise<void> {
  const canvas = await readStoredCanvas(slug);
  let changed = false;
  for (const [nodeId, node] of Object.entries(canvas.nodes)) {
    const nextRefs = node.refs.filter((ref) => ref !== assetId);
    if (nextRefs.length !== node.refs.length) {
      node.refs = nextRefs;
      changed = true;
    }
    if (node.assetIds.includes(assetId)) {
      node.assetIds = node.assetIds.filter((id) => id !== assetId);
      if (node.assetIds.length) {
        if (node.activeAssetId === assetId || node.activeAssetId == null || !node.assetIds.includes(node.activeAssetId)) {
          node.activeAssetId = node.assetIds[0];
        }
      } else if (node.prompt.trim() || node.refs.length || node.visualStyleId != null) {
        node.activeAssetId = null;
      } else {
        delete canvas.nodes[nodeId];
      }
      changed = true;
    }
  }
  if (changed) await writeCanvas(slug, canvas);

  const staleCanonicals: Record<string, null> = {};
  for (const tag of await listProjectTags(slug)) {
    if (tag.canonicalAssetId === assetId) staleCanonicals[tag.id] = null;
  }
  if (Object.keys(staleCanonicals).length) await updateEntityTagCanonicals(slug, staleCanonicals);

  const project = await readProjectMetadata(slug);
  if (project.coverAssetId === assetId) await writeProjectMetadata(slug, { ...project, coverAssetId: null });
}

/** A style-tagged node's first take becomes that style tag's canonical. */
export async function defaultStyleCanonicals(slug: string, node: CanvasNode): Promise<void> {
  if (node.activeAssetId == null) return;
  const styleTags = node.tags.filter((tag) => tag in STYLE_ENTITY_TAGS);
  if (!styleTags.length) return;
  await ensureStyleEntityTags(slug);
  const registry = new Map((await listProjectTags(slug)).map((tag) => [tag.id, tag]));
  const updates: Record<string, string | null> = {};
  for (const tagId of styleTags) {
    const tag = registry.get(tagId);
    if (tag && tag.canonicalAssetId == null) updates[tagId] = node.activeAssetId;
  }
  if (Object.keys(updates).length) await updateEntityTagCanonicals(slug, updates);
}

export interface AttachResult {
  /** The node the assets ended up in. */
  nodeId: string;
  /** When the target node was spawned from a story panel, the panel to attach to (Phase 3/4 callers do that). */
  panelId: string | null;
}

export async function attachGeneratedAssetsToCanvas(slug: string, nodeId: string, assets: Asset[]): Promise<AttachResult> {
  const canvas = await normalizeVariantGroups(slug, await readStoredCanvas(slug));
  const existing = canvas.nodes[nodeId];
  const assetIds = assets.map((asset) => asset.id);
  const activeAssetId = assetIds[0] ?? null;
  if (existing && (existing.assetIds.length || existing.origin != null)) {
    // Results join the node's stack; domain-linked prompt nodes keep their identity.
    existing.assetIds = [...new Set([...existing.assetIds, ...assetIds])];
    existing.activeAssetId = activeAssetId ?? existing.activeAssetId;
    await writeCanvas(slug, canvas);
    await defaultStyleCanonicals(slug, existing);
    return { nodeId, panelId: existing.origin?.kind === 'panel' ? existing.origin.id : null };
  }
  const targetNodeId = await matchingVariantGroupNodeId(slug, canvas, assets);
  let resultNodeId = nodeId;
  if (targetNodeId && targetNodeId !== nodeId) {
    const target = canvas.nodes[targetNodeId];
    target.assetIds = [...new Set([...target.assetIds, ...assetIds])];
    target.activeAssetId = activeAssetId ?? target.activeAssetId;
    delete canvas.nodes[nodeId];
    resultNodeId = targetNodeId;
  } else if (existing) {
    // A draft-state node generated: the stack fills in place.
    existing.assetIds = assetIds;
    existing.activeAssetId = activeAssetId;
    await defaultStyleCanonicals(slug, existing);
  } else {
    canvas.nodes[nodeId] = makeCanvasNode({
      displayName: assets[0]?.title ?? '',
      x: 120,
      y: 120,
      assetIds,
      activeAssetId,
    });
  }
  await writeCanvas(slug, canvas);
  return { nodeId: resultNodeId, panelId: null };
}

export async function attachChatAssetsToCanvas(slug: string, session: ChatSession, turn: ChatTurn, assets: Asset[]): Promise<void> {
  if (!assets.length) return;
  const canvas = await readStoredCanvas(slug);
  const sourceNodeId = session.source.canvasNodeId ?? null;
  const sourceNode = sourceNodeId ? canvas.nodes[sourceNodeId] : undefined;
  if (sourceNode && sourceNodeId) {
    // Refinements are attempts at the same image: they join the stack.
    sourceNode.assetIds = [...new Set([...sourceNode.assetIds, ...assets.map((asset) => asset.id)])];
    sourceNode.activeAssetId = assets[0].id;
    await writeCanvas(slug, canvas);
    return;
  }
  const turnIndex = Math.max(0, session.turns.filter((current) => current.role === 'model').length - 1);
  let nodeId = `chat_${session.id}_${turn.id}`;
  while (nodeId in canvas.nodes) nodeId = `${nodeId}_${newUlid()}`;
  canvas.nodes[nodeId] = makeCanvasNode({
    displayName: `${session.title} turn ${turnIndex + 1}`,
    x: 120,
    y: 120 + turnIndex * 260,
    width: null,
    assetIds: assets.map((asset) => asset.id),
    activeAssetId: assets[0].id,
  });
  await writeCanvas(slug, canvas);
}

// ---------------------------------------------------------------------------

/** User prompt + visual-style prompt, each block newline-terminated. */
export function composeGenerationPrompt(userPrompt: string, stylePrompt: string | null | undefined): string {
  const user = userPrompt.trim();
  const style = (stylePrompt ?? '').trim();
  if (!style) return user ? `${user}\n` : '';
  if (!user) return `${style}\n`;
  return `${user}\n\n${style}\n`;
}
