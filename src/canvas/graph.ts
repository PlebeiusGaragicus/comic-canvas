import type { Edge, Node } from 'reactflow';
import type { TagDefinition } from '../types';
import type { CanvasNodeData } from './types';
import { canDeleteNode } from './shared';

export function generatedResultNodeId(sourceNodeId: string): string {
  return `generated_${sourceNodeId}`;
}

export function deriveStoryGraphEdges(filteredNodes: Node<CanvasNodeData>[]): Edge[] {
  const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
  const nodeForAsset = new Map<string, Node<CanvasNodeData>>();
  filteredNodes.forEach((node) => {
    node.data.assetIds.forEach((assetId) => nodeForAsset.set(assetId, node));
  });
  const edgeForAssetRef = (childNode: Node<CanvasNodeData>, childAssetId: string | null, ref: string): Edge | null => {
    const sourceNode = nodeForAsset.get(ref);
    if (!sourceNode || sourceNode.id === childNode.id) return null;
    const isDraftChild = childNode.data.assetIds.length === 0;
    const sourceVisible = sourceNode.data.activeAsset?.id === ref;
    const childVisible = isDraftChild || childNode.data.activeAsset?.id === childAssetId;
    const isVisibleLineage = sourceVisible && childVisible;
    return {
      id: `${sourceNode.id}-${childNode.id}-${childAssetId ?? 'draft'}-${ref}`,
      source: sourceNode.id,
      target: childNode.id,
      animated: isDraftChild,
      className: `${isVisibleLineage ? 'lineage-edge-visible' : 'lineage-edge-hidden'}${childAssetId && childNode.data.assets.find((asset) => asset.id === childAssetId)?.generation?.chatSessionId ? ' lineage-edge-chat-refinement' : ''}`,
      style: isVisibleLineage ? undefined : { strokeDasharray: '5 5', opacity: 0.35 },
    };
  };
  // Nodes with takes draw ancestry from each take's generation receipt; nodes
  // still drafting draw their pending refs.
  const assetEdges = filteredNodes.flatMap((node) => (
    node.data.assets.flatMap((asset) => (asset.generation?.refs ?? []).flatMap((ref) => edgeForAssetRef(node, asset.id, ref) ?? []))
  ));
  const draftEdges = filteredNodes.flatMap((node) => {
    if (node.data.assetIds.length > 0) return [];
    return node.data.refs.flatMap((ref) => edgeForAssetRef(node, null, ref) ?? []);
  });
  const generatedResultEdges = filteredNodes.flatMap((node) => {
    // Legacy generated-child nodes carry their source in the node id.
    const sourceNodeId = node.id.startsWith('generated_') ? node.id.slice('generated_'.length) : null;
    if (!sourceNodeId || !visibleNodeIds.has(sourceNodeId)) return [];
    return [{
      id: `${sourceNodeId}-${node.id}-generated-result`,
      source: sourceNodeId,
      target: node.id,
      animated: Boolean(node.data.isGenerating),
      className: 'lineage-edge-visible',
    }];
  });
  return [...assetEdges, ...draftEdges, ...generatedResultEdges];
}

export function deletableSelectedNodes(nodes: Node<CanvasNodeData>[], selectedNodeIds: string[], projectTags: TagDefinition[]): Node<CanvasNodeData>[] {
  const selected = new Set(selectedNodeIds);
  return nodes.filter((node) => selected.has(node.id) && canDeleteNode(node, projectTags));
}

export function deleteSelectedNodesMessage(selectedCount: number, deletableCount: number, imageNodeCount: number): string {
  const skippedCount = selectedCount - deletableCount;
  const suffix = skippedCount ? ` ${skippedCount} canonical image node(s) will be kept.` : '';
  const draftNodeCount = deletableCount - imageNodeCount;
  if (imageNodeCount && draftNodeCount) {
    return `Archive ${imageNodeCount} selected image node(s) and delete ${draftNodeCount} draft node(s)?${suffix}`;
  }
  if (imageNodeCount) {
    return `Archive ${imageNodeCount} selected image node(s)?${suffix}`;
  }
  return `Delete ${deletableCount} selected draft node(s)?${suffix}`;
}


function nodeFingerprint(node: Node<CanvasNodeData>): string {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.data as unknown as Record<string, unknown>)) {
    if (typeof value === 'function') continue;
    data[key] = value instanceof Map ? Array.from(value.entries()) : value;
  }
  return JSON.stringify({ x: node.position.x, y: node.position.y, type: node.type, data });
}

/**
 * Reconcile a reloaded node list against the current one: reuse the previous
 * node object when nothing observable changed (React Flow then skips
 * re-render/remount) and carry selection flags across the reload.
 */
export function mergeFlowNodes(prev: Node<CanvasNodeData>[], next: Node<CanvasNodeData>[]): Node<CanvasNodeData>[] {
  const prevById = new Map(prev.map((node) => [node.id, node]));
  return next.map((nextNode) => {
    const prevNode = prevById.get(nextNode.id);
    if (!prevNode) return nextNode;
    if (nodeFingerprint(prevNode) === nodeFingerprint(nextNode)) return prevNode;
    return prevNode.selected ? { ...nextNode, selected: true } : nextNode;
  });
}
