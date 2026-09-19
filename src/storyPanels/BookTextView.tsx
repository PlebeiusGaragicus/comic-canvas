import { useEffect, useRef, useState } from 'react';
import { formatRequestError } from '../formatError';
import { api } from '../api';
import { BookTextSelector, type TextSelectionRange } from './BookTextSelector';
import { ManualStoryReader } from './ManualStoryReader';
import { PanelChunkList } from './PanelChunkList';
import { PiTaskPanel } from '../sessions/PiTaskPanel';
import { usePiTask } from '../sessions/usePiTask';
import { StorySetupView } from './StorySetupView';
import type { LayoutEditorNavigation } from './layoutEditorNavigation';
import type { InsertDraftPayload } from './storyPanelSidebar';
import { sortedPanels, withSelectedText } from './storyPanelUtils';
import { autoPlaceDraftPanel } from './autoPlace';
import { useStoryPanelDocument } from './useStoryPanelDocument';
import { isBookLinked, isPanel } from './panelModel';
import type { AdaptationStatus, CanvasDocument, StoryPanelPatchPayload } from '../types';

export function BookTextView({
  projectSlug,
  onNavigateToLayoutEditor,
  panelChunksOpen,
  onPanelChunksOpenChange,
  onHasBookTextChange,
  autoPlaceEnabled,
  onImportBook,
  onPanelDraftedToCanvas,
  onOpenAgentSession,
}: {
  projectSlug: string;
  onNavigateToLayoutEditor: (navigation: LayoutEditorNavigation) => void;
  panelChunksOpen: boolean;
  onPanelChunksOpenChange: (open: boolean) => void;
  onHasBookTextChange: (hasBookText: boolean) => void;
  autoPlaceEnabled: boolean;
  onImportBook: (file: File) => Promise<void>;
  onPanelDraftedToCanvas?: (canvas: CanvasDocument, nodeId: string) => void;
  onOpenAgentSession: (sessionId: string) => void;
}) {
  const {
    bookText,
    document,
    sidebarPanels,
    isLoading,
    isSaving,
    error,
    setError,
    setDocument,
    saveDocument,
    deletePanel,
    reload,
  } = useStoryPanelDocument(projectSlug);
  const [selection, setSelection] = useState<TextSelectionRange | null>(null);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [focusedBookPanelId, setFocusedBookPanelId] = useState<string | null>(null);
  const [focusedChunkPanelId, setFocusedChunkPanelId] = useState<string | null>(null);
  const [editorPanelRequestId, setEditorPanelRequestId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPlacingPanel, setIsPlacingPanel] = useState(false);
  const [isImportingBook, setIsImportingBook] = useState(false);
  const [promptRefreshKey, setPromptRefreshKey] = useState(0);
  const bookUploadInputRef = useRef<HTMLInputElement | null>(null);

  // Panel-prompt pi tasks: on finish, reload the document and bump the key so
  // an open panel editor re-syncs its image-prompt drafts from the server.
  const onPromptTaskFinished = async (state: string) => {
    if (state !== 'done') return;
    await reload();
    setPromptRefreshKey((current) => current + 1);
  };
  const draftPromptTask = usePiTask(projectSlug, 'draft-panel-prompt', onPromptTaskFinished);
  const refinePromptTask = usePiTask(projectSlug, 'refine-panel-prompt', onPromptTaskFinished);
  const promptTaskBusy = draftPromptTask.isActive || refinePromptTask.isActive;

  // Canonical entity slugs for the panel editor's "who and where" chips.
  const [adaptationStatus, setAdaptationStatus] = useState<AdaptationStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.getAdaptation(projectSlug)
      .then((status) => { if (!cancelled) setAdaptationStatus(status); })
      .catch((err) => console.error('[photo-web] failed to load adaptation status', err));
    return () => { cancelled = true; };
  }, [projectSlug, promptRefreshKey]);

  const draftToCanvas = async (panelId: string, promptId: string) => {
    const result = await api.draftPanelToCanvas(projectSlug, panelId, promptId);
    onPanelDraftedToCanvas?.(result.canvas, result.nodeId);
  };

  const hasBookText = bookText.length > 0;
  const showStorySetup = !hasBookText && sidebarPanels.length === 0;

  const handleImportBook = async (file: File) => {
    setError(null);
    try {
      await onImportBook(file);
      await reload();
    } catch (err) {
      setError(formatRequestError(err));
      throw err;
    }
  };

  const handleManualBookUpload = async (file: File | undefined) => {
    if (!file) return;
    setIsImportingBook(true);
    try {
      await handleImportBook(file);
    } catch {
      // handleImportBook already surfaced the error banner.
    } finally {
      setIsImportingBook(false);
      if (bookUploadInputRef.current) bookUploadInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!hasBookText) {
      onPanelChunksOpenChange(true);
    }
  }, [hasBookText, onPanelChunksOpenChange]);

  useEffect(() => {
    onHasBookTextChange(hasBookText);
  }, [hasBookText, onHasBookTextChange]);

  const selectPanelChunk = (panelId: string) => {
    setSelectedPanelId(panelId);
    setFocusedBookPanelId(null);
    window.setTimeout(() => setFocusedBookPanelId(panelId), 0);
  };

  const focusPanelChunk = (panelId: string) => {
    setSelectedPanelId(panelId);
    setFocusedChunkPanelId(null);
    window.setTimeout(() => setFocusedChunkPanelId(panelId), 0);
  };

  const openPanelEditor = (panelId: string) => {
    setSelectedPanelId(panelId);
    onPanelChunksOpenChange(true);
    setFocusedChunkPanelId(null);
    window.setTimeout(() => setFocusedChunkPanelId(panelId), 0);
    setEditorPanelRequestId(panelId);
  };

  const openPanelPlacement = (panelId: string) => {
    if (!document) return;
    const panel = document.panels.find((candidate) => candidate.id === panelId);
    if (!panel) return;
    setSelectedPanelId(panelId);
    onNavigateToLayoutEditor({ panelId });
  };

  const placePanelOnLayout = async (panelId: string) => {
    setIsPlacingPanel(true);
    setError(null);
    try {
      const next = await api.autoPlaceStoryPanel(projectSlug, panelId);
      setDocument(next);
      setSelectedPanelId(panelId);
      openPanelPlacement(panelId);
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setIsPlacingPanel(false);
    }
  };

  const createPanel = async (options: { openEditor?: boolean } = {}) => {
    if (!selection) return;
    setIsCreating(true);
    setError(null);
    try {
      const next = await api.createStoryPanel(projectSlug, {
        ...selection,
        storyText: selection.selectedText,
        visibleText: '',
        autoPlace: autoPlaceEnabled,
      });
      setDocument(next);
      setSelection(null);
      const createdPanel = sortedPanels(next.panels).find(
        (panel) => panel.sourceKind === 'panel' && panel.startOffset === selection.startOffset && panel.endOffset === selection.endOffset,
      );
      setSelectedPanelId(createdPanel?.id ?? null);
      if (options.openEditor && createdPanel) openPanelEditor(createdPanel.id);
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeletePanel = async (panelId: string) => {
    const next = await deletePanel(panelId);
    if (next) {
      setSelectedPanelId(sortedPanels(next.panels).find((panel) => (
        (isPanel(panel) && panel.parentPanelId == null) || panel.sourceKind === 'bookmark'
      ))?.id ?? null);
    }
  };

  const createBookmark = async () => {
    if (!selection) return;
    setIsCreating(true);
    setError(null);
    try {
      const beforeIds = new Set(document?.panels.map((panel) => panel.id) ?? []);
      const next = await api.createStoryBookmark(projectSlug, selection);
      setDocument(next);
      setSelection(null);
      const created = next.panels.find((panel) => !beforeIds.has(panel.id));
      if (created) {
        setSelectedPanelId(created.id);
        setFocusedBookPanelId(null);
        window.setTimeout(() => setFocusedBookPanelId(created.id), 0);
      }
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setIsCreating(false);
    }
  };

  const insertDraft = async ({ storyText, insertAfterPanelId }: InsertDraftPayload) => {
    if (!document) return;
    const beforeIds = new Set(document.panels.map((panel) => panel.id));
    const next = await api.createStoryPanel(projectSlug, {
      storyText,
      insertAfterPanelId,
      autoPlace: autoPlaceDraftPanel(sidebarPanels.length, autoPlaceEnabled),
    });
    setDocument(next);
    const created = next.panels.find((panel) => !beforeIds.has(panel.id));
    if (created) {
      setSelectedPanelId(created.id);
      setFocusedBookPanelId(null);
      window.setTimeout(() => setFocusedBookPanelId(created.id), 0);
    }
  };

  const editPanelText = async (panelId: string, storyText: string) => {
    setError(null);
    try {
      const next = await api.patchStoryPanel(projectSlug, panelId, { storyText });
      setDocument(next);
    } catch (err) {
      setError(formatRequestError(err));
    }
  };

  const savePanelEdit = async (panelId: string, patch: StoryPanelPatchPayload) => {
    setError(null);
    try {
      const next = await api.patchStoryPanel(projectSlug, panelId, patch);
      setDocument(next);
    } catch (err) {
      setError(formatRequestError(err));
    }
  };

  const adjustPanelRange = async (panelId: string, startOffset: number, endOffset: number) => {
    if (!document) return;
    const ordered = sortedPanels(document.panels).filter((panel) => isPanel(panel) && isBookLinked(panel));
    const targetIndex = ordered.findIndex((panel) => panel.id === panelId);
    if (targetIndex < 0) return;
    const target = ordered[targetIndex];
    if (target.startOffset === null || target.endOffset === null) return;
    const nextStart = Math.max(0, Math.min(startOffset, endOffset - 1));
    const nextEnd = Math.min(bookText.length, Math.max(endOffset, nextStart + 1));
    const updates = new Map<string, ReturnType<typeof withSelectedText>>();
    updates.set(target.id, withSelectedText(bookText, { ...target, startOffset: nextStart, endOffset: nextEnd }));
    const previous = ordered[targetIndex - 1];
    if (previous && previous.startOffset !== null && previous.endOffset !== null && previous.endOffset > nextStart) {
      const adjustedPrevious = { ...previous, endOffset: Math.max(previous.startOffset + 1, nextStart) };
      updates.set(previous.id, withSelectedText(bookText, adjustedPrevious));
    }
    const next = ordered[targetIndex + 1];
    if (next && next.startOffset !== null && next.endOffset !== null && next.startOffset < nextEnd) {
      const adjustedNext = { ...next, startOffset: Math.min(next.endOffset - 1, nextEnd) };
      updates.set(next.id, withSelectedText(bookText, adjustedNext));
    }
    await saveDocument({
      ...document,
      panels: document.panels.map((panel) => updates.get(panel.id) ?? panel),
    });
  };

  if (isLoading) {
    return (
      <div className="story-adaptation-screen">
        <p className="muted">Loading story...</p>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="story-adaptation-screen story-view-screen story-view-screen--empty">
        <h1 className="story-view-title">Story</h1>
        <p className="error">{error ?? 'Unable to load panels.'}</p>
      </div>
    );
  }

  const panelChunks = (
    <PanelChunkList
      variant="plain"
      bookLength={bookText.length}
      panels={sidebarPanels}
      pages={document.pages}
      selectedPanelId={selectedPanelId}
      focusedPanelId={focusedChunkPanelId}
      openEditorPanelId={editorPanelRequestId}
      onSelectPanel={selectPanelChunk}
      onOpenEditorPanelComplete={() => setEditorPanelRequestId(null)}
      onOpenPanelPlacement={openPanelPlacement}
      onPlacePanelOnLayout={placePanelOnLayout}
      onDeletePanel={handleDeletePanel}
      onInsertDraft={hasBookText ? undefined : insertDraft}
      onEditPanelText={hasBookText ? undefined : editPanelText}
      onSavePanelEdit={savePanelEdit}
      onDraftPrompt={(panelId, instructions) => void draftPromptTask.start({ target: panelId, instructions })}
      onRefinePrompt={(panelId, promptId, feedback) =>
        void refinePromptTask.start({ target: `${panelId}:${promptId}`, instructions: feedback })}
      onDraftToCanvas={draftToCanvas}
      characterOptions={Object.keys(adaptationStatus?.characters ?? {})}
      locationOptions={Object.keys(adaptationStatus?.locations ?? {})}
      promptTaskBusy={promptTaskBusy}
      promptRefreshKey={promptRefreshKey}
      isSaving={isSaving || isPlacingPanel}
    />
  );

  const promptTaskPanels = (
    <>
      {draftPromptTask.state !== null && (
        <PiTaskPanel
          title="Draft panel prompt"
          state={draftPromptTask.state}
          events={draftPromptTask.events}
          error={draftPromptTask.error}
          onAbort={() => void draftPromptTask.abort()}
          onDismiss={draftPromptTask.dismiss}
          onOpenSession={draftPromptTask.taskId ? () => onOpenAgentSession(draftPromptTask.taskId!) : undefined}
        />
      )}
      {refinePromptTask.state !== null && (
        <PiTaskPanel
          title="Refine panel prompt"
          state={refinePromptTask.state}
          events={refinePromptTask.events}
          error={refinePromptTask.error}
          onAbort={() => void refinePromptTask.abort()}
          onDismiss={refinePromptTask.dismiss}
          onOpenSession={refinePromptTask.taskId ? () => onOpenAgentSession(refinePromptTask.taskId!) : undefined}
        />
      )}
    </>
  );

  if (showStorySetup) {
    return (
      <div className="story-adaptation-screen story-panels-screen story-view-screen">
        {error && <p className="error error-banner story-view-error">{error}</p>}
        <StorySetupView
          onImportBook={handleImportBook}
          onAddPanel={insertDraft}
          isSaving={isSaving}
        />
      </div>
    );
  }

  return (
    <div className="story-adaptation-screen story-panels-screen story-view-screen">
      {error && <p className="error error-banner story-view-error">{error}</p>}
      {promptTaskPanels}
      <div
        className={[
          'story-view-workspace',
          panelChunksOpen ? 'is-chunks-open' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="story-view-text-pane">
          {hasBookText ? (
            <BookTextSelector
              bookText={bookText}
              panels={sidebarPanels.filter((panel) => (isPanel(panel) && isBookLinked(panel)) || panel.sourceKind === 'bookmark')}
              selection={selection}
              focusedPanelId={focusedBookPanelId}
              onSelectionChange={setSelection}
              onCreatePanel={createPanel}
              onCreateBookmark={createBookmark}
              onDeletePanel={handleDeletePanel}
              onAdjustPanelRange={adjustPanelRange}
              onFocusPanelChunk={focusPanelChunk}
              isCreating={isCreating}
            />
          ) : (
            <>
              <div className="story-view-manual-import">
                <input
                  ref={bookUploadInputRef}
                  type="file"
                  accept=".txt,text/plain"
                  hidden
                  disabled={isImportingBook}
                  onChange={(event) => void handleManualBookUpload(event.target.files?.[0])}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={isImportingBook || isSaving}
                  onClick={() => bookUploadInputRef.current?.click()}
                >
                  {isImportingBook ? 'Uploading…' : 'Upload book.txt'}
                </button>
                <span className="muted">Import your manuscript to highlight passages into panels.</span>
              </div>
              <ManualStoryReader
                panels={sidebarPanels}
                selectedPanelId={selectedPanelId}
                focusedPanelId={focusedBookPanelId}
                onSelectPanel={selectPanelChunk}
                onFocusPanelChunk={focusPanelChunk}
                onOpenPanelEditor={openPanelEditor}
                onInsertDraft={insertDraft}
                onEditPanelText={editPanelText}
                isSaving={isSaving || isCreating}
              />
            </>
          )}
        </div>

        {panelChunksOpen && (
          <aside className="story-view-chunks-pane">
            <div className="story-view-chunks-pane-head">
              <h2 className="story-view-chunks-title">Panels</h2>
            </div>
            {panelChunks}
          </aside>
        )}
      </div>
    </div>
  );
}
