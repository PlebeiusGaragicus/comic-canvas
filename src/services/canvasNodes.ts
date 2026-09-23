/** Shared canvas image-group node factories (ported from api/canvas_nodes.py). */
import { newUlid } from './ids';
import { notFound } from './errors';
import { makeCanvasNode, nodeTags, readStoredCanvas, writeCanvas } from './canvas';
import { entityDisplayName as entityDisplayNameForKey } from './tags';
import type { CanvasDocument, CanvasNodeOrigin, CharacterRecord, GenerationParams, ImageGroupNodeCreatePayload, ImageGroupNodeResponse, LocationRecord } from '../types';

export const NODE_LAYOUT = { columns: 5, startX: 80, startY: 320, xGap: 310, yGap: 230 } as const;

export function nextCanvasPosition(canvas: CanvasDocument): { x: number; y: number } {
  const index = Object.keys(canvas.nodes).length;
  return {
    x: NODE_LAYOUT.startX + (index % NODE_LAYOUT.columns) * NODE_LAYOUT.xGap,
    y: NODE_LAYOUT.startY + Math.floor(index / NODE_LAYOUT.columns) * NODE_LAYOUT.yGap,
  };
}

export interface CreateImageGroupNodeOptions {
  displayName?: string;
  tags: string[];
  prompt?: string;
  refs?: string[];
  params?: Partial<GenerationParams> | null;
  visualStyleId?: string | null;
  x: number;
  y: number;
  width?: number | null;
  assetIds?: string[];
  activeAssetId?: string | null;
  origin?: CanvasNodeOrigin | null;
}

export async function createImageGroupNode(slug: string, options: CreateImageGroupNodeOptions): Promise<ImageGroupNodeResponse> {
  const canvas = await readStoredCanvas(slug);
  let nodeId = `node_${newUlid()}`;
  while (nodeId in canvas.nodes) nodeId = `node_${newUlid()}`;
  const assetIds = [...(options.assetIds ?? [])];
  canvas.nodes[nodeId] = makeCanvasNode({
    displayName: options.displayName ?? '',
    x: options.x,
    y: options.y,
    width: options.width === undefined ? 240 : options.width,
    tags: nodeTags(...options.tags),
    refs: [...(options.refs ?? [])],
    prompt: options.prompt ?? '',
    params: { batchCount: 1, ...(options.params ?? {}) },
    visualStyleId: options.visualStyleId ?? null,
    assetIds,
    activeAssetId: assetIds.length ? options.activeAssetId ?? null : null,
    origin: options.origin ?? null,
  });
  const saved = await writeCanvas(slug, canvas);
  return { nodeId, canvas: saved };
}

type EntityRecord = CharacterRecord | LocationRecord;

function recordDisplayName(record: EntityRecord): string {
  return record.name.trim() || entityDisplayNameForKey(record.slug);
}

function variantEntityKey(entitySlug: string, variantKey: string): string {
  return variantKey === 'base' ? entitySlug : `${entitySlug}-${variantKey}`;
}

async function spawnFromVariant(
  slug: string,
  record: EntityRecord,
  variantKey: string,
  baseTags: string[],
  missingVariant: string,
): Promise<ImageGroupNodeResponse> {
  const link = record.variants[variantKey];
  if (!link) throw notFound(missingVariant);
  const canvas = await readStoredCanvas(slug);
  const { x, y } = nextCanvasPosition(canvas);
  let displayName = recordDisplayName(record);
  const tagKeys = [...baseTags, record.slug];
  if (variantKey !== 'base') {
    displayName = `${displayName} (${link.label.trim() || variantKey})`;
    // The variant's own entity tag rides along with the base tag: the base
    // canonical anchors the design while this sheet is first made, and the
    // variant tag carries this look's own canonical afterwards.
    tagKeys.push(variantEntityKey(record.slug, variantKey));
  }
  return createImageGroupNode(slug, {
    displayName,
    tags: nodeTags(...tagKeys),
    prompt: link.prompt.trim(),
    refs: [...link.assetIds],
    params: {},
    x,
    y,
  });
}

/** Lazy import: adaptation.ts imports this module, the sanctioned cycle break. */
async function adaptationRecords(slug: string) {
  const adaptation = await import('./adaptation');
  return adaptation.readMetadata(slug);
}

export async function spawnFromCharacterVariant(slug: string, characterSlug: string, variantKey = 'base'): Promise<ImageGroupNodeResponse> {
  const metadata = await adaptationRecords(slug);
  const record = metadata.characters[characterSlug];
  if (!record) throw notFound(`Unknown character: ${characterSlug}`);
  return spawnFromVariant(
    slug,
    record,
    variantKey,
    ['comic-adaptation', 'character-sheet'],
    `Unknown character variant: ${characterSlug}/${variantKey}`,
  );
}

export async function spawnFromLocationVariant(slug: string, locationSlug: string, variantKey = 'base'): Promise<ImageGroupNodeResponse> {
  const metadata = await adaptationRecords(slug);
  const record = metadata.locations[locationSlug];
  if (!record) throw notFound(`Unknown location: ${locationSlug}`);
  return spawnFromVariant(
    slug,
    record,
    variantKey,
    ['comic-adaptation', 'location-prompt'],
    `Unknown location variant: ${locationSlug}/${variantKey}`,
  );
}

export async function createImageGroup(slug: string, payload: ImageGroupNodeCreatePayload): Promise<ImageGroupNodeResponse> {
  const canvas = await readStoredCanvas(slug);
  const { x, y } = nextCanvasPosition(canvas);
  return createImageGroupNode(slug, {
    displayName: (payload.displayName ?? '').trim(),
    tags: payload.tags ?? [],
    prompt: payload.prompt ?? '',
    refs: [...(payload.refs ?? [])],
    visualStyleId: payload.visualStyleId ?? null,
    x,
    y,
  });
}
