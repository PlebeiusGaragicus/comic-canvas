import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDismissOnOutsidePointerDown, useRepositionOnViewportChange } from '../shared/popover';
import { createPortal } from 'react-dom';
import type { EntityKind, TagDefinition } from '../types';
import { isValidTagName, normalizeTagName, tagColorOptions, tagColors } from './shared';

type TagEditorMode = 'assign' | 'filter';

export function TagColorPickerPopover({
  selectedColor,
  onSelect,
  onClose,
  anchorRef,
}: {
  selectedColor: string;
  onSelect: (color: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const popoverHeight = popover?.offsetHeight ?? 285;
    const popoverWidth = popover?.offsetWidth ?? 168;
    const gap = 6;
    const padding = 8;
    let top = rect.bottom + gap;
    if (top + popoverHeight > window.innerHeight - padding) {
      top = Math.max(padding, rect.top - popoverHeight - gap);
    }
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - padding) {
      left = window.innerWidth - popoverWidth - padding;
    }
    left = Math.max(padding, left);
    setPosition({ top, left });
    setIsPositioned(true);
  }, [anchorRef]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, selectedColor]);

  useRepositionOnViewportChange(true, updatePosition);

  useDismissOnOutsidePointerDown(true, [popoverRef, anchorRef], onClose);

  return createPortal(
    <div
      ref={popoverRef}
      className="tag-color-picker-popover"
      style={{ top: position.top, left: position.left, visibility: isPositioned ? 'visible' : 'hidden' }}
      onClick={(event) => event.stopPropagation()}
    >
      {tagColorOptions.map(({ color, label }) => (
        <button
          key={color}
          type="button"
          className={selectedColor === color ? 'is-active' : ''}
          onClick={() => {
            onSelect(color);
            onClose();
          }}
        >
          <span className="tag-color-dot" style={{ backgroundColor: color }} />
          <span>{label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

export function EntityTagSection({
  kind,
  label,
  selectedTags,
  availableTags,
  tagCounts = {},
  onChange,
  canonicalAssetId,
  onSetCanonical,
}: {
  kind: EntityKind;
  label: string;
  selectedTags: string[];
  availableTags: TagDefinition[];
  tagCounts?: Record<string, number>;
  onChange: (tags: string[]) => void;
  /** When set (with onSetCanonical), assigned tags offer "★ make canonical for X" against this asset. */
  canonicalAssetId?: string | null;
  onSetCanonical?: (tagId: string, assetId: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const selected = new Set(selectedTags);
  const availableById = useMemo(() => new Map(availableTags.map((tag) => [tag.id, tag])), [availableTags]);
  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return availableTags
      .filter((tag) => tag.entityKind === kind)
      .filter((tag) => !needle || tag.name.toLowerCase().includes(needle) || tag.id.includes(needle))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [availableTags, kind, query]);

  const toggleTag = (tagId: string) => {
    onChange(selected.has(tagId) ? selectedTags.filter((item) => item !== tagId) : [...selectedTags, tagId]);
    setQuery('');
  };

  const selectedInSection = selectedTags.filter((tagId) => availableById.get(tagId)?.entityKind === kind);

  return (
    <div className="entity-tag-section">
      <div className="entity-tag-section-heading">{label}</div>
      {selectedInSection.length > 0 && (
        <div className="tag-editor-input tag-editor-input-compact">
          {selectedInSection.map((tagId) => {
            const tag = availableById.get(tagId);
            const canStarTag = Boolean(canonicalAssetId && onSetCanonical);
            const isCanonical = Boolean(canonicalAssetId && tag?.canonicalAssetId === canonicalAssetId);
            return (
              <span key={tagId} className="tag-chip-group">
                <button
                  type="button"
                  className="tag-chip"
                  onClick={() => toggleTag(tagId)}
                  style={{ backgroundColor: tag?.color ?? '#64748b' }}
                >
                  {tag?.name ?? tagId}
                </button>
                {canStarTag && (
                  <button
                    type="button"
                    className={`tag-canonical-star ${isCanonical ? 'is-canonical' : ''}`}
                    title={isCanonical
                      ? `Canonical image for ${tag?.name ?? tagId} — click to clear`
                      : `Make this image canonical for ${tag?.name ?? tagId}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetCanonical?.(tagId, isCanonical ? null : canonicalAssetId ?? null);
                    }}
                  >
                    {isCanonical ? '★' : '☆'}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
      <input
        className="entity-tag-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && suggestions[0]) {
            event.preventDefault();
            toggleTag(suggestions[0].id);
          }
        }}
        placeholder={`Search ${kind === 'character' ? 'characters' : 'locations'}...`}
      />
      <div className="tag-suggestion-list entity-tag-section-list">
        {suggestions.map((tag) => (
          <button
            key={tag.id}
            className={`entity-tag-suggestion ${selected.has(tag.id) ? 'is-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleTag(tag.id);
            }}
          >
            <span className="tag-color-dot" style={{ backgroundColor: tag.color }} />
            <span className="tag-suggestion-name">{tag.name}</span>
            {tagCounts[tag.id] !== undefined && <span className="tag-suggestion-count">({tagCounts[tag.id]})</span>}
          </button>
        ))}
        {!suggestions.length && <p className="muted entity-tag-empty">No matching {kind === 'character' ? 'characters' : 'locations'}.</p>}
      </div>
    </div>
  );
}

export function EntityTagPopover({
  kind,
  title,
  selectedTags,
  availableTags,
  onChange,
}: {
  kind: EntityKind;
  title: string;
  selectedTags: string[];
  availableTags: TagDefinition[];
  onChange: (tags: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const selected = new Set(selectedTags);
  const availableById = useMemo(() => new Map(availableTags.map((tag) => [tag.id, tag])), [availableTags]);
  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return availableTags
      .filter((tag) => tag.entityKind === kind)
      .filter((tag) => !needle || tag.name.toLowerCase().includes(needle) || tag.id.includes(needle))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [availableTags, kind, query]);

  const toggleTag = (tagId: string) => {
    onChange(selected.has(tagId) ? selectedTags.filter((item) => item !== tagId) : [...selectedTags, tagId]);
    setQuery('');
  };

  const stopFlowPointer = (event: React.MouseEvent | React.PointerEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="tag-editor-popover entity-tag-editor-popover"
      onPointerDown={stopFlowPointer}
      onMouseDown={stopFlowPointer}
      onClick={stopFlowPointer}
    >
      <h3>{title}</h3>
      {selectedTags.length > 0 && (
        <div className="tag-editor-input">
          {selectedTags.map((tagId) => {
            const tag = availableById.get(tagId);
            return (
              <button
                key={tagId}
                type="button"
                className="tag-chip"
                onClick={() => toggleTag(tagId)}
                style={{ backgroundColor: tag?.color ?? '#64748b' }}
              >
                {tag?.name ?? tagId}
              </button>
            );
          })}
        </div>
      )}
      <input
        className="entity-tag-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && suggestions[0]) {
            event.preventDefault();
            toggleTag(suggestions[0].id);
          }
        }}
        placeholder={`Search ${kind === 'character' ? 'characters' : 'locations'}...`}
        autoFocus
      />
      <div className="tag-suggestion-list">
        {suggestions.map((tag) => (
          <button
            key={tag.id}
            className={`entity-tag-suggestion ${selected.has(tag.id) ? 'is-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleTag(tag.id);
            }}
          >
            <span className="tag-color-dot" style={{ backgroundColor: tag.color }} />
            <span className="tag-suggestion-name">{tag.name}</span>
          </button>
        ))}
        {!suggestions.length && <p className="muted entity-tag-empty">No matching {kind === 'character' ? 'characters' : 'locations'}.</p>}
      </div>
    </div>
  );
}

export function UserTagColumn({
  mode,
  selectedTags,
  availableTags,
  tagCounts = {},
  onChange,
  onCreateTag,
  autoFocus = false,
}: {
  mode: TagEditorMode;
  selectedTags: string[];
  availableTags: TagDefinition[];
  tagCounts?: Record<string, number>;
  onChange: (tags: string[]) => void;
  onCreateTag?: (tag: TagDefinition) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const normalizedQuery = normalizeTagName(query);
  const selected = new Set(selectedTags);
  const availableById = useMemo(() => new Map(availableTags.map((tag) => [tag.id, tag])), [availableTags]);
  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return availableTags
      .filter((tag) => !needle || tag.name.toLowerCase().includes(needle) || tag.id.includes(normalizedQuery))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [availableTags, normalizedQuery, query]);
  const canShowCreate = mode === 'assign' && normalizedQuery && isValidTagName(normalizedQuery) && !availableById.has(normalizedQuery);
  const canCreate = Boolean(canShowCreate && selectedColor);

  const toggleTag = (tagId: string) => {
    onChange(selected.has(tagId) ? selectedTags.filter((item) => item !== tagId) : [...selectedTags, tagId]);
    setQuery('');
  };

  const createTag = () => {
    if (!canCreate || !onCreateTag) return;
    if (!selectedColor) return;
    const displayName = query.trim() || normalizedQuery;
    const tag = { id: normalizedQuery, name: displayName, color: selectedColor };
    onCreateTag(tag);
    onChange([...selectedTags, tag.id]);
    setQuery('');
    setSelectedColor(null);
  };

  const removeTag = (tagId: string) => {
    onChange(selectedTags.filter((item) => item !== tagId));
  };

  return (
    <>
      <div className="tag-editor-input">
        {selectedTags.map((tagId) => {
          const tag = availableById.get(tagId);
          return (
            <button
              key={tagId}
              type="button"
              className="tag-chip"
              onClick={() => removeTag(tagId)}
              style={{ backgroundColor: tag?.color ?? '#64748b' }}
            >
              {tag?.name ?? tagId}
            </button>
          );
        })}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              const exact = availableById.get(normalizedQuery);
              if (exact) toggleTag(exact.id);
              else createTag();
            }
            if (event.key === 'Backspace' && !query && selectedTags.length) {
              removeTag(selectedTags[selectedTags.length - 1]);
            }
          }}
          placeholder={selectedTags.length ? '' : mode === 'assign' ? 'Add tag' : 'Filter tags'}
          autoFocus={autoFocus}
        />
      </div>
      <div className="tag-suggestion-list">
        {mode === 'filter' && (
          <button className="tag-clear-row" disabled={selectedTags.length === 0} onClick={() => onChange([])}>
            Clear
          </button>
        )}
        {suggestions.map((tag) => (
          <button
            key={tag.id}
            className={selected.has(tag.id) ? 'is-active' : ''}
            onClick={(event) => {
              event.stopPropagation();
              toggleTag(tag.id);
            }}
          >
            <span className="tag-color-dot" style={{ backgroundColor: tag.color }} />
            <span className="tag-suggestion-name">{tag.name}</span>
            {tagCounts[tag.id] !== undefined && <span className="tag-suggestion-count">({tagCounts[tag.id]})</span>}
          </button>
        ))}
        {canShowCreate && (
          <>
            <button className="tag-create-row" onClick={createTag} disabled={!canCreate}>
              <span className="tag-color-dot empty" />
              Create new tag "{query.trim() || normalizedQuery}"
            </button>
            <div className="tag-color-row">
              {tagColors.map((color) => (
                <button
                  key={color}
                  className={selectedColor === color ? 'is-active' : ''}
                  onClick={() => setSelectedColor(color)}
                  aria-label={`Use ${color}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function TagEditorPopover({
  mode,
  title,
  selectedTags,
  availableTags,
  tagCounts = {},
  onChange,
  onCreateTag,
}: {
  mode: TagEditorMode;
  title: string;
  selectedTags: string[];
  availableTags: TagDefinition[];
  tagCounts?: Record<string, number>;
  onChange: (tags: string[]) => void;
  onCreateTag?: (tag: TagDefinition) => void;
}) {
  const stopFlowPointer = (event: React.MouseEvent | React.PointerEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="tag-editor-popover"
      onPointerDown={stopFlowPointer}
      onMouseDown={stopFlowPointer}
      onClick={stopFlowPointer}
    >
      <h3>{title}</h3>
      <UserTagColumn
        mode={mode}
        selectedTags={selectedTags}
        availableTags={availableTags}
        tagCounts={tagCounts}
        onChange={onChange}
        onCreateTag={onCreateTag}
        autoFocus
      />
    </div>
  );
}
