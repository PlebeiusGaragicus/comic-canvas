import { useRef } from 'react';
import { SplitTagPopover } from './splitTagPopover';
import { useDismissOnOutsidePointerDown } from '../shared/popover';
import type { TagDefinition } from '../types';

export function FloatingTagsMenu({
  userAvailableTags,
  characterAvailableTags,
  locationAvailableTags,
  userTagCounts,
  entityTagCounts,
  activeUserTags,
  activeEntityTags,
  showArchived,
  isOpen,
  onToggleOpen,
  onClose,
  onUserTagsChange,
  onEntityTagsChange,
  onShowArchivedChange,
}: {
  userAvailableTags: TagDefinition[];
  characterAvailableTags: TagDefinition[];
  locationAvailableTags: TagDefinition[];
  userTagCounts: Record<string, number>;
  entityTagCounts: Record<string, number>;
  activeUserTags: string[];
  activeEntityTags: string[];
  showArchived: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  onUserTagsChange: (tags: string[]) => void;
  onEntityTagsChange: (tags: string[]) => void;
  onShowArchivedChange: (value: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const activeCount = activeUserTags.length + activeEntityTags.length;

  useDismissOnOutsidePointerDown(isOpen, [menuRef], onClose);

  return (
    <div ref={menuRef} className="project-top-bar-tags-menu">
      <button
        type="button"
        className={`project-top-bar-tags-trigger ${activeCount ? 'is-active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={onToggleOpen}
      >
        <span className="project-top-bar-tags-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path
              d="M2.5 8.2 7.8 2.9a1.5 1.5 0 0 1 2.1 0l3.6 3.6a1.5 1.5 0 0 1 0 2.1L8.3 13.8a1.5 1.5 0 0 1-2.1 0L2.5 10.1a1.5 1.5 0 0 1 0-2.1Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <circle cx="5.4" cy="5.4" r="0.9" fill="currentColor" />
          </svg>
        </span>
        <span className="project-top-bar-tags-label">Tags</span>
        {activeCount > 0 && (
          <span className="project-top-bar-tags-count">{activeCount}</span>
        )}
        <span className="project-top-bar-nav-chevron" aria-hidden="true">▾</span>
      </button>
      {isOpen && (
        <SplitTagPopover
          mode="filter"
          className="project-top-bar-tags-popover"
          userSelectedTags={activeUserTags}
          userAvailableTags={userAvailableTags}
          userTagCounts={userTagCounts}
          onUserTagsChange={onUserTagsChange}
          entitySelectedTags={activeEntityTags}
          characterAvailableTags={characterAvailableTags}
          locationAvailableTags={locationAvailableTags}
          entityTagCounts={entityTagCounts}
          onEntityTagsChange={onEntityTagsChange}
          footer={(
            <button
              type="button"
              className={showArchived ? 'is-active' : ''}
              onClick={() => onShowArchivedChange(!showArchived)}
            >
              {showArchived ? 'Show active' : 'Show archived'}
            </button>
          )}
        />
      )}
    </div>
  );
}
