import { useEffect, useState, type ReactNode } from 'react';
import { PageLayoutEditor, type StoryPanelLayoutMode } from './PageLayoutEditor';
import { PanelChunkList } from './PanelChunkList';
import type { InsertDraftPayload } from './storyPanelSidebar';
import { autoPlaceDraftPanel, readAutoPlaceEnabled } from './autoPlace';
import type { LayoutEditorNavigation } from './layoutEditorNavigation';
import { readSinglePagePreviewMode, writeSinglePagePreviewMode, type SinglePagePreviewMode } from './singlePagePreview';
import {
  readInspectorVisible,
  readPanelsTrayVisible,
  writeInspectorVisible,
  writePanelsTrayVisible,
} from './layoutUiPrefs';
import { sortedPanels } from './storyPanelUtils';
import { isEditableShortcutTarget } from '../shared/dom';
import { useStoryPanelDocument } from './useStoryPanelDocument';
import { PiTaskPanel } from '../sessions/PiTaskPanel';
import { usePiTask } from '../sessions/usePiTask';
import { formatRequestError } from '../formatError';
import { api } from '../api';
import type { AdaptationStatus, CanvasDocument, StoryPanelPatchPayload, StoryPanelRect } from '../types';
import { isPanel, isUnplaced } from './panelModel';

