import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { formatRequestError } from '../formatError';
import { menuKeyboardHandlers, useDismissOnOutsidePointerDown } from '../shared/popover';
import type { StoryPanel, StoryPanelCaption, StoryPanelImagePrompt, StoryPanelPage, StoryPanelPatchPayload } from '../types';
import { defaultCaptionTextStyle } from './captionPanelStyle';
import { panelIsPlacedOnLayout } from './panelPlacement';
import { storyPagePlacementLabel } from './pageNumbers';
import {
  filterSidebarItems,
  manualPanelNumber,
  SIDEBAR_FILTER_OPTIONS,
  sidebarItemLabel,
  sidebarItemPrimaryText,
  sidebarItemSecondaryText,
  sortSidebarItems,
  type InsertDraftPayload,
  type SidebarFilter,
} from './storyPanelSidebar';
import { isBookLinked, isPanel } from './panelModel';

function compactText(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function panelPreviewText(panel: StoryPanel, primaryText: string) {
  if (panel.sourceKind !== 'panel') return primaryText;
  const preview = (panel.storyText.trim() || panel.selectedText.trim()).trim();
  if (!preview || ['Image panel', 'Text panel', 'Text block'].includes(preview)) return '';
  return preview;
}

function captionPreviewTexts(panel: StoryPanel) {
  return (panel.captions ?? [])
    .map((caption) => caption.visibleText.trim())
    .filter(Boolean);
}

function captionTextareaRows(value: string) {
  const lineCount = Math.max(1, value.split(/\n/).length);
  return Math.min(12, lineCount);
}

// Image prompts are long single-paragraph prose, so size by estimated wrapped
// lines (~90 chars per line at the modal's width), not just newline count.
function promptTextareaRows(value: string) {
  const wrappedLines = value
    .split(/\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 90)), 0);
  return Math.min(14, Math.max(3, wrappedLines));
}

function usefulStoryText(panel: StoryPanel) {
  const text = (panel.storyText.trim() || panel.selectedText.trim()).trim();
  return ['Image panel', 'Text panel', 'Text block'].includes(text) ? '' : text;
}

function usefulVisibleText(panel: StoryPanel) {
  const text = panel.visibleText.trim();
  return ['Image panel', 'Text panel', 'Text block'].includes(text) ? '' : text;
}

function plainTextToRichText(value: string) {
  const doc = document.implementation.createHTMLDocument('');
  const container = doc.createElement('div');
  value.split(/\n/).forEach((line, index) => {
    if (index > 0) container.appendChild(doc.createElement('br'));
    container.appendChild(doc.createTextNode(line));
  });
  return container.innerHTML;
}

function nextCaptionId(panels: StoryPanel[]) {
  const ids = new Set(panels.flatMap((panel) => [panel.id, ...(panel.captions ?? []).map((caption) => caption.id)]));
  let index = ids.size + 1;
  while (ids.has(`panel-${String(index).padStart(3, '0')}`)) index += 1;
  return `panel-${String(index).padStart(3, '0')}`;
}

function nextImagePromptId(panel: StoryPanel) {
  const ids = new Set((panel.imagePrompts ?? []).map((prompt) => prompt.id));
  let index = ids.size + 1;
  while (ids.has(`prompt-${String(index).padStart(3, '0')}`)) index += 1;
  return `prompt-${String(index).padStart(3, '0')}`;
}

function newImagePrompt(panel: StoryPanel): StoryPanelImagePrompt {
  return {
    id: nextImagePromptId(panel),
    text: '',
  };
}

function newCaptionForPanel(panel: StoryPanel, panels: StoryPanel[]): StoryPanelCaption {
  const captions = panel.captions ?? [];
  const gap = 1 / 12;
  const bottom = captions.length
    ? Math.max(...captions.map((caption) => caption.rect.y + caption.rect.h))
    : panel.rect.y + panel.rect.h;
  return {
    id: nextCaptionId(panels),
    visibleText: '',
    richText: plainTextToRichText(''),
    textStyle: { ...defaultCaptionTextStyle },
    rect: {
      x: panel.rect.x,
      y: Math.min(12.5, bottom + gap),
      w: panel.rect.w,
      h: 0.5,
    },
    layer: panel.layer + 1 + captions.length,
  };
}

