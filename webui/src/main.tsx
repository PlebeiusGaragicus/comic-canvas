import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import 'reactflow/dist/style.css';
import '@fontsource-variable/inter';
import './styles/index.css';
import clsx from 'clsx';
import { formatRequestError } from './formatError';
import { api } from './api';
import { exportProjectAssetsToFolder } from './exportAssets';
import { EntityHubView } from './characters/EntityHubView';
import { BookTextView } from './storyPanels/BookTextView';
import { readAutoPlaceEnabled, writeAutoPlaceEnabled } from './storyPanels/autoPlace';
import { LayoutEditorView } from './storyPanels/LayoutEditorView';
import { ProjectLanding } from './ProjectLanding';
import { SettingsModal } from './SettingsModal';
import { ProjectPhaseSidebar } from './ProjectPhaseSidebar';
import { ProjectTopBar } from './ProjectTopBar';
import type { ProjectPhase } from './projectNavigation';
import { isEditableShortcutTarget } from './shared/dom';
import { ToastProvider, useToast } from './shared/toast';
import type { LayoutEditorNavigation } from './storyPanels/layoutEditorNavigation';
import { BOOKLET_PAGE_BORDER_OPTIONS, type BookletPageBorder } from './storyPanels/printLayout';
import { characterEntityTags, locationEntityTags } from './canvas/shared';
import { CanvasFlowSurface, CanvasPanels } from './canvas/CanvasView';
import { FloatingTagsMenu } from './canvas/FloatingTagsMenu';
import { useCanvasWorkspace } from './canvas/useCanvasWorkspace';
import { HoverTooltip, Modal } from './ui';
import type { AdaptationStatus, Project } from './types';
import { AgentDashboardView } from './sessions/AgentDashboardView';
import { ConceptArtView } from './conceptArt/ConceptArtView';
import { usePiTask } from './sessions/usePiTask';
import { PiTaskPanel } from './sessions/PiTaskPanel';
import { installTestHooks } from './e2e/testHooks';
import { onRemoteChange } from './store/changes';
import { registerServiceWorker } from './pwa/update';
import { installInstallPromptCapture } from './pwa/install';
import { useOnlineStatus } from './pwa/offline';

type PhaseViewMode = 'list' | 'canvas';

function phaseHasCanvas(phase: ProjectPhase) {
  return phase === 'image-canvas' || phase === 'characters-hub' || phase === 'locations-hub' || phase === 'concept-art';
}

const serviceWorker = registerServiceWorker();

/** Sticky "update available" toast wired to the service worker. */
function useUpdateToast() {
  const toast = useToast();
  useEffect(() => {
    let dismiss: (() => void) | null = null;
    const unsubscribe = serviceWorker.onUpdateAvailable((reload) => {
      dismiss?.();
      dismiss = toast.sticky('A new version of Comic Canvas is ready.', { label: 'Reload', onClick: reload });
    });
    return () => {
      unsubscribe();
      dismiss?.();
    };
  }, [toast]);
}