export function LayoutEditorView({
  projectSlug,
  initialNavigation,
  onNavigationComplete,
  onPanelDraftedToCanvas,
  onOpenAgentSession,
}: {
  projectSlug: string;
  initialNavigation: LayoutEditorNavigation | null;
  onNavigationComplete: () => void;
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
    assets,
    projectTags,
    canvas,
    reload,
  } = useStoryPanelDocument(projectSlug, { withCanvasContext: true });
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [focusedChunkPanelId, setFocusedChunkPanelId] = useState<string | null>(null);
  const [navigateToPanelId, setNavigateToPanelId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<StoryPanelLayoutMode>('spread');
  const [inspectorVisible, setInspectorVisible] = useState(readInspectorVisible);
  const [panelsTrayVisible, setPanelsTrayVisible] = useState(readPanelsTrayVisible);
  const [singlePagePreviewMode, setSinglePagePreviewMode] = useState<SinglePagePreviewMode>(readSinglePagePreviewMode);
  const [isPlacingPanel, setIsPlacingPanel] = useState(false);
  const [promptRefreshKey, setPromptRefreshKey] = useState(0);

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

  const togglePrintPreview = () => {
    setSinglePagePreviewMode((current) => {
      const next = current === 'print' ? 'readable' : 'print';
      writeSinglePagePreviewMode(next);
      return next;
    });
  };

  const setInspector = (visible: boolean) => {
    writeInspectorVisible(visible);
    setInspectorVisible(visible);
  };

  const setPanelsTray = (visible: boolean) => {
    writePanelsTrayVisible(visible);
    setPanelsTrayVisible(visible);
  };

  useEffect(() => {
    if (!initialNavigation || !document) return;
    setLayoutMode('single');
    setPanelsTray(true);
    setSelectedPanelId(initialNavigation.panelId);
    setFocusedChunkPanelId(null);
    window.setTimeout(() => setFocusedChunkPanelId(initialNavigation.panelId), 0);
    const panel = document.panels.find((candidate) => candidate.id === initialNavigation.panelId);
    if (panel?.pageId && document.pages.some((page) => page.id === panel.pageId)) {
      setNavigateToPanelId(initialNavigation.panelId);
    }
    onNavigationComplete();
  }, [document, initialNavigation, onNavigationComplete]);

  const selectPanelChunk = (panelId: string) => {
    setSelectedPanelId(panelId);
    setFocusedChunkPanelId(null);
    window.setTimeout(() => setFocusedChunkPanelId(panelId), 0);
  };

  const selectLayoutPanel = (panelId: string | null) => {
    setSelectedPanelId(panelId);
    if (!panelId) {
      setFocusedChunkPanelId(null);
      return;
    }
    if (!document?.panels.some((panel) => panel.id === panelId && isPanel(panel))) return;
    setFocusedChunkPanelId(null);
    window.setTimeout(() => setFocusedChunkPanelId(panelId), 0);
  };

  const openPanelPlacement = (panelId: string) => {
    if (!document) return;
    const panel = document.panels.find((candidate) => candidate.id === panelId);
    if (!panel) return;
    setLayoutMode('single');
    setPanelsTray(true);
    setSelectedPanelId(panelId);
    setFocusedChunkPanelId(null);
    window.setTimeout(() => setFocusedChunkPanelId(panelId), 0);
    if (panel.pageId && document.pages.some((page) => page.id === panel.pageId)) {
      setNavigateToPanelId(panelId);
    }
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

  const handleDeletePanel = async (panelId: string) => {
    const next = await deletePanel(panelId);
    if (next) {
      setSelectedPanelId(sortedPanels(next.panels).find((panel) => isPanel(panel) && panel.parentPanelId == null)?.id ?? null);
    }
  };

  const insertDraft = async ({ storyText, insertAfterPanelId }: InsertDraftPayload) => {
    const beforeIds = new Set(document?.panels.map((panel) => panel.id) ?? []);
    const next = await api.createStoryPanel(projectSlug, {
      storyText,
      insertAfterPanelId,
      autoPlace: autoPlaceDraftPanel(sidebarPanels.length, readAutoPlaceEnabled()),
    });
    setDocument(next);
    const created = next.panels.find((panel) => !beforeIds.has(panel.id));
    if (created) {
      setSelectedPanelId(created.id);
      setFocusedChunkPanelId(null);
      window.setTimeout(() => setFocusedChunkPanelId(created.id), 0);
    }
  };

  const savePanelEdit = async (panelId: string, patch: StoryPanelPatchPayload) => {
    const next = await api.patchStoryPanel(projectSlug, panelId, patch);
    setDocument(next);
  };

  const createPanelAt = async ({ pageId, rect, panelKind }: { pageId: string; rect: StoryPanelRect; panelKind: 'image' | 'text' }) => {
    const beforeIds = new Set(document?.panels.map((panel) => panel.id) ?? []);
    const next = await api.createStoryPanel(projectSlug, {
      title: panelKind === 'text' ? 'Text panel' : 'Image panel',
      storyText: '',
      visibleText: panelKind === 'text' ? 'Text block' : '',
      panelKind,
      pageId,
      rect,
      autoPlace: false,
    });
    setDocument(next);
    const created = next.panels.find((panel) => !beforeIds.has(panel.id));
    if (created) {
      setSelectedPanelId(created.id);
      setFocusedChunkPanelId(null);
      return created.id;
    }
    return null;
  };

  const placePanelAt = async ({ panelId, pageId, rect }: { panelId: string; pageId: string; rect: StoryPanelRect }) => {
    const next = await api.patchStoryPanel(projectSlug, panelId, { pageId, rect });
    setDocument(next);
    setSelectedPanelId(panelId);
    setFocusedChunkPanelId(null);
  };

  useEffect(() => {
    const layoutShortcuts: Record<string, StoryPanelLayoutMode> = {
      a: 'all-pages',
      '2': 'spread',
      s: 'single',
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const nextMode = layoutShortcuts[key];
      if (nextMode) {
        event.preventDefault();
        setLayoutMode(nextMode);
        return;
      }
      if (key === 'p') {
        event.preventDefault();
        setPanelsTrayVisible((current) => {
          const next = !current;
          writePanelsTrayVisible(next);
          return next;
        });
        return;
      }
      if (key === 'i') {
        event.preventDefault();
        setInspectorVisible((current) => {
          const next = !current;
          writeInspectorVisible(next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (isLoading) {
    return (
      <div className="story-adaptation-screen layout-view-screen layout-view-screen--empty">
        <p className="muted">Loading layout...</p>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="story-adaptation-screen layout-view-screen layout-view-screen--empty">
        <p className="error">{error ?? 'Unable to load layout.'}</p>
      </div>
    );
  }

  const unplacedPanels = sidebarPanels.filter(isUnplaced);

  const panelChunks = (
    <PanelChunkList
      bookLength={bookText.length}
      panels={sidebarPanels}
      pages={document.pages}
      selectedPanelId={selectedPanelId}
      focusedPanelId={focusedChunkPanelId}
      onSelectPanel={selectPanelChunk}
      onOpenPanelPlacement={openPanelPlacement}
      onPlacePanelOnLayout={placePanelOnLayout}
      onDeletePanel={handleDeletePanel}
      onInsertDraft={insertDraft}
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

  return (
    <div className="story-adaptation-screen story-panels-screen layout-view-screen">
      {error && <p className="error error-banner layout-view-error">{error}</p>}
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
      <div className="layout-view-workspace">
        <PageLayoutEditor
          document={document}
          selectedPanelId={selectedPanelId}
          layoutMode={layoutMode}
          singlePagePreviewMode={singlePagePreviewMode}
          onTogglePrintPreview={togglePrintPreview}
          onSelectPanel={selectLayoutPanel}
          onSaveDocument={saveDocument}
          isSaving={isSaving}
          sidePanel={panelChunks}
          onLayoutModeChange={setLayoutMode}
          inspectorVisible={inspectorVisible}
          onInspectorVisibleChange={setInspector}
          panelsTrayVisible={panelsTrayVisible}
          onPanelsTrayVisibleChange={setPanelsTray}
          unplacedPanels={unplacedPanels}
          onCreatePanelAt={createPanelAt}
          onPlacePanelAt={placePanelAt}
          assets={assets}
          projectTags={projectTags}
          canvas={canvas}
          projectSlug={projectSlug}
          navigateToPanelId={navigateToPanelId}
          onNavigateToPanelComplete={() => setNavigateToPanelId(null)}
        />
      </div>
    </div>
  );
}
