import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Handle, Position, type NodeProps } from 'reactflow';
import { nodeTagActionsRef } from './nodeTagActions';
import { NodeTagButton } from './assetTagRow';
import { canonicalTagsForAsset, conceptSubjectFromTags, styleEntityTagsOnNode, visibleDisplayName, visibleVariants } from './shared';
import type { CanvasNodeData } from './types';

export function truncateDraftPreview(text: string, max = 120) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

/** The one canvas node card: prompt state (no takes yet) or image state. */
function CanvasNodeCard({ data }: NodeProps<CanvasNodeData>) {
  const asset = data.activeAsset;
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(visibleDisplayName(data.displayName));
  const [imageRatio, setImageRatio] = useState<number | null>(null);
  useEffect(() => {
    if (!isEditingName) setDraftName(visibleDisplayName(data.displayName));
  }, [data.displayName, isEditingName]);
  useEffect(() => {
    setImageRatio(null);
  }, [asset?.id]);
  const saveName = () => {
    data.onDisplayNameChange(data.nodeId, draftName.trim());
    setIsEditingName(false);
  };
  const styleTags = styleEntityTagsOnNode(data.tags, data.projectTags);

  if (!asset) {
    const promptPreview = data.prompt.trim()
      ? (styleTags.length ? truncateDraftPreview(data.prompt) : data.prompt.replace(/\s+/g, ' ').trim())
      : '';
    const subject = conceptSubjectFromTags(data.tags);
    const badge = styleTags.length
      ? `${styleTags[0].name} anchor`
      : subject === 'character'
        ? 'Character concept'
        : subject === 'location'
          ? 'Location concept'
          : data.tags.includes('character-sheet')
            ? 'Character'
            : 'Prompt';
    const title = visibleDisplayName(data.displayName);
    const tooltip = [
      data.prompt || 'Prompt not set',
      `parents: ${data.refs.length}`,
      `model: ${data.params.model ?? 'default'}`,
      `ratio: ${data.params.aspectRatio ?? 'default'}, size: ${data.params.imageSize ?? 'default'}, seed: ${data.params.seed ?? 'auto'}`,
    ].join('\n');
    return (
      <div
        className={clsx(
          'node',
          'draft-node',
          styleTags.length > 0 && 'archetype-draft-node',
          !styleTags.length && 'image-group-prompt-node',
          data.isGenerating && 'generating',
        )}
        title={tooltip}
      >
        <Handle type="target" position={Position.Left} className="input-handle" isConnectable={false} />
        <div className="draft-placeholder" aria-hidden="true">
          {promptPreview && <p className="draft-prompt-preview">{promptPreview}</p>}
          <span className="node-role-badge">{badge}</span>
          {data.isGenerating && (
            <div className="node-generating-overlay">
              <span className="spinner" aria-hidden="true" />
              <span>Generating</span>
            </div>
          )}
        </div>
        <strong className={clsx('node-title', !title && 'placeholder')}>
          {title || 'add title (double click)'}
        </strong>
        <Handle type="source" position={Position.Right} className="output-handle" />
      </div>
    );
  }

  const visibleVariantsList = visibleVariants(data.assets, data.assetIds, data.archivedOnlyView ?? false);
  const currentVisibleIndex = visibleVariantsList.findIndex((variant) => variant.id === asset.id);
  const hasMultipleVariants = visibleVariantsList.length > 1;
  const params = asset.generation;
  const styleRole = styleTags.length ? `${styleTags[0].name} anchor` : null;
  const canonicalFor = canonicalTagsForAsset(asset.id, data.projectTags);
  const tooltip = [
    asset.prompt?.text,
    params ? `model: ${params.model}` : null,
    params ? `ratio: ${params.aspectRatio}, size: ${params.imageSize}, seed: ${params.seed ?? 'auto'}` : null,
    hasMultipleVariants && currentVisibleIndex >= 0 ? `variants: ${currentVisibleIndex + 1}/${visibleVariantsList.length}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const isArchived = Boolean(asset.archivedAt);
  return (
    <div className={`node image-group-node ${styleRole ? 'style-ref-image-node' : ''} ${hasMultipleVariants ? 'stacked' : ''} ${data.isGenerating ? 'generating' : ''} ${isArchived ? 'is-archived' : ''}`} title={tooltip}>
      <Handle type="target" position={Position.Left} className="input-handle" isConnectable={false} />
      {isEditingName ? (
        <input
          className="node-title-input"
          value={draftName}
          autoFocus
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={saveName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveName();
            if (event.key === 'Escape') {
              setDraftName(visibleDisplayName(data.displayName));
              setIsEditingName(false);
            }
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        />
      ) : (
        <strong className={`node-title ${visibleDisplayName(data.displayName) ? '' : 'placeholder'}`} onDoubleClick={() => setIsEditingName(true)}>
          {visibleDisplayName(data.displayName) || 'add title (double click)'}
        </strong>
      )}
      <div className="node-image-frame" style={{ aspectRatio: imageRatio ? `${imageRatio}` : undefined }}>
        {styleRole && <span className="node-role-badge">{styleRole}</span>}
        {isArchived && <span className="node-role-badge archived-badge">Archived</span>}
        {canonicalFor.length > 0 && (
          <span className="node-canonical-star" title={`Canonical image for ${canonicalFor.map((tag) => tag.name).join(', ')}`}>★</span>
        )}
        {asset.thumbnailUrl && (
          <img
            src={asset.thumbnailUrl}
            alt=""
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) setImageRatio(naturalWidth / naturalHeight);
            }}
          />
        )}
        {hasMultipleVariants && currentVisibleIndex >= 0 && (
          <small className="variant-indicator">{currentVisibleIndex + 1} / {visibleVariantsList.length}</small>
        )}
        {hasMultipleVariants && (
          <div className="variant-controls">
            <button
              className="nodrag nopan"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                data.onVariant(data.nodeId, -1);
              }}
              title="Previous variant"
            >
              &lt;
            </button>
            <button
              className="nodrag nopan"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                data.onVariant(data.nodeId, 1);
              }}
              title="Next variant"
            >
              &gt;
            </button>
          </div>
        )}
        <button
          className="node-action-button view-image-button nodrag nopan"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data.onView(data.nodeId);
          }}
          title="View full image"
        >
          👁️
        </button>
        {data.isGenerating && (
          <div className="node-generating-overlay">
            <span className="spinner" aria-hidden="true" />
            <span>Generating</span>
          </div>
        )}
      </div>
      <NodeTagButton
        tagIds={asset.tags}
        projectTags={data.projectTags}
        onPartitionedTagsChange={(userTags, characterTags, locationTags) => (
          nodeTagActionsRef.updatePartitionedAssetTags(data.nodeId, asset.id, userTags, characterTags, locationTags)
        )}
        onCreateTag={(tag) => nodeTagActionsRef.createProjectTag(tag)}
        canonicalAssetId={asset.id}
        onSetCanonical={(tagId, assetId) => nodeTagActionsRef.setTagCanonical(tagId, assetId)}
      />
      <Handle type="source" position={Position.Right} className="output-handle" />
    </div>
  );
}

export const nodeTypes = {
  canvasNode: CanvasNodeCard,
};
