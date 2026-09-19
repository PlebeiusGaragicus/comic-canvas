import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Node } from 'reactflow';
import { TagControlButton } from './assetTagRow';
import { assetLabel, visibleDisplayName, visibleVariants } from './shared';
import type { CanvasNodeData } from './types';
import { formatRequestError } from '../formatError';
import { saveAssetImageToDisk } from '../exportAssets';
import { useToast } from '../shared/toast';
import type { Asset, TagDefinition } from '../types';
import { assetImageUrl, assetThumbnailUrl } from '../shared/assetUrls';

function ImageViewerThumbButton({
  asset,
  projectSlug,
  label,
  previewAbove = false,
  onClick,
}: {
  asset: Asset;
  projectSlug: string;
  label: string;
  previewAbove?: boolean;
  onClick: () => void;
}) {
  const thumbUrl = assetThumbnailUrl(projectSlug, asset);
  const previewUrl = assetImageUrl(projectSlug, asset);
  const wrapRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);

  const updatePosition = useCallback(() => {
    const anchor = wrapRef.current;
    const preview = previewRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const previewHeight = preview?.offsetHeight ?? 440;
    const previewWidth = preview?.offsetWidth ?? 560;
    const gap = 10;
    const padding = 8;
    let top = previewAbove ? rect.top - previewHeight - gap : rect.bottom + gap;
    let left = rect.left + rect.width / 2 - previewWidth / 2;
    if (left + previewWidth > window.innerWidth - padding) {
      left = window.innerWidth - previewWidth - padding;
    }
    left = Math.max(padding, left);
    if (top < padding) {
      top = previewAbove ? rect.bottom + gap : padding;
    }
    if (top + previewHeight > window.innerHeight - padding && !previewAbove) {
      top = Math.max(padding, rect.top - previewHeight - gap);
    }
    setPosition({ top, left });
    setIsPositioned(true);
  }, [previewAbove]);

  useLayoutEffect(() => {
    if (!isHovered) {
      setIsPositioned(false);
      return;
    }
    updatePosition();
  }, [isHovered, label, updatePosition]);

  useEffect(() => {
    if (!isHovered) return;
    const reposition = () => updatePosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [isHovered, updatePosition]);

  return (
    <>
      <div
        ref={wrapRef}
        className={`image-viewer-thumb-wrap ${previewAbove ? 'preview-above' : 'preview-below'}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <button type="button" className="image-viewer-thumb-button" onClick={onClick} aria-label={label}>
          <img src={thumbUrl} alt={label} />
        </button>
      </div>
      {isHovered && createPortal(
        <div
          ref={previewRef}
          className="image-viewer-thumb-preview is-portaled"
          style={{
            top: position.top,
            left: position.left,
            visibility: isPositioned ? 'visible' : 'hidden',
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <img src={previewUrl} alt="" onLoad={updatePosition} />
        </div>,
        document.body,
      )}
    </>
  );
}

export function ImageViewer({
  node,
  fallbackAsset,
  assets,
  projectSlug,
  projectTags,
  coverAssetId,
  onClose,
  onVariant,
  onViewAsset,
  onDetails,
  onArchiveImage,
  onRestoreImage,
  onPartitionedAssetTagsChange,
  onCreateTag,
  onSetProjectCover,
  archivedOnly = false,
}: {
  node?: Node<CanvasNodeData>;
  fallbackAsset?: Asset;
  assets: Asset[];
  projectSlug: string;
  projectTags: TagDefinition[];
  coverAssetId?: string | null;
  onClose: () => void;
  onVariant: (nodeId: string, direction: -1 | 1) => void;
  onViewAsset: (assetId: string) => void;
  onDetails: (nodeId: string) => void;
  onArchiveImage: (nodeId: string, assetId: string) => void;
  onRestoreImage: (nodeId: string, assetId: string) => void;
  onPartitionedAssetTagsChange: (nodeId: string, assetId: string, userTags: string[], characterTags: string[], locationTags: string[]) => void;
  onCreateTag: (tag: TagDefinition) => void;
  onSetProjectCover: (assetId: string) => void;
  archivedOnly?: boolean;
}) {
  const toast = useToast();
  const [isSavingImage, setIsSavingImage] = useState(false);
  const viewerVariants = node ? visibleVariants(node.data.assets, node.data.assetIds, archivedOnly) : [];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && node && viewerVariants.length > 1) onVariant(node.id, -1);
      if (event.key === 'ArrowRight' && node && viewerVariants.length > 1) onVariant(node.id, 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [node, onClose, onVariant, viewerVariants.length]);

  const asset = node?.data.activeAsset ?? fallbackAsset;
  if (!asset) return null;
  const isArchived = Boolean(asset.archivedAt);
  const isProjectCover = coverAssetId === asset.id;
  const currentVisibleIndex = node ? viewerVariants.findIndex((variant) => variant.id === asset.id) : -1;
  const hasMultipleVariants = viewerVariants.length > 1;
  const imageUrl = assetImageUrl(projectSlug, asset);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const parentAssets = (asset.generation?.refs ?? []).map((ref) => assetById.get(ref)).filter((asset): asset is Asset => Boolean(asset));
  const childAssets = assets.filter((candidate) => candidate.generation?.refs.includes(asset.id));
  const viewerClassName = 'image-viewer';
  const changeByClickSide = (event: React.MouseEvent<HTMLImageElement>) => {
    event.stopPropagation();
    if (!node || !hasMultipleVariants) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const direction = event.clientX < rect.left + rect.width / 2 ? -1 : 1;
    onVariant(node.id, direction);
  };
  return (
    <div className={viewerClassName} onClick={onClose}>
      <div className="image-viewer-toolbar" onClick={(event) => event.stopPropagation()}>
        <div className="image-viewer-toolbar-main">
          {isArchived ? (
            <button
              className="secondary"
              disabled={!node}
              onClick={(event) => {
                event.stopPropagation();
                if (node) void onRestoreImage(node.id, asset.id);
              }}
            >
              Unarchive
            </button>
          ) : (
            <button
              className="secondary"
              disabled={!node}
              onClick={(event) => {
                event.stopPropagation();
                if (node) onArchiveImage(node.id, asset.id);
              }}
            >
              Archive
            </button>
          )}
          <strong>{node?.data.displayName ?? assetLabel(asset)}</strong>
          <div className="image-viewer-toolbar-actions">
            {asset.hasPixels && (
              <button className="secondary" disabled={isProjectCover} onClick={() => onSetProjectCover(asset.id)}>
                {isProjectCover ? 'Project cover' : 'Set as cover'}
              </button>
            )}
            {node && hasMultipleVariants && currentVisibleIndex >= 0 && (
              <span>{currentVisibleIndex + 1} / {viewerVariants.length}</span>
            )}
            {asset.hasPixels && (
              <button
                className="image-viewer-info-button secondary"
                disabled={isSavingImage}
                title="Save image to disk"
                aria-label="Save image to disk"
                onClick={async (event) => {
                  event.stopPropagation();
                  setIsSavingImage(true);
                  try {
                    const suggestedName = node?.data.displayName
                      ? visibleDisplayName(node.data.displayName) || assetLabel(asset)
                      : assetLabel(asset);
                    await saveAssetImageToDisk(projectSlug, asset, suggestedName);
                  } catch (err) {
                    if (err instanceof DOMException && err.name === 'AbortError') return;
                    console.error('[photo-web] failed to save image', err);
                    toast.error(formatRequestError(err));
                  } finally {
                    setIsSavingImage(false);
                  }
                }}
              >
                {isSavingImage ? '…' : '↓'}
              </button>
            )}
            {node && (
              <div className="image-viewer-tag-menu">
                <TagControlButton
                  tagIds={asset.tags}
                  projectTags={projectTags}
                  onPartitionedTagsChange={(userTags, characterTags, locationTags) => (
                    onPartitionedAssetTagsChange(node.id, asset.id, userTags, characterTags, locationTags)
                  )}
                  onCreateTag={onCreateTag}
                  className="image-viewer-tag-controls"
                  popoverClassName="split-tag-popover-viewer"
                />
              </div>
            )}
            {node && (
              <button className="image-viewer-info-button secondary" onClick={() => onDetails(node.id)} title="Show details">
                i
              </button>
            )}
            <button className="secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
      <div className="image-viewer-parents-rail" onClick={(event) => event.stopPropagation()} aria-label="Parent images">
        <span>Parents</span>
        {parentAssets.length === 0 && <div className="image-viewer-thumb-placeholder">none</div>}
        {parentAssets.map((parent) => (
          <ImageViewerThumbButton
            key={parent.id}
            asset={parent}
            projectSlug={projectSlug}
            label={assetLabel(parent)}
            onClick={() => onViewAsset(parent.id)}
          />
        ))}
      </div>
      {node && hasMultipleVariants && (
        <button
          className="image-viewer-nav previous"
          onClick={(event) => {
            event.stopPropagation();
            onVariant(node.id, -1);
          }}
          title="Previous variant"
        >
          &lt;
        </button>
      )}
      <img className="image-viewer-main-image" src={imageUrl} alt={node?.data.displayName ?? assetLabel(asset)} onClick={changeByClickSide} />
      {node && hasMultipleVariants && (
        <button
          className="image-viewer-nav next"
          onClick={(event) => {
            event.stopPropagation();
            onVariant(node.id, 1);
          }}
          title="Next variant"
        >
          &gt;
        </button>
      )}
      <div className="image-viewer-children-rail" onClick={(event) => event.stopPropagation()} aria-label="Child images">
        <span>Children</span>
        {childAssets.length === 0 && <div className="image-viewer-thumb-placeholder">none</div>}
        {childAssets.map((child) => (
          <ImageViewerThumbButton
            key={child.id}
            asset={child}
            projectSlug={projectSlug}
            label={assetLabel(child)}
            previewAbove
            onClick={() => onViewAsset(child.id)}
          />
        ))}
      </div>
    </div>
  );
}
