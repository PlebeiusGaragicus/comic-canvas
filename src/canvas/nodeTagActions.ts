import type { TagDefinition } from '../types';

export const nodeTagActionsRef: {
  updatePartitionedAssetTags: (nodeId: string, assetId: string, userTags: string[], characterTags: string[], locationTags: string[]) => void;
  createProjectTag: (tag: TagDefinition) => void;
  setTagCanonical: (tagId: string, assetId: string | null) => void;
} = {
  updatePartitionedAssetTags: () => {},
  createProjectTag: () => {},
  setTagCanonical: () => {},
};
