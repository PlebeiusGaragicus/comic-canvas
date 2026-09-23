import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDismissOnOutsidePointerDown, useRepositionOnViewportChange } from '../shared/popover';
import { createPortal } from 'react-dom';
import type { TagDefinition } from '../types';
import { SplitTagPopover } from './splitTagPopover';
import {
  characterEntityTags,
  characterEntityTagsOnAsset,
  locationEntityTags,
  locationEntityTagsOnAsset,
  mergeAvailableUserTagsOnly,
  partitionAssetTagIds,
  userTagsOnAsset,
} from './shared';

function TagSummary({
  tagIds,
  projectTags,
}: {
  tagIds: string[];
  projectTags: TagDefinition[];
}) {
  const userResolved = useMemo(() => userTagsOnAsset(tagIds, projectTags), [tagIds, projectTags]);
  const characterResolved = useMemo(() => characterEntityTagsOnAsset(tagIds, projectTags), [tagIds, projectTags]);
  const locationResolved = useMemo(() => locationEntityTagsOnAsset(tagIds, projectTags), [tagIds, projectTags]);
  const hasAny = userResolved.length > 0 || characterResolved.length > 0 || locationResolved.length > 0;

  if (!hasAny) {
    return <span className="node-tag-placeholder">Add tags</span>;
  }

  return (
    <span className="node-tag-summary">
      {userResolved.map((tag) => (
        <span key={tag.id} className="node-tag-pill" style={{ backgroundColor: tag.color }}>
          {tag.name}
        </span>
      ))}
      {characterResolved.map((tag) => (
        <span key={tag.id} className="node-tag-pill entity-tag-pill" style={{ backgroundColor: tag.color }}>
          {tag.name}
        </span>
      ))}
      {locationResolved.map((tag) => (
        <span key={tag.id} className="node-tag-pill entity-tag-pill" style={{ backgroundColor: tag.color }}>
          {tag.name}
        </span>
      ))}
    </span>
  );
}

