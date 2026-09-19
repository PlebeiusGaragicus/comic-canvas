import type { Node } from 'reactflow';
import { archivedVariants, defaultDraftParams } from './shared';
import type { CanvasNodeData } from './types';
import type { Asset, CanvasDocument, TagDefinition } from '../types';

export const minZoom = 0.2;
export const maxZoom = 2;

export function zoomToPercent(zoom: number) {
  const normalized = ((zoom - minZoom) / (maxZoom - minZoom)) * 100;
  return Math.round(Math.min(100, Math.max(0, normalized)));
}

function finiteCanvasNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

export function nodesToCanvas(canvas: CanvasDocument, nodes: Node<CanvasNodeData>[]): CanvasDocument {
  return {
    ...canvas,
    nodes: Object.fromEntries(
      nodes.map((node) => {
        const existing = canvas.nodes[node.id];
        return [
          node.id,
          {
            displayName: node.data.displayName ?? existing?.displayName ?? '',
            x: finiteCanvasNumber(node.position?.x, existing?.x ?? 0),
            y: finiteCanvasNumber(node.position?.y, existing?.y ?? 0),
            width: existing?.width ?? null,
            tags: node.data.tags ?? [],
            refs: node.data.refs ?? [],
            prompt: node.data.prompt ?? '',
            params: node.data.params ?? defaultDraftParams,
            visualStyleId: node.data.visualStyleId ?? null,
            assetIds: node.data.assetIds ?? [],
            activeAssetId: node.data.activeAssetId ?? node.data.assetIds[0] ?? null,
            origin: node.data.origin ?? existing?.origin ?? null,
          },
        ];
      }),
    ),
  };
}

export function imageGroupAssetsInNode(node: CanvasNodeData): Asset[] {
  return node.assets.length ? node.assets : node.activeAsset ? [node.activeAsset] : [];
}

export function withArchivedOnlyAsset(node: Node<CanvasNodeData>): Node<CanvasNodeData> {
  const variants = archivedVariants(node.data.assets, node.data.assetIds);
  if (!variants.length) return node;
  const currentId = node.data.activeAsset?.id ?? node.data.activeAssetId ?? '';
  const activeAsset = variants.find((variant) => variant.id === currentId) ?? variants[0];
  return {
    ...node,
    data: {
      ...node.data,
      archivedOnlyView: true,
      activeAsset,
      activeAssetId: activeAsset.id,
    },
  };
}

export function toFlowNodes(
  canvas: CanvasDocument,
  assets: Asset[],
  generatingNodeIds: Set<string> = new Set(),
  projectTags: TagDefinition[] = [],
  onVariant: (nodeId: string, direction: -1 | 1) => void = () => undefined,
  onView: (nodeId: string) => void = () => undefined,
  onDetails: (nodeId: string) => void = () => undefined,
  onViewAsset: (assetId: string) => void = () => undefined,
  onDisplayNameChange: (nodeId: string, displayName: string) => void = () => undefined,
  onRefineChat: (nodeId: string, assetId: string) => void = () => undefined,
  onCreateTag: (tag: TagDefinition) => void = () => undefined,
): Node<CanvasNodeData>[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const displayNameByAssetId = new Map<string, string>();
  Object.values(canvas.nodes).forEach((canvasNode) => {
    canvasNode.assetIds.forEach((assetId) => displayNameByAssetId.set(assetId, canvasNode.displayName));
  });
  return Object.entries(canvas.nodes).map(([id, canvasNode]) => {
    const groupAssets = canvasNode.assetIds.map((assetId) => assetById.get(assetId)).filter((asset): asset is Asset => Boolean(asset));
    const activeAsset = canvasNode.activeAssetId ? assetById.get(canvasNode.activeAssetId) ?? groupAssets[0] ?? null : groupAssets[0] ?? null;
    return {
      id,
      position: { x: canvasNode.x, y: canvasNode.y },
      type: 'canvasNode',
      data: {
        ...canvasNode,
        nodeId: id,
        refs: canvasNode.refs ?? [],
        prompt: canvasNode.prompt ?? '',
        params: canvasNode.params ?? defaultDraftParams,
        visualStyleId: canvasNode.visualStyleId ?? null,
        assets: groupAssets,
        activeAsset,
        parentDisplayNames: displayNameByAssetId,
        projectTags,
        onVariant,
        onView,
        onDetails,
        onDisplayNameChange,
        onCreateTag,
        isGenerating: generatingNodeIds.has(id),
      },
    };
  });
}
