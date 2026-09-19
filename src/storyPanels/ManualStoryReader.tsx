import { useEffect, useRef, useState } from 'react';
import type { StoryPanel } from '../types';
import {
  sortSidebarItems,
  type InsertDraftPayload,
} from './storyPanelSidebar';

function manualSegmentStoryText(panel: StoryPanel) {
  return (panel.storyText || panel.selectedText || panel.visibleText).trim();
}

export function ManualStoryReader({
  panels,
  selectedPanelId,
  focusedPanelId,
  onSelectPanel,
  onFocusPanelChunk,
  onOpenPanelEditor,
  onInsertDraft,
  onEditPanelText,
  isSaving,
}: {
  panels: StoryPanel[];
  selectedPanelId: string | null;
  focusedPanelId: string | null;
  onSelectPanel: (panelId: string) => void;
  onFocusPanelChunk: (panelId: string) => void;
  onOpenPanelEditor: (panelId: string) => void;
  onInsertDraft: (payload: InsertDraftPayload) => Promise<void>;
  onEditPanelText: (panelId: string, text: string) => Promise<void>;
  isSaving: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef<Record<string, HTMLElement | null>>({});
  const [flashingPanelId, setFlashingPanelId] = useState<string | null>(null);
  const [editingPanelId, setEditingPanelId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [composerText, setComposerText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const orderedPanels = sortSidebarItems(panels);

  useEffect(() => {
    if (!focusedPanelId) return;
    const segment = segmentRefs.current[focusedPanelId];
    const scrollRoot = scrollRef.current;
    if (segment && scrollRoot) {
      const segmentTop = segment.offsetTop;
      const targetTop = segmentTop - (scrollRoot.clientHeight / 2) + (segment.offsetHeight / 2);
      scrollRoot.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }
    setFlashingPanelId(focusedPanelId);
    const timeout = window.setTimeout(
      () => setFlashingPanelId((current) => (current === focusedPanelId ? null : current)),
      1400,
    );
    return () => window.clearTimeout(timeout);
  }, [focusedPanelId]);

  const beginEdit = (panel: StoryPanel) => {
    setEditingPanelId(panel.id);
    setEditDraft(manualSegmentStoryText(panel));
  };

  const cancelEdit = () => {
    setEditingPanelId(null);
    setEditDraft('');
  };

  const saveEdit = async () => {
    if (!editingPanelId) return;
    const text = editDraft.trim();
    if (!text) return;
    setIsCreating(true);
    try {
      await onEditPanelText(editingPanelId, text);
      cancelEdit();
    } finally {
      setIsCreating(false);
    }
  };

  const appendPanel = async () => {
    const text = composerText.trim();
    if (!text) return;
    setIsCreating(true);
    try {
      await onInsertDraft({ storyText: text, insertAfterPanelId: null });
      setComposerText('');
    } finally {
      setIsCreating(false);
    }
  };

  const selectSegment = (panelId: string) => {
    onSelectPanel(panelId);
    onFocusPanelChunk(panelId);
  };

  return (
    <div className="story-panels-book-text-wrap story-panels-manual-story-wrap">
      <div ref={scrollRef} className="story-panels-book-text story-panels-manual-story">
        {orderedPanels.length === 0 ? (
          <div className="story-panels-manual-empty">
            <p>No panels yet.</p>
            <p className="muted">
              Write your story one panel at a time. Add your first panel below, or use Add panel in Panels.
            </p>
            <p className="muted story-panels-manual-empty-hint">
              Have source text? Upload book.txt in Story &amp; Style to highlight passages instead.
            </p>
          </div>
        ) : (
          orderedPanels.map((panel) => {
            const isSelected = selectedPanelId === panel.id;
            const isEditing = editingPanelId === panel.id;
            return (
              <section
                key={panel.id}
                ref={(element) => {
                  segmentRefs.current[panel.id] = element;
                }}
                className={[
                  'story-panels-manual-segment',
                  isSelected ? 'is-selected' : '',
                  flashingPanelId === panel.id ? 'is-flashing' : '',
                  isEditing ? 'is-editing' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  if (isEditing) return;
                  selectSegment(panel.id);
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  onOpenPanelEditor(panel.id);
                }}
              >
                <span className="story-panels-manual-segment-label">{panel.id}</span>
                {isEditing ? (
                  <div className="story-panels-manual-segment-editor" onClick={(event) => event.stopPropagation()}>
                    <textarea
                      value={editDraft}
                      rows={4}
                      autoFocus
                      disabled={isSaving || isCreating}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelEdit();
                        }
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault();
                          void saveEdit();
                        }
                      }}
                    />
                    <div className="story-panels-manual-segment-editor-actions">
                      <button type="button" className="secondary" disabled={isSaving || isCreating} onClick={cancelEdit}>
                        Cancel
                      </button>
                      <button type="button" disabled={isSaving || isCreating || !editDraft.trim()} onClick={() => void saveEdit()}>
                        {isCreating ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="story-panels-manual-segment-text">{manualSegmentStoryText(panel) || 'Empty panel'}</p>
                )}
              </section>
            );
          })
        )}
      </div>
      <div className="story-panels-manual-composer">
        <label className="story-panels-manual-composer-label">
          Continue the story
          <textarea
            value={composerText}
            rows={3}
            disabled={isSaving || isCreating}
            placeholder="She opened the door..."
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void appendPanel();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="story-panels-manual-add-button"
          disabled={isSaving || isCreating || !composerText.trim()}
          onClick={() => void appendPanel()}
        >
          {isCreating ? 'Adding…' : 'Add panel'}
        </button>
      </div>
    </div>
  );
}
