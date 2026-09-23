import type { CSSProperties, ReactNode } from 'react';
import type { TagDefinition } from '../types';
import { EntityTagSection, UserTagColumn } from './tagEditor';

export type SplitTagPopoverMode = 'assign' | 'filter';

export function SplitTagPopover({
  mode,
  userSelectedTags,
  userAvailableTags,
  userTagCounts = {},
  onUserTagsChange,
  onCreateTag,
  entitySelectedTags,
  characterAvailableTags,
  locationAvailableTags,
  entityTagCounts = {},
  onEntityTagsChange,
  canonicalAssetId,
  onSetCanonical,
  footer,
  className = '',
  style,
}: {
  mode: SplitTagPopoverMode;
  userSelectedTags: string[];
  userAvailableTags: TagDefinition[];
  userTagCounts?: Record<string, number>;
  onUserTagsChange: (tags: string[]) => void;
  onCreateTag?: (tag: TagDefinition) => void;
  entitySelectedTags: string[];
  characterAvailableTags: TagDefinition[];
  locationAvailableTags: TagDefinition[];
  entityTagCounts?: Record<string, number>;
  onEntityTagsChange: (tags: string[]) => void;
  /** Assign mode against one asset: assigned entity tags offer ★ make-canonical. */
  canonicalAssetId?: string | null;
  onSetCanonical?: (tagId: string, assetId: string | null) => void;
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const stopFlowPointer = (event: React.MouseEvent | React.PointerEvent) => {
    event.stopPropagation();
  };

  const clearAll = () => {
    onUserTagsChange([]);
    onEntityTagsChange([]);
  };

  const hasSelection = userSelectedTags.length > 0 || entitySelectedTags.length > 0;

  return (
    <div
      className={`split-tag-popover ${className}`.trim()}
      style={style}
      onPointerDown={stopFlowPointer}
      onMouseDown={stopFlowPointer}
      onClick={stopFlowPointer}
    >
      {mode === 'filter' && (
        <div className="split-tag-popover-toolbar">
          <span className="split-tag-popover-title">Filter canvas</span>
          <button type="button" className="tag-clear-row" disabled={!hasSelection} onClick={clearAll}>
            Clear all
          </button>
        </div>
      )}
      <div className="split-tag-popover-columns">
        <div className="split-tag-column split-tag-column-user">
          <h4 className="split-tag-column-heading">Your tags</h4>
          <UserTagColumn
            mode={mode}
            selectedTags={userSelectedTags}
            availableTags={userAvailableTags}
            tagCounts={userTagCounts}
            onChange={onUserTagsChange}
            onCreateTag={onCreateTag}
          />
        </div>
        <div className="split-tag-column split-tag-column-entity">
          <h4 className="split-tag-column-heading">Story entities</h4>
          <p className="split-tag-column-note muted">Managed in Characters / Locations.</p>
          <EntityTagSection
            kind="character"
            label="Characters"
            selectedTags={entitySelectedTags}
            availableTags={characterAvailableTags}
            tagCounts={entityTagCounts}
            onChange={onEntityTagsChange}
            canonicalAssetId={canonicalAssetId}
            onSetCanonical={onSetCanonical}
          />
          <EntityTagSection
            kind="location"
            label="Locations"
            selectedTags={entitySelectedTags}
            availableTags={locationAvailableTags}
            tagCounts={entityTagCounts}
            onChange={onEntityTagsChange}
            canonicalAssetId={canonicalAssetId}
            onSetCanonical={onSetCanonical}
          />
        </div>
      </div>
      {footer && <div className="split-tag-popover-footer">{footer}</div>}
    </div>
  );
}