function App() {
  useUpdateToast();
  const online = useOnlineStatus();
  const [projects, setProjects] = useState<Project[]>([]);
  const [openProjectSlug, setOpenProjectSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [projectPhase, setProjectPhase] = useState<ProjectPhase>('image-canvas');
  const [layoutEditorNavigation, setLayoutEditorNavigation] = useState<LayoutEditorNavigation | null>(null);
  const [agentFocusSessionId, setAgentFocusSessionId] = useState<string | null>(null);
  const [phaseViewMode, setPhaseViewMode] = useState<PhaseViewMode>('list');
  const [isPhaseSidebarCollapsed, setIsPhaseSidebarCollapsed] = useState(false);
  const [storyPanelChunksOpen, setStoryPanelChunksOpen] = useState(true);
  const [storyHasBookText, setStoryHasBookText] = useState(false);
  const [storyAutoPlaceEnabled, setStoryAutoPlaceEnabled] = useState(readAutoPlaceEnabled);
  const [showExportPdfModal, setShowExportPdfModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [exportPageBorder, setExportPageBorder] = useState<BookletPageBorder>('black');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  // Bumped after story-panel recovery so Story/Layout remount and reload panels.json.
  const [storyPanelRecoveryKey, setStoryPanelRecoveryKey] = useState(0);
  const [adaptation, setAdaptation] = useState<AdaptationStatus | null>(null);

  const isCanvasActive = phaseHasCanvas(projectPhase) && phaseViewMode === 'canvas';

  const onProjectUpdated = useCallback((project: Project) => {
    setProjects((current) => current.map((item) => (item.slug === project.slug ? project : item)));
  }, []);
  const onShowCanvasView = useCallback(() => {
    setPhaseViewMode('canvas');
  }, []);
  const onGoToImageCanvas = useCallback(() => {
    setProjectPhase('image-canvas');
    setPhaseViewMode('canvas');
  }, []);

  const workspace = useCanvasWorkspace({
    openProjectSlug,
    projectPhase,
    isCanvasActive,
    adaptation,
    setAdaptation,
    setError,
    onProjectUpdated,
    onShowCanvasView,
    onGoToImageCanvas,
  });

  const loadProjects = useCallback(async () => {
    setProjects(await api.listProjects());
  }, []);

  useEffect(() => {
    loadProjects()
      .catch((err) => setError(formatRequestError(err)))
      .finally(() => {
        document.body.dataset.appReady = 'true';
      });
  }, [loadProjects]);

  // Another tab changed the open project: refetch instead of overwriting it.
  useEffect(() => {
    return onRemoteChange((change) => {
      if (change.slug === null || change.store === 'settings') return;
      void loadProjects().catch((err) => console.error('[comic-canvas] refetch after remote change failed', err));
      if (openProjectSlug && change.slug === openProjectSlug) {
        void workspace.loadProject(openProjectSlug);
      }
    });
  }, [loadProjects, openProjectSlug, workspace.loadProject]);

  useEffect(() => {
    if (!openProjectSlug) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) return;
      if (event.key.toLowerCase() !== 'e') return;
      event.preventDefault();
      setIsPhaseSidebarCollapsed((current) => !current);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openProjectSlug]);

  const currentProject = projects.find((project) => project.slug === openProjectSlug);

  const loadAdaptation = useCallback(async () => {
    if (!openProjectSlug) {
      setAdaptation(null);
      return;
    }
    try {
      setAdaptation(await api.getAdaptation(openProjectSlug));
    } catch (err) {
      setError(String(err));
    }
  }, [openProjectSlug]);

  useEffect(() => {
    void loadAdaptation();
  }, [loadAdaptation, workspace.assets]);

  useEffect(() => {
    if (projectPhase === 'concept-art' && openProjectSlug) {
      void loadAdaptation();
    }
  }, [loadAdaptation, openProjectSlug, projectPhase]);

  const readBookTask = usePiTask(openProjectSlug, 'read-book', loadAdaptation);
  const isReadingBook = readBookTask.isActive;
  const startReadBook = readBookTask.start;

  const importAdaptationBook = async (file: File) => {
    if (!openProjectSlug) return;
    setAdaptation(await api.importAdaptationBook(openProjectSlug, file));
  };

  const openProject = async (projectSlug: string) => {
    setOpenProjectSlug(projectSlug);
    setProjectPhase('image-canvas');
    setPhaseViewMode('canvas');
    workspace.resetForProjectOpen();
    setError(null);
  };

  const closeProject = () => {
    setOpenProjectSlug('');
    setProjectPhase('image-canvas');
    setLayoutEditorNavigation(null);
    workspace.resetForProjectClose();
  };

  const handleProjectPhaseChange = useCallback((phase: ProjectPhase) => {
    setProjectPhase(phase);
    if (phase !== 'layout-editor') {
      setLayoutEditorNavigation(null);
    }
    setPhaseViewMode(phase === 'image-canvas' ? 'canvas' : 'list');
    workspace.resetForPhaseChange();
  }, [workspace.resetForPhaseChange]);

  // Deep link from a task panel anywhere in the app to its session in the
  // Agent dashboard (agent session ids equal pi task ids).
  const openAgentSession = useCallback((sessionId: string) => {
    setAgentFocusSessionId(sessionId);
    handleProjectPhaseChange('chat');
  }, [handleProjectPhaseChange]);

  useEffect(() => {
    if (!openProjectSlug) return;
    const workspacePhaseByKey: Record<string, ProjectPhase> = {
      t: 'story',
      l: 'layout-editor',
      c: 'image-canvas',
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) return;
      const phase = workspacePhaseByKey[event.key.toLowerCase()];
      if (!phase) return;
      event.preventDefault();
      handleProjectPhaseChange(phase);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleProjectPhaseChange, openProjectSlug]);

  if (!openProjectSlug) {
    return (
      <>
        <ProjectLanding
          projects={projects}
          error={error}
          onOpen={openProject}
          onCreated={async (nextSlug) => {
            await loadProjects();
            await openProject(nextSlug);
          }}
          onImported={async () => {
            await loadProjects();
          }}
          onOpenSettings={() => setShowSettingsModal(true)}
        />
        {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} />}
      </>
    );
  }

  const isAgentDashboardActive = projectPhase === 'chat';
  const isConceptArtActive = projectPhase === 'concept-art';
  const isLayoutEditorActive = projectPhase === 'layout-editor';
  const isStoryActive = projectPhase === 'story';
  const isStoryPanelPhaseActive = isLayoutEditorActive || isStoryActive;
  const bookAlreadyRead = adaptation?.hasBookSession ?? false;
  const readBookTopBarControl = isStoryActive && storyHasBookText ? (() => {
    const button = (
      <button
        className="generate-button project-top-bar-read-book"
        type="button"
        onClick={() => void startReadBook()}
        disabled={isReadingBook || bookAlreadyRead}
      >
        {isReadingBook ? 'Reading book…' : 'Read book'}
      </button>
    );
    return bookAlreadyRead && !isReadingBook ? (
      <HoverTooltip text="Book already read" placement="bottom">
        {button}
      </HoverTooltip>
    ) : button;
  })() : null;
  const isWorkspaceHubActive = isAgentDashboardActive || isConceptArtActive || projectPhase === 'characters-hub' || projectPhase === 'locations-hub';
  const showProjectTopBar = Boolean(openProjectSlug && (isPhaseSidebarCollapsed || isCanvasActive || isStoryPanelPhaseActive || isWorkspaceHubActive));

  const phaseViewToggle = (label: string) => (
    <div className="phase-view-toggle project-top-bar-view-toggle" role="tablist" aria-label={label}>
      <button
        type="button"
        role="tab"
        aria-selected={phaseViewMode !== 'canvas'}
        className={clsx(phaseViewMode !== 'canvas' && 'is-active')}
        onClick={() => setPhaseViewMode('list')}
      >
        List
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={phaseViewMode === 'canvas'}
        className={clsx(phaseViewMode === 'canvas' && 'is-active')}
        onClick={() => setPhaseViewMode('canvas')}
      >
        Canvas
      </button>
    </div>
  );

  const charactersHubViewToggle = projectPhase === 'characters-hub'
    ? phaseViewToggle('Characters view')
    : projectPhase === 'locations-hub'
      ? phaseViewToggle('Locations view')
      : null;
  const conceptArtViewToggle = projectPhase === 'concept-art' ? phaseViewToggle('Concept art view') : null;

  const exportBookletPdf = async (pageBorder: BookletPageBorder = exportPageBorder) => {
    if (!openProjectSlug) return;
    setIsExportingPdf(true);
    setError(null);
    try {
      const blob = await api.getStoryPanelsBookletPdf(openProjectSlug, { pageBorder });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `${openProjectSlug}-comic-booklet.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      setShowExportPdfModal(false);
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="app">
      <ProjectPhaseSidebar
        project={currentProject}
        projectSlug={openProjectSlug}
        activePhase={projectPhase}
        projectTags={workspace.userTagsForOrganize}
        tagAssetCounts={workspace.tagAssetCounts}
        error={error}
        isCollapsed={isPhaseSidebarCollapsed}
        onToggleCollapsed={() => setIsPhaseSidebarCollapsed((current) => !current)}
        onBack={closeProject}
        onDeleteProject={async () => {
          await api.deleteProject(openProjectSlug);
          await loadProjects();
          closeProject();
        }}
        onResetStoryPanelLayout={async () => {
          try {
            await api.resetStoryPanelLayout(openProjectSlug);
            setStoryPanelRecoveryKey((current) => current + 1);
            setError(null);
          } catch (err) {
            setError(formatRequestError(err));
            throw err;
          }
        }}
        onResetStoryPanelChunks={async () => {
          try {
            await api.resetStoryPanelChunks(openProjectSlug);
            setStoryPanelRecoveryKey((current) => current + 1);
            setError(null);
          } catch (err) {
            setError(formatRequestError(err));
            throw err;
          }
        }}
        onResetCharacterData={async () => {
          try {
            await api.resetCharacterData(openProjectSlug);
            await loadAdaptation();
            await workspace.loadProject(openProjectSlug);
            setError(null);
          } catch (err) {
            setError(formatRequestError(err));
            throw err;
          }
        }}
        onExportAssets={async () => {
          if (!currentProject) return;
          setError(null);
          try {
            const detail = await api.getProject(openProjectSlug, true);
            await exportProjectAssetsToFolder(openProjectSlug, currentProject.name, detail.assets);
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
        onExportPdf={() => setShowExportPdfModal(true)}
        exportingPdf={isExportingPdf}
        onDeleteTag={workspace.deleteProjectTag}
        onUpdateTag={workspace.updateProjectTag}
        onPhaseChange={handleProjectPhaseChange}
      />
      <main
        ref={workspace.canvasRef}
        className={clsx(
          'canvas',
          !isCanvasActive && 'story-adaptation-view',
          isPhaseSidebarCollapsed && 'has-collapsed-sidebar',
          showProjectTopBar && 'has-canvas-top-bar',
          workspace.isDraggingFile && 'dragging-file',
        )}
        onDragOver={(event) => {
          if (!isCanvasActive) return;
          event.preventDefault();
          workspace.setIsDraggingFile(true);
        }}
        onDragLeave={(event) => {
          if (!isCanvasActive) return;
          if (event.currentTarget === event.target) workspace.setIsDraggingFile(false);
        }}
        onDrop={async (event) => {
          if (!isCanvasActive) return;
          event.preventDefault();
          workspace.setIsDraggingFile(false);
          await workspace.importFiles(event.dataTransfer.files, workspace.flowPositionFromClientPoint({ x: event.clientX, y: event.clientY }));
        }}
        onContextMenu={(event) => {
          if (!isCanvasActive) return;
          event.preventDefault();
          workspace.setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {showProjectTopBar && (
          <ProjectTopBar
            activePhase={projectPhase}
            sidebarCollapsed={isPhaseSidebarCollapsed}
            onPhaseChange={handleProjectPhaseChange}
            onExpandSidebar={() => setIsPhaseSidebarCollapsed(false)}
            onCollapseSidebar={() => setIsPhaseSidebarCollapsed(true)}
            showPanelChunksToggle={isStoryActive}
            panelChunksOpen={storyPanelChunksOpen}
            onTogglePanelChunks={() => setStoryPanelChunksOpen((open) => !open)}
            showAutoPlaceToggle={isStoryActive}
            autoPlaceEnabled={storyAutoPlaceEnabled}
            onAutoPlaceChange={(enabled) => {
              writeAutoPlaceEnabled(enabled);
              setStoryAutoPlaceEnabled(enabled);
            }}
            endLeadingContent={readBookTopBarControl}
            endContent={(
              <>
                {charactersHubViewToggle}
                {conceptArtViewToggle}
                {isCanvasActive ? (
                  <FloatingTagsMenu
                    userAvailableTags={workspace.availableUserTags}
                    characterAvailableTags={characterEntityTags(workspace.projectTags)}
                    locationAvailableTags={locationEntityTags(workspace.projectTags)}
                    userTagCounts={workspace.userTagCounts}
                    entityTagCounts={workspace.entityTagCounts}
                    activeUserTags={workspace.activeUserTagFilters}
                    activeEntityTags={workspace.activeEntityTagFilters}
                    showArchived={workspace.showArchived}
                    isOpen={workspace.isUserTagFilterMenuOpen}
                    onToggleOpen={() => workspace.setIsUserTagFilterMenuOpen((current) => !current)}
                    onClose={() => workspace.setIsUserTagFilterMenuOpen(false)}
                    onUserTagsChange={workspace.setActiveUserTagFilters}
                    onEntityTagsChange={workspace.setActiveEntityTagFilters}
                    onShowArchivedChange={workspace.setShowArchived}
                  />
                ) : null}
                {!online && (
                  <span className="offline-pill" title="Generation and agent tasks need a network connection">
                    Offline
                  </span>
                )}
                <button
                  type="button"
                  className="icon-button"
                  title="Settings"
                  aria-label="Settings"
                  onClick={() => setShowSettingsModal(true)}
                >
                  ⚙
                </button>
              </>
            )}
          />
        )}
        {readBookTask.state !== null && (
          <div className="pi-task-panel-float">
            <PiTaskPanel
              title="Read book"
              state={readBookTask.state}
              events={readBookTask.events}
              error={readBookTask.error}
              onAbort={() => void readBookTask.abort()}
              onDismiss={readBookTask.dismiss}
              onOpenSession={readBookTask.taskId ? () => openAgentSession(readBookTask.taskId!) : undefined}
            />
          </div>
        )}
        {isAgentDashboardActive && adaptation && (
          <AgentDashboardView
            projectSlug={openProjectSlug}
            onReloadAdaptation={loadAdaptation}
            onOpenPhase={handleProjectPhaseChange}
            focusSessionId={agentFocusSessionId}
            onFocusSessionHandled={() => setAgentFocusSessionId(null)}
          />
        )}
        {isConceptArtActive && adaptation && (
          <ConceptArtView
            projectSlug={openProjectSlug}
            adaptation={adaptation}
            assets={workspace.assets}
            canvas={workspace.canvas}
            viewMode={phaseViewMode === 'canvas' ? 'canvas' : 'list'}
            onConceptCanvasUpdate={workspace.handleConceptCanvasUpdate}
            onFocusNode={workspace.focusConceptNode}
            onDeleteNode={workspace.performDeleteNodeById}
            onReloadProject={async () => {
              await workspace.loadProject(openProjectSlug);
              await loadAdaptation();
            }}
            onReloadAdaptation={loadAdaptation}
            onOpenAgentSession={openAgentSession}
          />
        )}
        {(projectPhase === 'characters-hub' || projectPhase === 'locations-hub') && adaptation && (
          <EntityHubView
            key={projectPhase}
            kind={projectPhase === 'locations-hub' ? 'location' : 'character'}
            projectSlug={openProjectSlug}
            adaptation={adaptation}
            assets={workspace.assets}
            canvas={workspace.canvas}
            projectTags={workspace.projectTags}
            viewMode={phaseViewMode === 'canvas' ? 'canvas' : 'list'}
            onDraftVariantToCanvas={projectPhase === 'locations-hub'
              ? workspace.draftLocationVariantToCanvas
              : workspace.draftCharacterVariantToCanvas}
            onOpenChatForAsset={workspace.openChatForAsset}
            onViewAsset={workspace.openAssetInViewer}
            onCreateTag={workspace.createProjectTag}
            onPatchAssetTags={workspace.patchAssetTags}
            onReloadProject={async () => {
              await workspace.loadProject(openProjectSlug);
              await loadAdaptation();
            }}
            onOpenAgentSession={openAgentSession}
          />
        )}
        {isStoryActive && (
          <BookTextView
            key={`story-${openProjectSlug}-${storyPanelRecoveryKey}`}
            projectSlug={openProjectSlug}
            panelChunksOpen={storyPanelChunksOpen}
            onPanelChunksOpenChange={setStoryPanelChunksOpen}
            onHasBookTextChange={setStoryHasBookText}
            autoPlaceEnabled={storyAutoPlaceEnabled}
            onNavigateToLayoutEditor={(navigation) => {
              setLayoutEditorNavigation(navigation);
              setProjectPhase('layout-editor');
            }}
            onImportBook={importAdaptationBook}
            onPanelDraftedToCanvas={workspace.handlePanelDraftedToCanvas}
            onOpenAgentSession={openAgentSession}
          />
        )}
        {isLayoutEditorActive && (
          <LayoutEditorView
            key={`layout-${openProjectSlug}-${storyPanelRecoveryKey}`}
            projectSlug={openProjectSlug}
            initialNavigation={layoutEditorNavigation}
            onNavigationComplete={() => setLayoutEditorNavigation(null)}
            onPanelDraftedToCanvas={workspace.handlePanelDraftedToCanvas}
            onOpenAgentSession={openAgentSession}
          />
        )}
        {isCanvasActive && <CanvasFlowSurface workspace={workspace} />}
      </main>
      {isCanvasActive && (
        <CanvasPanels
          workspace={workspace}
          projectSlug={openProjectSlug}
          adaptation={adaptation}
          currentProject={currentProject}
        />
      )}
      {openProjectSlug && showExportPdfModal && (
        <Modal title="Export comic booklet PDF" onClose={() => !isExportingPdf && setShowExportPdfModal(false)} dialogClassName="confirm-dialog-modal" hideHeader>
            <h2 id="export-booklet-title">Export comic booklet PDF</h2>
            <p className="muted">Landscape letter sheets with saddle-stitch imposition. Print duplex on the long edge, fold, and staple on the center crease.</p>
            <fieldset className="story-panels-export-options">
              <legend>Page outline border</legend>
              {BOOKLET_PAGE_BORDER_OPTIONS.map((option) => (
                <label key={option.value} className="story-panels-export-option">
                  <input
                    type="radio"
                    name="booklet-page-border"
                    value={option.value}
                    checked={exportPageBorder === option.value}
                    disabled={isExportingPdf}
                    onChange={() => setExportPageBorder(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={isExportingPdf} onClick={() => setShowExportPdfModal(false)}>Cancel</button>
              <button type="button" disabled={isExportingPdf} onClick={() => void exportBookletPdf(exportPageBorder)}>
                {isExportingPdf ? 'Exporting...' : 'Export PDF'}
              </button>
            </div>
        </Modal>
      )}
      {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} />}
    </div>
  );
}

installTestHooks();
installInstallPromptCapture();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