export function TagControlButton({
  tagIds,
  projectTags,
  onPartitionedTagsChange,
  onCreateTag,
  canonicalAssetId,
  onSetCanonical,
  buttonLabel = 'Tags',
  className = '',
  popoverClassName = '',
  portaled = false,
  portaledAlign = 'left',
}: {
  tagIds: string[];
  projectTags: TagDefinition[];
  onPartitionedTagsChange: (userTags: string[], characterTags: string[], locationTags: string[]) => void;
  onCreateTag: (tag: TagDefinition) => void;
  canonicalAssetId?: string | null;
  onSetCanonical?: (tagId: string, assetId: string | null) => void;
  buttonLabel?: string;
  className?: string;
  popoverClassName?: string;
  portaled?: boolean;
  portaledAlign?: 'left' | 'right';
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const [isPopoverPositioned, setIsPopoverPositioned] = useState(false);

  const partitioned = useMemo(() => partitionAssetTagIds(tagIds, projectTags), [tagIds, projectTags]);
  const userAvailable = useMemo(() => {
    const base = mergeAvailableUserTagsOnly(projectTags, []);
    const byId = new Map(base.map((tag) => [tag.id, tag]));
    partitioned.user.forEach((tagId) => {
      if (!byId.has(tagId)) byId.set(tagId, { id: tagId, name: tagId, color: '#64748b' });
    });
    return Array.from(byId.values()).sort((first, second) => first.name.localeCompare(second.name));
  }, [partitioned.user, projectTags]);
  const characterAvailable = useMemo(() => characterEntityTags(projectTags), [projectTags]);
  const locationAvailable = useMemo(() => locationEntityTags(projectTags), [projectTags]);
  const totalCount = partitioned.user.length + partitioned.character.length + partitioned.location.length;

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const check = () => setIsTruncated(row.scrollWidth > row.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(row);
    return () => observer.disconnect();
  }, [tagIds, projectTags]);

  const updatePopoverPosition = useCallback(() => {
    const anchor = rowRef.current;
    const popover = popoverRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const popoverHeight = popover?.offsetHeight ?? 280;
    const popoverWidth = popover?.offsetWidth ?? 300;
    const gap = 6;
    const padding = 8;
    let top = rect.bottom + gap;
    if (top + popoverHeight > window.innerHeight - padding) {
      top = Math.max(padding, rect.top - popoverHeight - gap);
    }
    let left = portaledAlign === 'right' ? rect.right - popoverWidth : rect.left;
    if (left + popoverWidth > window.innerWidth - padding) {
      left = window.innerWidth - popoverWidth - padding;
    }
    left = Math.max(padding, left);
    setPopoverPosition({ top, left });
    setIsPopoverPositioned(true);
  }, [portaledAlign]);

  useLayoutEffect(() => {
    if (!isOpen || !portaled) {
      setIsPopoverPositioned(false);
      return;
    }
    updatePopoverPosition();
  }, [isOpen, portaled, tagIds, updatePopoverPosition]);

  useEffect(() => {
    if (!isOpen || !portaled || !popoverRef.current) return;
    const observer = new ResizeObserver(() => updatePopoverPosition());
    observer.observe(popoverRef.current);
    return () => observer.disconnect();
  }, [isOpen, portaled, updatePopoverPosition]);

  useRepositionOnViewportChange(isOpen && portaled, updatePopoverPosition);

  useDismissOnOutsidePointerDown(isOpen, [menuRef, popoverRef], useCallback(() => setIsOpen(false), []));

  const applyEntityTags = (entityTags: string[]) => {
    const characterTags = entityTags.filter((tagId) => characterAvailable.some((tag) => tag.id === tagId));
    const locationTags = entityTags.filter((tagId) => locationAvailable.some((tag) => tag.id === tagId));
    onPartitionedTagsChange(partitioned.user, characterTags, locationTags);
  };

  return (
    <div ref={menuRef} className={`tag-control-button ${isOpen ? 'is-open' : ''} ${className}`.trim()}>
      <button
        ref={rowRef}
        type="button"
        className={`node-tag-row tag-control-trigger ${isTruncated ? 'is-truncated' : ''} ${totalCount ? 'has-tags' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
        aria-expanded={isOpen}
        aria-label={totalCount ? `Edit tags (${totalCount})` : 'Add tags'}
      >
        <span className="node-tag-label">{buttonLabel}</span>
        <TagSummary tagIds={tagIds} projectTags={projectTags} />
      </button>
      {isOpen && (() => {
        const popover = (
          <SplitTagPopover
            mode="assign"
            className={`${popoverClassName}${portaled ? ' is-portaled' : ''}`.trim()}
            style={portaled ? {
              top: popoverPosition.top,
              left: popoverPosition.left,
              visibility: isPopoverPositioned ? 'visible' : 'hidden',
            } : undefined}
            userSelectedTags={partitioned.user}
            userAvailableTags={userAvailable}
            onUserTagsChange={(userTags) => onPartitionedTagsChange(userTags, partitioned.character, partitioned.location)}
            onCreateTag={onCreateTag}
            entitySelectedTags={partitioned.entity}
            characterAvailableTags={characterAvailable}
            locationAvailableTags={locationAvailable}
            onEntityTagsChange={applyEntityTags}
            canonicalAssetId={canonicalAssetId}
            onSetCanonical={onSetCanonical}
          />
        );
        if (portaled) {
          return createPortal(
            <div ref={popoverRef} className="split-tag-popover-portal-host">
              {popover}
            </div>,
            document.body,
          );
        }
        return popover;
      })()}
    </div>
  );
}

export function NodeTagButton({
  tagIds,
  projectTags,
  onPartitionedTagsChange,
  onCreateTag,
  canonicalAssetId,
  onSetCanonical,
}: {
  tagIds: string[];
  projectTags: TagDefinition[];
  onPartitionedTagsChange: (userTags: string[], characterTags: string[], locationTags: string[]) => void;
  onCreateTag: (tag: TagDefinition) => void;
  canonicalAssetId?: string | null;
  onSetCanonical?: (tagId: string, assetId: string | null) => void;
}) {
  return (
    <div
      className="node-tag-menu nodrag nopan"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <TagControlButton
        tagIds={tagIds}
        projectTags={projectTags}
        onPartitionedTagsChange={onPartitionedTagsChange}
        onCreateTag={onCreateTag}
        canonicalAssetId={canonicalAssetId}
        onSetCanonical={onSetCanonical}
        buttonLabel="tags:"
        popoverClassName="split-tag-popover-node"
        portaled
      />
    </div>
  );
}

