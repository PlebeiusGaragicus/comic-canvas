import type { Asset, CanvasNode, TagDefinition } from '../types';

/** Flow-node data: the canvas node plus resolved assets and interaction callbacks. */
export interface CanvasNodeData extends CanvasNode {
  nodeId: string;
  assets: Asset[];
  activeAsset: Asset | null;
  parentDisplayNames?: Map<string, string>;
  projectTags: TagDefinition[];
  isGenerating?: boolean;
  archivedOnlyView?: boolean;
  onVariant: (nodeId: string, direction: -1 | 1) => void;
  onView: (nodeId: string) => void;
  onDetails: (nodeId: string) => void;
  onDisplayNameChange: (nodeId: string, displayName: string) => void;
  onCreateTag: (tag: TagDefinition) => void;
}

export function nodeHasTakes(data: Pick<CanvasNodeData, 'assetIds'>): boolean {
  return data.assetIds.length > 0;
}
