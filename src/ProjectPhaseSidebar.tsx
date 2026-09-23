import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { TagColorPickerPopover } from './canvas/tagEditor';
import { PhaseIcon } from './PhaseIcon';
import { workspaceNavItems, type ProjectPhase } from './projectNavigation';
import { ConfirmDialog, Modal } from './ui';
import type { Project, TagDefinition } from './types';

function TrashIcon() {
  return (
    <svg className="tag-organizer-trash-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h10" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M6 4.5V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M5 4.5l.5 8a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9l.5-8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M7 7v4M9 7v4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function TagOrganizerRow({
  tag,
  onUpdateTag,
  onRequestDelete,
}: {
  tag: TagDefinition;
  onUpdateTag: (tagId: string, patch: Partial<Pick<TagDefinition, 'name' | 'color'>>) => void;
  onRequestDelete: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const colorAnchorRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setName(tag.name);
  }, [tag.name]);
  useEffect(() => {
    if (!isEditingName) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [isEditingName]);

  const commitName = () => {
    const trimmed = name.trim() || tag.id;
    setName(trimmed);
    setIsEditingName(false);
    if (trimmed !== tag.name) onUpdateTag(tag.id, { name: trimmed });
  };

  return (
    <div className="tag-organizer-row">
      <div className="tag-organizer-color-anchor">
        <button
          ref={colorAnchorRef}
          type="button"
          className="tag-color-dot-button"
          aria-label={`Change color for ${tag.name}`}
          aria-expanded={isColorPickerOpen}
          onClick={() => setIsColorPickerOpen((current) => !current)}
        >
          <span className="tag-color-dot" style={{ backgroundColor: tag.color }} />
        </button>
        {isColorPickerOpen && (
          <TagColorPickerPopover
            anchorRef={colorAnchorRef}
            selectedColor={tag.color}
            onSelect={(color) => onUpdateTag(tag.id, { color })}
            onClose={() => setIsColorPickerOpen(false)}
          />
        )}
      </div>
      {isEditingName ? (
        <input
          ref={nameInputRef}
          className="tag-organizer-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitName();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setName(tag.name);
              setIsEditingName(false);
            }
          }}
        />
      ) : (
        <span
          className="tag-organizer-name-display"
          onDoubleClick={() => setIsEditingName(true)}
          title="Double-click to rename"
        >
          {tag.name}
        </span>
      )}
      <button
        type="button"
        className="tag-organizer-delete"
        onClick={onRequestDelete}
        aria-label={`Delete ${tag.name}`}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

export function ProjectPhaseSidebar({
  project,
  projectSlug,
  activePhase,
  projectTags,
  tagAssetCounts,
  error,
  isCollapsed,
  onToggleCollapsed: _onToggleCollapsed,
  onBack,
  onDeleteProject,
  onResetStoryPanelLayout,
  onResetStoryPanelChunks,
  onResetCharacterData,
  onExportAssets,
  onExportPdf,
  exportingPdf = false,
  onDeleteTag,
  onUpdateTag,
  onPhaseChange,
}: {
  project: Project | undefined;
  projectSlug: string;
  activePhase: ProjectPhase;
  projectTags: TagDefinition[];
  tagAssetCounts: Record<string, number>;
  error: string | null;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onBack: () => void;
  onDeleteProject: () => Promise<void>;
  onResetStoryPanelLayout: () => Promise<void>;
  onResetStoryPanelChunks: () => Promise<void>;
  onResetCharacterData: () => Promise<void>;
  onExportAssets: () => Promise<void>;
  onExportPdf: () => void;
  exportingPdf?: boolean;
  onDeleteTag: (tagId: string) => Promise<void>;
  onUpdateTag: (tagId: string, patch: Partial<Pick<TagDefinition, 'name' | 'color'>>) => void;
  onPhaseChange: (phase: ProjectPhase) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState(false);
  type DeleteAction = 'layout' | 'chunks' | 'characters' | 'project';
  const [deleteAction, setDeleteAction] = useState<DeleteAction | null>(null);
  const [pendingDeleteAction, setPendingDeleteAction] = useState<DeleteAction | null>(null);
  const deleting = deleteAction !== null;
  const [exportingAssets, setExportingAssets] = useState(false);
  const [organizingTags, setOrganizingTags] = useState(false);
  const [pendingTagDelete, setPendingTagDelete] = useState<TagDefinition | null>(null);
  const [deletingTag, setDeletingTag] = useState(false);
  const deleteActionCopy: Record<DeleteAction, { title: string; body: string; confirm: string; busy: string }> = {
    characters: {
      title: 'Delete character data?',
      body: 'This wipes character list files, character sheets, and entity tags so you can re-run List and Extract.',
      confirm: 'Delete character data',
      busy: 'Deleting character data...',
    },
    layout: {
      title: 'Delete layout?',
      body: 'This clears placed panels and layout state. Reading panels remain available to place again.',
      confirm: 'Delete layout',
      busy: 'Resetting layout...',
    },
    chunks: {
      title: 'Delete all chunks?',
      body: 'This clears all story panels and layout data. Canvas assets, tags, and adaptation files are kept.',
      confirm: 'Delete all chunks',
      busy: 'Clearing chunks...',
    },
    project: {
      title: 'Delete entire project?',
      body: 'This permanently deletes the project and returns you to the project list.',
      confirm: 'Delete entire project',
      busy: 'Deleting...',
    },
  };
  const runDeleteAction = async (action: DeleteAction) => {
    setDeleteAction(action);
    try {
      if (action === 'characters') await onResetCharacterData();
      if (action === 'layout') await onResetStoryPanelLayout();
      if (action === 'chunks') await onResetStoryPanelChunks();
      if (action === 'project') await onDeleteProject();
      setPendingDeleteAction(null);
      setPendingDelete(false);
    } finally {
      setDeleteAction(null);
    }
  };
  if (isCollapsed) {
    return null;
  }
  return (
    <div className="project-phase-sidebar-shell">
      <aside className="project-phase-sidebar">
      <div className="phase-sidebar-header">
        <button className="project-back-button" onClick={onBack} aria-label="Back to projects">
          <span className="project-back-arrow" aria-hidden="true">←</span>
          <span className="project-back-tooltip" role="tooltip">Back to projects</span>
        </button>
        <strong className="phase-sidebar-project-name" title={project?.name ?? projectSlug}>
          {project?.name ?? projectSlug}
        </strong>
      </div>
      {error && <p className="error error-banner">{error}</p>}
      <nav className="phase-nav" aria-label="Workspace">
        {workspaceNavItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={clsx('phase-nav-item', activePhase === item.id && 'is-selected')}
            aria-current={activePhase === item.id ? 'page' : undefined}
            onClick={() => onPhaseChange(item.id)}
          >
            <span className="phase-number" aria-hidden="true"><PhaseIcon phase={item.id} /></span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </nav>
      <div className="phase-sidebar-footer">
        <button className="secondary" disabled={deleting || exportingAssets} onClick={() => setOrganizingTags(true)}>
          Your tags
        </button>
        <button
          className="secondary"
          disabled={exportingPdf || exportingAssets || deleting}
          onClick={onExportPdf}
        >
          {exportingPdf ? 'Exporting...' : 'Export PDF'}
        </button>
        <button
          className="secondary"
          disabled={exportingAssets || deleting || exportingPdf}
          onClick={async () => {
            setExportingAssets(true);
            try {
              await onExportAssets();
            } finally {
              setExportingAssets(false);
            }
          }}
        >
          {exportingAssets ? 'Exporting...' : 'Export assets'}
        </button>
        <button className="danger-ghost" disabled={deleting || exportingAssets || exportingPdf} onClick={() => setPendingDelete(true)}>
          Delete project
        </button>
      </div>
      {organizingTags && (
        <Modal title="Your tags" onClose={() => !pendingTagDelete && setOrganizingTags(false)}>
          <div className="tag-organizer-list">
            {projectTags.length === 0 ? (
              <p className="muted">No custom tags yet.</p>
            ) : projectTags.map((tag) => (
              <TagOrganizerRow
                key={tag.id}
                tag={tag}
                onUpdateTag={onUpdateTag}
                onRequestDelete={() => setPendingTagDelete(tag)}
              />
            ))}
          </div>
          <p className="muted tag-organizer-footer-note">Story entity tags are created from the Characters hub.</p>
        </Modal>
      )}
      {pendingTagDelete && (
        <ConfirmDialog
          title="Delete tag?"
          body={(
            <>
              <p>
                Remove tag <strong>{pendingTagDelete.name}</strong> from the project?
              </p>
              <p>
                {(() => {
                  const imageCount = tagAssetCounts[pendingTagDelete.id] ?? 0;
                  if (imageCount === 0) return 'This tag is not assigned to any images.';
                  if (imageCount === 1) return 'This removes it from 1 image.';
                  return `This removes it from ${imageCount} images.`;
                })()}
              </p>
            </>
          )}
          confirmLabel="Delete tag"
          tone="danger"
          busy={deletingTag}
          busyLabel="Deleting..."
          onConfirm={async () => {
            setDeletingTag(true);
            try {
              await onDeleteTag(pendingTagDelete.id);
              setPendingTagDelete(null);
            } finally {
              setDeletingTag(false);
            }
          }}
          onCancel={() => setPendingTagDelete(null)}
        />
      )}
      {pendingDelete && (
        <Modal title="Delete or reset?" onClose={() => !deleting && setPendingDelete(false)} dialogClassName="project-delete-dialog" hideHeader>
            <h2>Delete or reset?</h2>
            <p>
              Choose what to remove from <strong>{project?.name ?? projectSlug}</strong>. Canvas assets, tags, and
              adaptation are kept unless you delete the entire project.
            </p>
            <p className="muted">
              Use layout or chunk reset to recover projects whose Story or Layout views fail after schema changes.
              Delete character data to wipe list files, character sheets, and entity tags so you can re-run List and Extract.
            </p>
            <div className="row project-delete-actions">
              <button
                className="danger"
                disabled={deleting}
                onClick={() => setPendingDeleteAction('characters')}
              >
                {deleteAction === 'characters' ? 'Deleting character data...' : 'Delete character data'}
              </button>
              <button
                className="danger"
                disabled={deleting}
                onClick={() => setPendingDeleteAction('layout')}
              >
                {deleteAction === 'layout' ? 'Resetting layout...' : 'Delete layout'}
              </button>
              <button
                className="danger"
                disabled={deleting}
                onClick={() => setPendingDeleteAction('chunks')}
              >
                {deleteAction === 'chunks' ? 'Clearing chunks...' : 'Delete all chunks'}
              </button>
              <button
                className="danger"
                disabled={deleting}
                onClick={() => setPendingDeleteAction('project')}
              >
                {deleteAction === 'project' ? 'Deleting...' : 'Delete entire project'}
              </button>
              <button className="secondary" disabled={deleting} onClick={() => setPendingDelete(false)}>Cancel</button>
            </div>
        </Modal>
      )}
      {pendingDeleteAction && (
        <ConfirmDialog
          title={deleteActionCopy[pendingDeleteAction].title}
          body={(
            <>
              <p>{deleteActionCopy[pendingDeleteAction].body}</p>
              <p className="muted">This action cannot be undone automatically.</p>
            </>
          )}
          confirmLabel={deleteActionCopy[pendingDeleteAction].confirm}
          tone="danger"
          busy={deleting}
          busyLabel={deleteActionCopy[pendingDeleteAction].busy}
          onConfirm={() => void runDeleteAction(pendingDeleteAction)}
          onCancel={() => setPendingDeleteAction(null)}
        />
      )}
      </aside>
    </div>
  );
}