function PlacementBadge({
  panel,
  pages,
  isBusy,
  onOpenPanelPlacement,
}: {
  panel: StoryPanel;
  pages: StoryPanelPage[];
  isBusy: boolean;
  onOpenPanelPlacement?: (panelId: string) => void;
}) {
  const isPlaced = panelIsPlacedOnLayout(pages, panel);
  const label = storyPagePlacementLabel(pages, panel.pageId);
  if (isPlaced && onOpenPanelPlacement) {
    return (
      <button
        type="button"
        className="story-panels-placement-badge is-placed"
        disabled={isBusy}
        onClick={(event) => {
          event.stopPropagation();
          onOpenPanelPlacement(panel.id);
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <span className={`story-panels-placement-badge ${isPlaced ? 'is-placed' : 'is-unplaced'}`}>
      {label}
    </span>
  );
}

function itemTitle(panel: StoryPanel, panels: StoryPanel[], manualMode: boolean) {
  if (panel.sourceKind === 'panel') {
    if (panel.title.trim()) return panel.title.trim();
    const number = manualPanelNumber(panels, panel.id);
    return number > 0 ? `Panel ${number}` : 'Panel';
  }
  return sidebarItemLabel(panel.sourceKind);
}

function deletePanelConfirmCopy(panel: StoryPanel, manualMode: boolean): { title: string; body: string } {
  if (panel.sourceKind === 'bookmark') {
    return {
      title: 'Delete bookmark?',
      body: 'This removes the bookmark from the panel list.',
    };
  }
  return {
    title: 'Delete panel?',
    body: 'This deletes the panel and removes it from the layout.',
  };
}

function ChunkActionsMenu({
  isOpen,
  onToggle,
  onClose,
  onDelete,
  onInsertAfter,
  onEditText,
  onDraftPrompt,
  onDraftPromptWithInput,
  onPlaceOnLayout,
  showInsert,
  showEditText,
  showDraftPrompt = false,
  showPlaceOnLayout,
  isSaving,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onDelete?: () => void;
  onInsertAfter?: () => void;
  onEditText?: () => void;
  onDraftPrompt?: () => void;
  onDraftPromptWithInput?: () => void;
  onPlaceOnLayout?: () => void;
  showInsert: boolean;
  showEditText: boolean;
  showDraftPrompt?: boolean;
  showPlaceOnLayout: boolean;
  isSaving: boolean;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    open: isOpen,
    placement: 'bottom-end',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const close = () => {
    onClose();
    (refs.reference.current as HTMLElement | null)?.focus();
  };
  useDismissOnOutsidePointerDown(isOpen, [menuRef, popoverRef], onClose);
  const { onKeyDown, focusFirst } = menuKeyboardHandlers(popoverRef, close);
  useEffect(() => {
    if (isOpen) focusFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const popover = isOpen ? (
    <div
      ref={(node) => {
        popoverRef.current = node;
        refs.setFloating(node);
      }}
      className="story-panels-chunk-menu-popover is-portaled"
      role="menu"
      style={floatingStyles}
      onKeyDown={onKeyDown}
    >
      {showInsert && onInsertAfter && (
        <button
          type="button"
          role="menuitem"
          className="story-panels-chunk-menu-item"
          disabled={isSaving}
          onClick={() => {
            onClose();
            onInsertAfter();
          }}
        >
          Insert after…
        </button>
      )}
      {showEditText && onEditText && (
        <button
          type="button"
          role="menuitem"
          className="story-panels-chunk-menu-item"
          disabled={isSaving}
          onClick={() => {
            onClose();
            onEditText();
          }}
        >
          Edit text…
        </button>
      )}
      {showDraftPrompt && onDraftPrompt && (
        <button
          type="button"
          role="menuitem"
          className="story-panels-chunk-menu-item"
          disabled={isSaving}
          onClick={() => {
            onClose();
            onDraftPrompt();
          }}
        >
          Draft with pi
        </button>
      )}
      {showDraftPrompt && onDraftPromptWithInput && (
        <button
          type="button"
          role="menuitem"
          className="story-panels-chunk-menu-item"
          disabled={isSaving}
          onClick={() => {
            onClose();
            onDraftPromptWithInput();
          }}
        >
          Draft with input…
        </button>
      )}
      {showPlaceOnLayout && onPlaceOnLayout && (
        <button
          type="button"
          role="menuitem"
          className="story-panels-chunk-menu-item"
          disabled={isSaving}
          onClick={() => {
            onClose();
            onPlaceOnLayout();
          }}
        >
          Place on layout
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          role="menuitem"
          className="story-panels-chunk-menu-item story-panels-chunk-menu-item--danger"
          disabled={isSaving}
          onClick={() => {
            onClose();
            onDelete();
          }}
        >
          Delete
        </button>
      )}
    </div>
  ) : null;

  return (
    <div className="story-panels-chunk-menu" ref={menuRef} onClick={(event) => event.stopPropagation()}>
      <button
        ref={refs.setReference}
        type="button"
        className="story-panels-chunk-menu-trigger"
        aria-label="Panel actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={isSaving}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        ⋯
      </button>
      {popover && createPortal(popover, document.body)}
    </div>
  );
}

export function PanelChunkList({
  bookLength,
  panels,
  pages,
  selectedPanelId,
  focusedPanelId,
  openEditorPanelId,
  onSelectPanel,
  onOpenEditorPanelComplete,
  onOpenPanelPlacement,
  onPlacePanelOnLayout,
  onDeletePanel,
  onInsertDraft,
  onEditPanelText,
  onSavePanelEdit,
  onDraftPrompt,
  onRefinePrompt,
  onDraftToCanvas,
  characterOptions = [],
  locationOptions = [],
  promptTaskBusy = false,
  promptRefreshKey = 0,
  isSaving,
  variant = 'card',
}: {
  bookLength: number;
  panels: StoryPanel[];
  pages: StoryPanelPage[];
  selectedPanelId: string | null;
  focusedPanelId: string | null;
  openEditorPanelId?: string | null;
  onSelectPanel: (panelId: string) => void;
  onOpenEditorPanelComplete?: () => void;
  onOpenPanelPlacement?: (panelId: string) => void;
  onPlacePanelOnLayout?: (panelId: string) => void | Promise<void>;
  onDeletePanel: (panelId: string) => void | Promise<void>;
  onInsertDraft?: (payload: InsertDraftPayload) => Promise<void>;
  onEditPanelText?: (panelId: string, text: string) => Promise<void>;
  onSavePanelEdit?: (panelId: string, patch: StoryPanelPatchPayload) => Promise<void>;
  onDraftPrompt?: (panelId: string, instructions?: string) => void;
  onRefinePrompt?: (panelId: string, promptId: string, feedback: string) => void;
  onDraftToCanvas?: (panelId: string, promptId: string) => Promise<void>;
  characterOptions?: string[];
  locationOptions?: string[];
  promptTaskBusy?: boolean;
  promptRefreshKey?: number;
  isSaving: boolean;
  variant?: 'card' | 'plain';
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const chunkRefs = useRef<Record<string, HTMLElement | null>>({});
  const [flashingPanelId, setFlashingPanelId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [insertAfterPanelId, setInsertAfterPanelId] = useState<string | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>('all');
  const [showInsertDialog, setShowInsertDialog] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [pendingDeletePanelId, setPendingDeletePanelId] = useState<string | null>(null);
  const [showEditTextDialog, setShowEditTextDialog] = useState(false);
  const [editTextPanelId, setEditTextPanelId] = useState<string | null>(null);
  const [editTextValue, setEditTextValue] = useState('');
  const [panelEditorPanelId, setPanelEditorPanelId] = useState<string | null>(null);
  const [panelEditorTitle, setPanelEditorTitle] = useState('');
  const [panelEditorKind, setPanelEditorKind] = useState<StoryPanel['panelKind']>('image');
  const [panelEditorStoryText, setPanelEditorStoryText] = useState('');
  const [panelEditorVisibleText, setPanelEditorVisibleText] = useState('');
  const [captionDrafts, setCaptionDrafts] = useState<StoryPanelCaption[]>([]);
  const [imagePromptDrafts, setImagePromptDrafts] = useState<StoryPanelImagePrompt[]>([]);
  const [characterSlugDrafts, setCharacterSlugDrafts] = useState<string[]>([]);
  const [locationSlugDraft, setLocationSlugDraft] = useState<string | null>(null);
  const [refineFeedbackDrafts, setRefineFeedbackDrafts] = useState<Record<string, string>>({});
  const [panelEditorError, setPanelEditorError] = useState<string | null>(null);
  const [draftingToCanvasPromptId, setDraftingToCanvasPromptId] = useState<string | null>(null);
  const [draftInputPanelId, setDraftInputPanelId] = useState<string | null>(null);
  const [draftInputValue, setDraftInputValue] = useState('');
  const hasBookText = bookLength > 0;
  const manualMode = !hasBookText;
  const allItems = sortSidebarItems(panels);
  const sortedPanels = filterSidebarItems(panels, sidebarFilter);
  const coveredChars = allItems
    .filter((panel) => isPanel(panel) && isBookLinked(panel))
    .reduce((total, panel) => total + (panel.endOffset! - panel.startOffset!), 0);
  const counts = {
    all: allItems.length,
    panel: allItems.filter((panel) => panel.sourceKind === 'panel').length,
    bookmark: allItems.filter((panel) => panel.sourceKind === 'bookmark').length,
  };
  const coverage = bookLength > 0 ? Math.round((coveredChars / bookLength) * 100) : 0;
  const canInsertDraft = Boolean(onInsertDraft);
  const pendingDeletePanel = pendingDeletePanelId
    ? panels.find((panel) => panel.id === pendingDeletePanelId) ?? null
    : null;
  const panelEditorPanel = panelEditorPanelId
    ? panels.find((panel) => panel.id === panelEditorPanelId) ?? null
    : null;

  useEffect(() => {
    if (!focusedPanelId) return;
    const chunk = chunkRefs.current[focusedPanelId];
    if (!chunk) return;
    const list = listRef.current;
    if (list) {
      const listRect = list.getBoundingClientRect();
      const chunkRect = chunk.getBoundingClientRect();
      const relativeTop = chunkRect.top - listRect.top + list.scrollTop;
      const relativeBottom = relativeTop + chunkRect.height;
      const padding = 12;
      let targetTop = list.scrollTop;
      if (relativeTop < list.scrollTop + padding) {
        targetTop = relativeTop - padding;
      } else if (relativeBottom > list.scrollTop + list.clientHeight - padding) {
        targetTop = relativeBottom - list.clientHeight + padding;
      }
      list.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    } else {
      chunk.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    setFlashingPanelId(focusedPanelId);
    const timeout = window.setTimeout(() => setFlashingPanelId((current) => (current === focusedPanelId ? null : current)), 1400);
    return () => window.clearTimeout(timeout);
  }, [focusedPanelId]);

  const openInsertDialog = (afterPanelId: string | null = null) => {
    setInsertAfterPanelId(afterPanelId);
    setDraftText('');
    setOpenMenuId(null);
    setShowInsertDialog(true);
  };

  const openDraftInputDialog = (panelId: string) => {
    setDraftInputPanelId(panelId);
    setDraftInputValue('');
    setOpenMenuId(null);
  };

  const submitDraftInput = () => {
    if (!draftInputPanelId || !onDraftPrompt || !draftInputValue.trim()) return;
    onDraftPrompt(draftInputPanelId, draftInputValue.trim());
    setDraftInputPanelId(null);
    setDraftInputValue('');
  };

  const openEditTextDialog = (panelId: string) => {
    const panel = panels.find((item) => item.id === panelId);
    setEditTextPanelId(panelId);
    setEditTextValue(panel ? sidebarItemPrimaryText(panel) : '');
    setOpenMenuId(null);
    setShowEditTextDialog(true);
  };

  const openPanelEditor = (panel: StoryPanel) => {
    if (!isPanel(panel)) return;
    onSelectPanel(panel.id);
    setPanelEditorPanelId(panel.id);
    setPanelEditorTitle(panel.title.trim());
    setPanelEditorKind(panel.panelKind);
    setPanelEditorStoryText(usefulStoryText(panel));
    setPanelEditorVisibleText(usefulVisibleText(panel));
    setCaptionDrafts((panel.captions ?? []).map((caption) => ({ ...caption, textStyle: { ...caption.textStyle }, rect: { ...caption.rect } })));
    setImagePromptDrafts((panel.imagePrompts ?? []).map((prompt) => ({ ...prompt })));
    setCharacterSlugDrafts([...(panel.characterSlugs ?? [])]);
    setLocationSlugDraft(panel.locationSlug ?? null);
    setPanelEditorError(null);
    setOpenMenuId(null);
  };

  useEffect(() => {
    if (!openEditorPanelId) return;
    const panel = panels.find((item) => item.id === openEditorPanelId);
    if (panel && isPanel(panel)) {
      openPanelEditor(panel);
    }
    onOpenEditorPanelComplete?.();
  }, [openEditorPanelId, onOpenEditorPanelComplete, panels]);

  // A finished pi prompt task patched the server-side panel; re-sync the open
  // editor's prompt drafts so the new/revised prompt appears in place.
  useEffect(() => {
    if (promptRefreshKey === 0 || !panelEditorPanelId) return;
    const panel = panels.find((item) => item.id === panelEditorPanelId);
    if (panel) {
      setImagePromptDrafts((panel.imagePrompts ?? []).map((prompt) => ({ ...prompt })));
      setCharacterSlugDrafts([...(panel.characterSlugs ?? [])]);
      setLocationSlugDraft(panel.locationSlug ?? null);
      setRefineFeedbackDrafts({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptRefreshKey]);

  const addCaptionDraft = () => {
    if (!panelEditorPanel) return;
    setCaptionDrafts((current) => [...current, newCaptionForPanel({ ...panelEditorPanel, captions: current }, panels)]);
  };

  const updateCaptionDraftText = (captionId: string, text: string) => {
    setCaptionDrafts((current) => current.map((caption) => (
      caption.id === captionId
        ? { ...caption, visibleText: text, richText: plainTextToRichText(text) }
        : caption
    )));
  };

  const deleteCaptionDraft = (captionId: string) => {
    setCaptionDrafts((current) => current.filter((caption) => caption.id !== captionId));
  };

  const closePanelEditor = () => {
    setPanelEditorPanelId(null);
    setPanelEditorTitle('');
    setPanelEditorKind('image');
    setPanelEditorStoryText('');
    setPanelEditorVisibleText('');
    setCaptionDrafts([]);
    setImagePromptDrafts([]);
    setCharacterSlugDrafts([]);
    setLocationSlugDraft(null);
    setRefineFeedbackDrafts({});
    setPanelEditorError(null);
    setDraftingToCanvasPromptId(null);
  };

  const addImagePromptDraft = () => {
    if (!panelEditorPanel) return;
    setImagePromptDrafts((current) => [...current, newImagePrompt({ ...panelEditorPanel, imagePrompts: current })]);
  };

  const updateImagePromptDraftText = (promptId: string, text: string) => {
    setImagePromptDrafts((current) => current.map((prompt) => (
      prompt.id === promptId ? { ...prompt, text } : prompt
    )));
  };

  const deleteImagePromptDraft = (promptId: string) => {
    setImagePromptDrafts((current) => current.filter((prompt) => prompt.id !== promptId));
  };

  const submitPanelEditor = async () => {
    if (!panelEditorPanelId || !panelEditorPanel || !onSavePanelEdit) return;
    setIsCreating(true);
    try {
      await onSavePanelEdit(panelEditorPanelId, {
        title: panelEditorTitle.trim(),
        panelKind: panelEditorKind,
        storyText: isBookLinked(panelEditorPanel) ? panelEditorPanel.selectedText : panelEditorStoryText.trim(),
        visibleText: panelEditorVisibleText.trim(),
        richText: plainTextToRichText(panelEditorVisibleText.trim()),
        captions: captionDrafts,
        imagePrompts: imagePromptDrafts,
        characterSlugs: characterSlugDrafts,
        locationSlug: locationSlugDraft,
      });
      closePanelEditor();
    } finally {
      setIsCreating(false);
    }
  };

  const submitDraftToCanvas = async (panelId: string, promptId: string) => {
    if (!onDraftToCanvas) return;
    setDraftingToCanvasPromptId(promptId);
    setPanelEditorError(null);
    try {
      await onDraftToCanvas(panelId, promptId);
      closePanelEditor();
    } catch (err) {
      console.error('[photo-web] draft panel to canvas failed', err);
      setPanelEditorError(formatRequestError(err));
      setDraftingToCanvasPromptId(null);
    }
  };

  const submitEditText = async () => {
    if (!editTextPanelId || !onEditPanelText) return;
    setIsCreating(true);
    try {
      await onEditPanelText(editTextPanelId, editTextValue.trim());
      setEditTextPanelId(null);
      setEditTextValue('');
      setShowEditTextDialog(false);
    } finally {
      setIsCreating(false);
    }
  };

  const submitInsertDraft = async () => {
    const text = draftText.trim();
    if (!text || !onInsertDraft) return;
    setIsCreating(true);
    try {
      await onInsertDraft({ storyText: text, insertAfterPanelId });
      setDraftText('');
      setInsertAfterPanelId(null);
      setShowInsertDialog(false);
    } finally {
      setIsCreating(false);
    }
  };

  const confirmDeletePanel = async () => {
    if (!pendingDeletePanelId) return;
    await onDeletePanel(pendingDeletePanelId);
    setPendingDeletePanelId(null);
  };

  const filterRow = !manualMode ? (
    <div className="story-panels-sidebar-filters" role="tablist" aria-label="Filter panels">
      {SIDEBAR_FILTER_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={sidebarFilter === option.id}
          className={`story-panels-sidebar-filter ${sidebarFilter === option.id ? 'is-active' : ''}`}
          onClick={() => setSidebarFilter(option.id)}
        >
          {option.label}
          <span className="story-panels-sidebar-filter-count">{counts[option.id]}</span>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={variant === 'plain' ? 'story-panels-chunks-pane' : 'story-card story-panels-list-card'}>
      {variant === 'card' && (
        <div className="story-panels-section-head">
          <div>
            <h2>Panels</h2>
            <p className="muted">
              {bookLength > 0
                ? `${counts.panel} panels cover ${coverage}% of the book text.`
                : `${counts.all} item${counts.all === 1 ? '' : 's'}.`}
            </p>
          </div>
        </div>
      )}
      {variant === 'plain' && (
        <div className="story-panels-chunks-meta-row">
          <p className="story-panels-chunks-meta muted">
            {manualMode
              ? `${counts.all} panel${counts.all === 1 ? '' : 's'}`
              : `${counts.all} item${counts.all === 1 ? '' : 's'}${bookLength > 0 ? ` · ${counts.panel} panels · ${coverage}% covered` : ''}`}
          </p>
          {canInsertDraft && (
            <button type="button" className="secondary story-panels-add-panel-button" disabled={isSaving || isCreating} onClick={() => openInsertDialog(null)}>
              + Add panel
            </button>
          )}
        </div>
      )}
      {filterRow}
      <div ref={listRef} className="story-panels-chunk-list">
        {sortedPanels.length === 0 ? (
          <div className="story-panels-chunk-empty">
            <p className="muted">
              {canInsertDraft
                ? manualMode
                  ? 'No panels yet. Add one here or continue writing in the story pane.'
                  : 'No items yet. Add a panel here, or select a passage in Story.'
                : 'No items yet. Select a passage in the book text to begin.'}
            </p>
            {canInsertDraft && (
              <button type="button" className="secondary" disabled={isSaving || isCreating} onClick={() => openInsertDialog(null)}>
                Add first panel
              </button>
            )}
            {canInsertDraft && !manualMode && (
              <ChunkActionsMenu
                isOpen={openMenuId === '__empty__'}
                onToggle={() => setOpenMenuId((current) => (current === '__empty__' ? null : '__empty__'))}
                onClose={() => setOpenMenuId(null)}
                onInsertAfter={() => openInsertDialog(null)}
                showInsert
                showEditText={false}
                showPlaceOnLayout={false}
                isSaving={isSaving || isCreating}
              />
            )}
          </div>
        ) : sortedPanels.map((panel) => {
          const primaryText = sidebarItemPrimaryText(panel);
          const previewText = panelPreviewText(panel, primaryText);
          const captionPreviews = captionPreviewTexts(panel);
          const captionCount = panel.captions?.length ?? 0;
          const secondaryText = sidebarItemSecondaryText(panel);
          const showPlacement = isPanel(panel);
          const isPlaced = showPlacement && panelIsPlacedOnLayout(pages, panel);
          return (
          <article
            key={panel.id}
            ref={(element) => {
              chunkRefs.current[panel.id] = element;
            }}
            className={`story-panels-chunk story-panels-chunk--${panel.sourceKind} ${selectedPanelId === panel.id ? 'is-selected' : ''} ${openMenuId === panel.id ? 'is-menu-open' : ''} ${flashingPanelId === panel.id ? 'is-flashing' : ''}`}
            onClick={() => onSelectPanel(panel.id)}
            onDoubleClick={(event) => {
              if (!isPanel(panel) || !onSavePanelEdit) return;
              event.preventDefault();
              event.stopPropagation();
              openPanelEditor(panel);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectPanel(panel.id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="story-panels-chunk-main">
              <div className="story-panels-chunk-title-row">
                <strong>{itemTitle(panel, panels, manualMode)}</strong>
                {!manualMode && isPanel(panel) && isBookLinked(panel) ? (
                  <span className="story-panels-chunk-range">{panel.startOffset}-{panel.endOffset}</span>
                ) : !manualMode && panel.startOffset !== null && panel.endOffset !== null ? (
                  <span className="story-panels-chunk-range">{panel.startOffset}-{panel.endOffset}</span>
                ) : null}
                {showPlacement && (
                  <PlacementBadge
                    panel={panel}
                    pages={pages}
                    isBusy={isCreating || isSaving}
                    onOpenPanelPlacement={onOpenPanelPlacement}
                  />
                )}
                {captionCount > 0 && (
                  <span className="story-panels-caption-count-pill">
                    {captionCount} caption{captionCount === 1 ? '' : 's'}
                  </span>
                )}
                <ChunkActionsMenu
                  isOpen={openMenuId === panel.id}
                  onToggle={() => setOpenMenuId((current) => (current === panel.id ? null : panel.id))}
                  onClose={() => setOpenMenuId(null)}
                  onDelete={() => setPendingDeletePanelId(panel.id)}
                  onInsertAfter={canInsertDraft ? () => openInsertDialog(panel.id) : undefined}
                  onEditText={onEditPanelText && isPanel(panel) && !isBookLinked(panel) && manualMode ? () => openEditTextDialog(panel.id) : undefined}
                  onDraftPrompt={onDraftPrompt ? () => onDraftPrompt(panel.id) : undefined}
                  onDraftPromptWithInput={onDraftPrompt ? () => openDraftInputDialog(panel.id) : undefined}
                  onPlaceOnLayout={!isPlaced && onPlacePanelOnLayout ? () => void onPlacePanelOnLayout(panel.id) : undefined}
                  showInsert={canInsertDraft}
                  showEditText={Boolean(onEditPanelText && isPanel(panel) && !isBookLinked(panel) && manualMode)}
                  showDraftPrompt={Boolean(onDraftPrompt && isPanel(panel) && usefulStoryText(panel) && !promptTaskBusy)}
                  showPlaceOnLayout={Boolean(!isPlaced && onPlacePanelOnLayout && showPlacement)}
                  isSaving={isSaving || isCreating}
                />
              </div>
              {previewText && <p>{compactText(previewText)}</p>}
              {captionPreviews.length > 0 && (
                <ul className="story-panels-chunk-caption-preview-list">
                  {captionPreviews.map((caption, index) => (
                    <li key={`${panel.id}-caption-preview-${index}`}>{compactText(caption, 90)}</li>
                  ))}
                </ul>
              )}
              {secondaryText && <p className="story-panels-chunk-excerpt muted">{compactText(secondaryText, 120)}</p>}
            </div>
          </article>
          );
        })}
      </div>
      {showInsertDialog && onInsertDraft && (
        <div className="confirm-backdrop" onClick={() => !isCreating && setShowInsertDialog(false)}>
          <div className="confirm-dialog story-panels-insert-dialog" role="dialog" aria-modal="true" aria-labelledby="insert-draft-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="insert-draft-title">{insertAfterPanelId ? 'Insert after' : manualMode ? 'Add panel' : 'Insert after'}</h2>
            <p className="muted">
              {manualMode
                ? 'Write the scene, dialogue, or narration for this panel.'
                : 'Write the passage, caption, or scene text for this panel.'}
            </p>
            <label>
              Story text
              <textarea
                value={draftText}
                rows={6}
                autoFocus
                disabled={isCreating}
                placeholder="Once upon a time..."
                onChange={(event) => setDraftText(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={isCreating} onClick={() => {
                setShowInsertDialog(false);
                setInsertAfterPanelId(null);
              }}>Cancel</button>
              <button type="button" disabled={isCreating || !draftText.trim()} onClick={() => void submitInsertDraft()}>
                {isCreating ? 'Adding…' : 'Add panel'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showEditTextDialog && onEditPanelText && (
        <div className="confirm-backdrop" onClick={() => !isCreating && setShowEditTextDialog(false)}>
          <div className="confirm-dialog story-panels-insert-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-panel-text-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="edit-panel-text-title">Edit panel</h2>
            <label>
              Story text
              <textarea
                value={editTextValue}
                rows={6}
                autoFocus
                disabled={isCreating}
                onChange={(event) => setEditTextValue(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={isCreating} onClick={() => setShowEditTextDialog(false)}>Cancel</button>
              <button type="button" disabled={isCreating || !editTextValue.trim()} onClick={() => void submitEditText()}>
                {isCreating ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {panelEditorPanel && onSavePanelEdit && (
        <div className="confirm-backdrop" onClick={() => !isCreating && closePanelEditor()}>
          <div className="confirm-dialog story-panels-panel-editor-popover" role="dialog" aria-modal="true" aria-labelledby="panel-caption-editor-title" onClick={(event) => event.stopPropagation()}>
            <header className="story-panels-panel-editor-head">
              <h2 id="panel-caption-editor-title">Panel editor</h2>
              <div className="story-panels-panel-editor-head-meta">
                <code className="story-panels-panel-editor-id-chip">{panelEditorPanel.id}</code>
                <PlacementBadge
                  panel={panelEditorPanel}
                  pages={pages}
                  isBusy={isCreating}
                  onOpenPanelPlacement={onOpenPanelPlacement ? (panelId) => {
                    closePanelEditor();
                    onOpenPanelPlacement(panelId);
                  } : undefined}
                />
              </div>
            </header>
            {panelEditorError && <p className="error">{panelEditorError}</p>}
            <div className="story-panels-panel-editor-grid">
              <label>
                Panel name
                <input
                  value={panelEditorTitle}
                  disabled={isCreating}
                  placeholder={itemTitle(panelEditorPanel, panels, manualMode)}
                  onChange={(event) => setPanelEditorTitle(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </label>
              <div className="story-panels-panel-editor-kind">
                <span className="story-panels-panel-editor-kind-label">Panel kind</span>
                <div className="story-panels-kind-toggle" role="tablist" aria-label="Panel kind">
                  <button
                    type="button"
                    className={panelEditorKind === 'image' ? 'is-active' : ''}
                    role="tab"
                    aria-selected={panelEditorKind === 'image'}
                    disabled={isCreating}
                    onClick={() => setPanelEditorKind('image')}
                  >
                    Image panel
                  </button>
                  <button
                    type="button"
                    className={panelEditorKind === 'text' ? 'is-active' : ''}
                    role="tab"
                    aria-selected={panelEditorKind === 'text'}
                    disabled={isCreating}
                    onClick={() => setPanelEditorKind('text')}
                  >
                    Text / caption
                  </button>
                </div>
              </div>
            </div>
            <div className="story-panels-panel-editor-text-grid">
              <label className="story-panels-panel-editor-field">
                Story text
                <textarea
                  value={isBookLinked(panelEditorPanel) ? panelEditorPanel.selectedText : panelEditorStoryText}
                  rows={5}
                  disabled={isCreating || isBookLinked(panelEditorPanel)}
                  readOnly={isBookLinked(panelEditorPanel)}
                  placeholder="Story responsibility for this panel..."
                  onChange={(event) => setPanelEditorStoryText(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </label>
              {panelEditorKind === 'text' && (
                <label className="story-panels-panel-editor-field">
                  Visible text
                  <textarea
                    value={panelEditorVisibleText}
                    rows={5}
                    disabled={isCreating}
                    placeholder="Text shown on the page..."
                    onChange={(event) => setPanelEditorVisibleText(event.target.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                </label>
              )}
            </div>
            {panelEditorKind === 'image' && (characterOptions.length > 0 || locationOptions.length > 0) && (
              <div className="story-panels-panel-caption-editor-group">
                <div className="story-panels-panel-editor-section-head">
                  <strong>Who and where</strong>
                </div>
                <div className="story-panels-panel-entity-editor">
                  {characterOptions.length > 0 && (
                    <div className="story-panels-panel-entity-row">
                      <span className="story-panels-panel-entity-label">Characters</span>
                      <span className="story-panels-panel-entity-chips">
                        {characterSlugDrafts.map((slug) => (
                          <span key={slug} className="story-panels-panel-entity-chip">
                            {slug}
                            <button
                              type="button"
                              aria-label={`Remove ${slug}`}
                              disabled={isCreating}
                              onClick={() => setCharacterSlugDrafts((current) => current.filter((item) => item !== slug))}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                        <select
                          value=""
                          disabled={isCreating || characterSlugDrafts.length >= characterOptions.length}
                          onChange={(event) => {
                            const slug = event.target.value;
                            if (slug) setCharacterSlugDrafts((current) => (current.includes(slug) ? current : [...current, slug]));
                          }}
                        >
                          <option value="">Add character…</option>
                          {characterOptions.filter((slug) => !characterSlugDrafts.includes(slug)).map((slug) => (
                            <option key={slug} value={slug}>{slug}</option>
                          ))}
                        </select>
                      </span>
                    </div>
                  )}
                  {locationOptions.length > 0 && (
                    <div className="story-panels-panel-entity-row">
                      <span className="story-panels-panel-entity-label">Location</span>
                      <select
                        value={locationSlugDraft ?? ''}
                        disabled={isCreating}
                        onChange={(event) => setLocationSlugDraft(event.target.value || null)}
                      >
                        <option value="">No location</option>
                        {locationOptions.map((slug) => (
                          <option key={slug} value={slug}>{slug}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <p className="muted story-panels-panel-entity-hint">
                    Pi tags these when drafting a prompt; they pick the reference images used when this panel is drafted to the canvas.
                  </p>
                </div>
              </div>
            )}
            <div className="story-panels-panel-caption-editor-group">
              <div className="story-panels-panel-editor-section-head">
                <strong>Image prompts</strong>
                <span className="story-panels-panel-editor-section-actions">
                  {onDraftPrompt && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={isCreating || promptTaskBusy}
                      title="Have pi draft a generation-ready prompt from the panel's story text"
                      onClick={() => onDraftPrompt(panelEditorPanel.id)}
                    >
                      {promptTaskBusy ? 'Drafting…' : 'Draft with pi'}
                    </button>
                  )}
                  {onDraftPrompt && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={isCreating || promptTaskBusy}
                      title="Give pi an idea or concept to build the prompt around"
                      onClick={() => openDraftInputDialog(panelEditorPanel.id)}
                    >
                      Draft with input…
                    </button>
                  )}
                  <button type="button" className="secondary" disabled={isCreating} onClick={addImagePromptDraft}>Add prompt</button>
                </span>
              </div>
              <div className="story-panels-panel-caption-editor-list">
                {imagePromptDrafts.length === 0 ? (
                  <p className="muted">No image prompts yet.</p>
                ) : imagePromptDrafts.map((prompt, index) => {
                  const savedOnServer = (panelEditorPanel.imagePrompts ?? []).some((item) => item.id === prompt.id);
                  const feedback = refineFeedbackDrafts[prompt.id] ?? '';
                  return (
                    <label key={prompt.id}>
                      <span>
                        Prompt {index + 1}
                        <button type="button" className="danger subtle" disabled={isCreating} onClick={() => deleteImagePromptDraft(prompt.id)}>Delete</button>
                      </span>
                      <textarea
                        className="story-panels-caption-draft-textarea"
                        value={prompt.text}
                        rows={promptTextareaRows(prompt.text)}
                        disabled={isCreating}
                        placeholder="Describe the image to generate..."
                        onChange={(event) => updateImagePromptDraftText(prompt.id, event.target.value)}
                        onKeyDown={(event) => event.stopPropagation()}
                      />
                      {onDraftToCanvas && savedOnServer && (
                        <span className="story-panels-prompt-canvas-row">
                          <button
                            type="button"
                            className="secondary"
                            disabled={isCreating || promptTaskBusy || draftingToCanvasPromptId !== null}
                            title="Create a canvas node with this prompt and the tagged entities' reference images"
                            onClick={() => void submitDraftToCanvas(panelEditorPanel.id, prompt.id)}
                          >
                            {draftingToCanvasPromptId === prompt.id ? 'Drafting to canvas…' : 'Draft to canvas'}
                          </button>
                        </span>
                      )}
                      {onRefinePrompt && savedOnServer && (
                        <span className="story-panels-prompt-refine-row">
                          <input
                            value={feedback}
                            disabled={isCreating || promptTaskBusy}
                            placeholder="Feedback, e.g. 'too dark, emphasize the fog'"
                            onChange={(event) => setRefineFeedbackDrafts((current) => ({ ...current, [prompt.id]: event.target.value }))}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === 'Enter' && feedback.trim()) {
                                onRefinePrompt(panelEditorPanel.id, prompt.id, feedback.trim());
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="secondary"
                            disabled={isCreating || promptTaskBusy || !feedback.trim()}
                            onClick={() => onRefinePrompt(panelEditorPanel.id, prompt.id, feedback.trim())}
                          >
                            Refine
                          </button>
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="story-panels-panel-caption-editor-group">
              <div className="story-panels-panel-editor-section-head">
                <strong>Captions</strong>
                <button type="button" className="secondary" disabled={isCreating} onClick={addCaptionDraft}>Add caption</button>
              </div>
              <div className="story-panels-panel-caption-editor-list">
                {captionDrafts.length === 0 ? (
                  <p className="muted">No captions yet.</p>
                ) : captionDrafts.map((caption, index) => (
                  <label key={caption.id}>
                    <span>
                      Caption {index + 1}
                      <button type="button" className="danger subtle" disabled={isCreating} onClick={() => deleteCaptionDraft(caption.id)}>Delete</button>
                    </span>
                    <textarea
                      className="story-panels-caption-draft-textarea"
                      value={caption.visibleText}
                      rows={captionTextareaRows(caption.visibleText)}
                      disabled={isCreating}
                      onChange={(event) => updateCaptionDraftText(caption.id, event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={isCreating} onClick={closePanelEditor}>Cancel</button>
              <button
                type="button"
                disabled={isCreating || promptTaskBusy}
                title={promptTaskBusy ? 'Wait for the pi prompt task to finish' : undefined}
                onClick={() => void submitPanelEditor()}
              >
                {isCreating ? 'Saving...' : 'Save panel'}
              </button>
            </div>
          </div>
        </div>
      )}
      {draftInputPanelId && onDraftPrompt && (
        <div className="confirm-backdrop" onClick={() => setDraftInputPanelId(null)}>
          <div className="confirm-dialog story-panels-insert-dialog" role="dialog" aria-modal="true" aria-labelledby="draft-input-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="draft-input-title">Draft with input</h2>
            <p className="muted">
              Give pi an idea, concept, or direction for this panel's image. It will build a full
              generation-ready prompt around it, using the panel's story text and character looks.
            </p>
            <label>
              Your idea
              <textarea
                value={draftInputValue}
                rows={4}
                autoFocus
                placeholder="e.g. 'close-up on her hands as she opens the letter, window light from the left'"
                onChange={(event) => setDraftInputValue(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setDraftInputPanelId(null)}>Cancel</button>
              <button type="button" disabled={!draftInputValue.trim() || promptTaskBusy} onClick={submitDraftInput}>
                Draft prompt
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingDeletePanel && (
        <div className="confirm-backdrop" onClick={() => !isSaving && setPendingDeletePanelId(null)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-chunk-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="delete-chunk-title">{deletePanelConfirmCopy(pendingDeletePanel, manualMode).title}</h2>
            <p>{deletePanelConfirmCopy(pendingDeletePanel, manualMode).body}</p>
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={isSaving} onClick={() => setPendingDeletePanelId(null)}>Cancel</button>
              <button type="button" className="danger" disabled={isSaving} onClick={() => void confirmDeletePanel()}>
                {isSaving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
