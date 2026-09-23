import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from 'reactflow';
import { imageGroupAssetsInNode, nodesToCanvas, omitUndefined, toFlowNodes, withArchivedOnlyAsset, zoomToPercent } from './flowDocument';
import { deletableSelectedNodes, deleteSelectedNodesMessage, deriveStoryGraphEdges, mergeFlowNodes } from './graph';
import { nodeTagActionsRef } from './nodeTagActions';
import {
  SYSTEM_TAGS,
  canDeleteNode,
  canonicalTagsForAsset,
  countEntityTagsOnAssets,
  countUserTagAssignments,
  countUserTagsOnAssets,
  defaultDraftParams,
  isCharacterCanvasNode,
  isConceptTagged,
  mergeAvailableUserTagsOnly,
  userProjectTags,
  visibleDisplayName,
  visibleVariants,
} from './shared';
import type { CanvasNodeData } from './types';
import { api } from '../api';
import { formatRequestError } from '../formatError';
import type { ProjectPhase } from '../projectNavigation';
import { emptyCanvas } from '../shared/canvasDefaults';
import { useDebouncedAsyncCallback } from '../shared/debounce';
import { isEditableShortcutTarget } from '../shared/dom';
import { useDismissOnOutsidePointerDown } from '../shared/popover';
import { useToast } from '../shared/toast';
import type {
  AdaptationStatus,
  AdaptationCanvasImportResponse,
  Asset,
  CanvasDocument,
  ChatSession,
  CanvasNode,
  ChatTurnSettings,
  GeneratePayload,
  GenerationParams,
  Project,
  TagDefinition,
} from '../types';

export interface CanvasWorkspaceDeps {
  openProjectSlug: string;
  projectPhase: ProjectPhase;
  isCanvasActive: boolean;
  adaptation: AdaptationStatus | null;
  setAdaptation: (status: AdaptationStatus | null) => void;
  setError: (message: string | null) => void;
  /** loadProject fetched a fresh project record; reconcile the projects list. */
  onProjectUpdated: (project: Project) => void;
  /** Switch the current phase's view mode to the canvas. */
  onShowCanvasView: () => void;
  /** Navigate to the image-canvas phase with the canvas visible. */
  onGoToImageCanvas: () => void;
}

/**
 * Owns all canvas-view state and behavior: project data (assets, tags, canvas
 * document, chat sessions), React Flow nodes, selection, popovers, the image
 * viewer, generation, import, and delete/archive flows. main.tsx stays the
 * cross-view shell; CanvasFlowSurface/CanvasPanels render from this hook's
 * return value.
 */
export function useCanvasWorkspace({
  openProjectSlug,
  projectPhase,
  isCanvasActive,
  adaptation,
  setAdaptation,
  setError,
  onProjectUpdated,
  onShowCanvasView,
  onGoToImageCanvas,
}: CanvasWorkspaceDeps) {
  const toast = useToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [projectTags, setProjectTags] = useState<TagDefinition[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<CanvasDocument>(emptyCanvas);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [nodes, setNodes] = useState<Node<CanvasNodeData>[]>([]);
  const [generationError, setGenerationError] = useState<{ nodeId: string; message: string } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [popoverNodeId, setPopoverNodeId] = useState<string | null>(null);
  const [pendingConnectionSource, setPendingConnectionSource] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(zoomToPercent(1));
  const [viewerNodeId, setViewerNodeId] = useState<string | null>(null);
  const [viewerAssetId, setViewerAssetId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ nodeId: string; assetId?: string } | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<{ nodeId: string; assetId: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [activeUserTagFilters, setActiveUserTagFilters] = useState<string[]>([]);
  const [activeEntityTagFilters, setActiveEntityTagFilters] = useState<string[]>([]);
  const [isUserTagFilterMenuOpen, setIsUserTagFilterMenuOpen] = useState(false);
  const [generatingNodeIds, setGeneratingNodeIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNodeData> | null>(null);
  const pendingImportPositionRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const generatingNodeIdsRef = useRef<Set<string>>(new Set());
  const chatSessionsRef = useRef<ChatSession[]>([]);
  const persistNodesRef = useRef<(nextNodes: Node<CanvasNodeData>[], options?: { refresh?: boolean }) => Promise<void>>(async () => undefined);
  const assetsRef = useRef<Asset[]>([]);
  const toFlowNodesCallbacksRef = useRef({
    changeVariant: (_nodeId: string, _direction: -1 | 1) => {},
    openViewer: (_nodeId: string) => {},
    openDetails: (_nodeId: string) => {},
    openAssetInViewer: (_assetId: string) => {},
    updateImageGroupDisplayName: (_nodeId: string, _displayName: string) => {},
    openChatForAsset: async (_nodeId: string, _assetId: string) => {},
    createProjectTag: (_tag: TagDefinition) => {},
    projectTags: [] as TagDefinition[],
  });

  useEffect(() => {
    generatingNodeIdsRef.current = generatingNodeIds;
  }, [generatingNodeIds]);

  useEffect(() => {
    chatSessionsRef.current = chatSessions;
  }, [chatSessions]);

  assetsRef.current = assets;

  const onCreateTagForNode = useCallback((tag: TagDefinition) => {
    toFlowNodesCallbacksRef.current.createProjectTag(tag);
  }, []);

  const updateImageGroupDisplayName = useCallback((nodeId: string, displayName: string) => {
    setNodes((current) => {
      const renamedNode = current.find((node) => node.id === nodeId) as Node<CanvasNodeData> | undefined;
      const renamedAssetIds = renamedNode?.data.assetIds ?? [];
      const nextNodes = current.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, displayName } }
          : renamedAssetIds.length
            ? {
                ...node,
                data: {
                  ...node.data,
                  parentDisplayNames: new Map([
                    ...(node.data.parentDisplayNames ?? new Map<string, string>()),
                    ...renamedAssetIds.map((assetId) => [assetId, displayName] as [string, string]),
                  ]),
                },
              }
            : node,
      );
      void persistNodesRef.current(nextNodes, { refresh: false }).catch((err) => {
        console.error('[photo-web] failed to persist image group name', err);
        toast.error(formatRequestError(err));
      });
      return nextNodes;
    });
  }, []);

  const changeVariant = useCallback((nodeId: string, direction: -1 | 1) => {
    setNodes((current) => {
      const next = current.map((node) => {
        if (node.id !== nodeId) return node;
        const variants = visibleVariants(node.data.assets, node.data.assetIds, showArchived);
        if (variants.length < 2) return node;
        const currentId = node.data.activeAsset?.id ?? node.data.activeAssetId ?? '';
        let currentIndex = variants.findIndex((variant) => variant.id === currentId);
        if (currentIndex < 0) currentIndex = 0;
        const nextIndex = (currentIndex + direction + variants.length) % variants.length;
        const activeAsset = variants[nextIndex];
        return { ...node, data: { ...node.data, activeAssetId: activeAsset.id, activeAsset } };
      });
      // Archived mode is a browse view: flipping takes must not rewrite the
      // stored active pointer (the reload on toggle discards the local swap).
      if (!showArchived) void persistNodesRef.current(next);
      return next;
    });
  }, [showArchived]);

  /** Stack manager: make one take the active (displayed, referenced) image.
   *  Archived mode stays a browse view — the swap is local, not persisted. */
  const setActiveTake = useCallback((nodeId: string, assetId: string) => {
    setNodes((current) => {
      const next = current.map((node) => {
        if (node.id !== nodeId || !node.data.assetIds.includes(assetId)) return node;
        const activeAsset = node.data.assets.find((asset) => asset.id === assetId) ?? null;
        return { ...node, data: { ...node.data, activeAssetId: assetId, activeAsset } };
      });
      if (!showArchived) void persistNodesRef.current(next);
      return next;
    });
  }, [showArchived]);

  const openViewer = useCallback((nodeId: string) => {
    setViewerNodeId(nodeId);
    setViewerAssetId(null);
  }, []);

  const focusNodeOnCanvas = useCallback((nodeId: string) => {
    const instance = reactFlowRef.current;
    if (!instance?.viewportInitialized) return;
    const flowNode = instance.getNode(nodeId);
    if (!flowNode) return;
    const width = flowNode.width ?? 280;
    const height = flowNode.height ?? 320;
    instance.setCenter(
      flowNode.position.x + width / 2,
      flowNode.position.y + height / 2,
      { zoom: instance.getZoom(), duration: 350 },
    );
  }, []);

  const openAssetInSidebar = useCallback((assetId: string) => {
    setActiveChatSessionId(null);
    setViewerNodeId(null);
    setViewerAssetId(null);
    setNodes((current) => {
      const targetNode = current.find(
        (node) => node.data.assetIds.includes(assetId),
      ) as Node<CanvasNodeData> | undefined;
      if (!targetNode) {
        setViewerAssetId(assetId);
        return current;
      }
      setPopoverNodeId(targetNode.id);
      const next = current.map((node) => {
        if (node.id !== targetNode.id) return node;
        const activeAsset = node.data.assets.find((asset) => asset.id === assetId) ?? node.data.activeAsset;
        return { ...node, data: { ...node.data, activeAssetId: assetId, activeAsset } };
      });
      void persistNodesRef.current(next);
      return next;
    });
  }, []);

  const openAssetInViewer = useCallback((assetId: string) => {
    setNodes((current) => {
      const targetNode = current.find((node) => node.data.assetIds.includes(assetId)) as Node<CanvasNodeData> | undefined;
      if (!targetNode) {
        setViewerAssetId(assetId);
        setViewerNodeId(null);
        return current;
      }
      setViewerNodeId(targetNode.id);
      setViewerAssetId(null);
      const next = current.map((node) => {
        if (node.id !== targetNode.id) return node;
        const activeAsset = node.data.assets.find((asset) => asset.id === assetId) ?? node.data.activeAsset;
        return { ...node, data: { ...node.data, activeAssetId: assetId, activeAsset } };
      });
      void persistNodesRef.current(next);
      return next;
    });
  }, []);

  const openDetails = useCallback((nodeId: string) => {
    setActiveChatSessionId(null);
    setPopoverNodeId(nodeId);
  }, []);

  const openViewerDetails = useCallback((nodeId: string) => {
    setPopoverNodeId(nodeId);
    setViewerNodeId(null);
  }, []);

  const openChatForAsset = useCallback(async (nodeId: string, assetId: string) => {
    if (!openProjectSlug) return;
    setError(null);
    try {
      const existing = chatSessionsRef.current.find((session) => session.source.assetId === assetId && !session.archivedAt);
      const session = existing ?? await api.createChatSession(openProjectSlug, { sourceAssetId: assetId, canvasNodeId: nodeId });
      setActiveChatSessionId(session.id);
      setPopoverNodeId(null);
      if (!existing) {
        setChatSessions((current) => [...current, session]);
      }
    } catch (err) {
      setError(String(err));
    }
  }, [openProjectSlug, setError]);

  const loadProject = useCallback(async (projectSlug: string) => {
    if (!projectSlug) return;
    await flushCanvasSave();
    const [detail, layout, sessions] = await Promise.all([
      api.getProject(projectSlug, showArchived),
      api.getCanvas(projectSlug, showArchived),
      api.listChatSessions(projectSlug, showArchived),
    ]);
    onProjectUpdated(detail.project);
    setAssets(detail.assets);
    setProjectTags(detail.tags);
    setChatSessions(sessions);
    setCanvas(layout);
    const freshNodes = toFlowNodes(
      layout,
      detail.assets,
      generatingNodeIdsRef.current,
      detail.tags,
      changeVariant,
      openViewer,
      openDetails,
      openAssetInViewer,
      updateImageGroupDisplayName,
      openChatForAsset,
      onCreateTagForNode,
    );
    setNodes((current) => mergeFlowNodes(current, freshNodes));
  }, [changeVariant, openAssetInViewer, openChatForAsset, openDetails, openViewer, onCreateTagForNode, onProjectUpdated, showArchived, updateImageGroupDisplayName]);

  useEffect(() => {
    loadProject(openProjectSlug).catch((err) => setError(String(err)));
  }, [loadProject, openProjectSlug, setError]);

  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsidePointerDown(Boolean(contextMenu), [contextMenuRef], useCallback(() => setContextMenu(null), []));
  useEffect(() => {
    if (!contextMenu) return;
    // React Flow zoom/pan is wheel-driven; don't leave the menu floating detached.
    const closeOnWheel = () => setContextMenu(null);
    window.addEventListener('wheel', closeOnWheel, { passive: true });
    return () => window.removeEventListener('wheel', closeOnWheel);
  }, [contextMenu]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPopoverNodeId(null);
        setIsUserTagFilterMenuOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const availableUserTags = useMemo(() => mergeAvailableUserTagsOnly(projectTags, assets), [assets, projectTags]);
  const userTagsForOrganize = useMemo(() => userProjectTags(projectTags), [projectTags]);
  const userTagCounts = useMemo(() => countUserTagsOnAssets(assets, projectTags, showArchived), [assets, projectTags, showArchived]);
  const entityTagCounts = useMemo(() => countEntityTagsOnAssets(assets, projectTags, showArchived), [assets, projectTags, showArchived]);
  const tagAssetCounts = useMemo(() => countUserTagAssignments(assets, projectTags), [assets, projectTags]);
  const phaseScopedNodes = useMemo(() => {
    if (projectPhase === 'concept-art') {
      return nodes.filter((node) => isConceptTagged(node.data.tags));
    }
    if (projectPhase === 'characters-hub') {
      return nodes.filter((node) => isCharacterCanvasNode(node.data.tags, projectTags));
    }
    return nodes;
  }, [nodes, projectPhase, projectTags]);

  const filteredNodes = useMemo(() => {
    const entityTagFiltered = activeEntityTagFilters.length === 0
      ? phaseScopedNodes
      : phaseScopedNodes.filter((node) => {
          if (!node.data.assetIds.length) return true;
          const required = new Set(activeEntityTagFilters);
          return node.data.assets.some((asset) => asset.tags.some((tag) => required.has(tag)));
        });
    const userTagFiltered = activeUserTagFilters.length === 0
      ? entityTagFiltered
      : entityTagFiltered.filter((node) => {
          if (!node.data.assetIds.length) return true;
          const required = new Set(activeUserTagFilters);
          return node.data.assets.some((asset) => asset.tags.some((tag) => required.has(tag)));
        });
    if (showArchived) {
      return userTagFiltered
        .filter((node) => {
          if (!node.data.assetIds.length) return false;
          return imageGroupAssetsInNode(node.data).some((asset) => asset.archivedAt);
        })
        .map((node) => withArchivedOnlyAsset(node));
    }
    return userTagFiltered.filter((node) => {
      if (!node.data.assetIds.length) return true;
      return imageGroupAssetsInNode(node.data).some((asset) => !asset.archivedAt);
    });
  }, [activeEntityTagFilters, activeUserTagFilters, phaseScopedNodes, showArchived]);

  const edges: Edge[] = useMemo(() => {
    return deriveStoryGraphEdges(filteredNodes);
  }, [filteredNodes]);

  const selectedNode = useMemo(() => {
    const node = nodes.find((item) => item.id === popoverNodeId) ?? null;
    if (!node || !showArchived) return node;
    return withArchivedOnlyAsset(node);
  }, [nodes, popoverNodeId, showArchived]);
  const activeChatSession = useMemo(
    () => chatSessions.find((session) => session.id === activeChatSessionId) ?? null,
    [activeChatSessionId, chatSessions],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  // Coalesce layout writes: local state updates immediately, the network
  // write trails by 600ms and is flushed before any server-side canvas read.
  const { call: scheduleCanvasSave, flush: flushCanvasSave } = useDebouncedAsyncCallback(async (next: CanvasDocument) => {
    if (!openProjectSlug) return;
    try {
      const saved = await api.saveCanvas(openProjectSlug, next);
      setCanvas(saved);
    } catch (err) {
      console.error('[photo-web] failed to save canvas layout', err);
      toast.error(formatRequestError(err));
    }
  }, 600);

  const saveLayout = useCallback(async (_: React.MouseEvent, draggedNode?: Node<CanvasNodeData>) => {
    if (!openProjectSlug) return;
    const currentNodes = draggedNode ? nodes.map((node) => (node.id === draggedNode.id ? draggedNode : node)) : nodes;
    setNodes(currentNodes);
    scheduleCanvasSave(nodesToCanvas(canvas, currentNodes));
  }, [canvas, nodes, openProjectSlug, scheduleCanvasSave]);

  const reload = async () => loadProject(openProjectSlug);

  // Deleting a node always means the same thing regardless of where it came
  // from: with takes, delete the given (or active) take; the node goes when
  // its stack empties. Concept cards are separate domain objects deleted from
  // their own view.
  const performDeleteNodeById = useCallback((nodeId: string, assetId?: string) => {
    const nodeToDelete = nodes.find((node) => node.id === nodeId);
    if (!canDeleteNode(nodeToDelete, projectTags)) return;
    const hasTakes = (nodeToDelete?.data.assetIds.length ?? 0) > 0;
    const assetIdsToDelete = nodeToDelete && hasTakes
      ? [assetId ?? nodeToDelete.data.activeAsset?.id ?? nodeToDelete.data.activeAssetId ?? nodeToDelete.data.assetIds[0]].filter((id): id is string => Boolean(id))
      : [];
    if (hasTakes) {
      void Promise.all(assetIdsToDelete.map((assetId) => api.deleteAsset(openProjectSlug, assetId)))
        .then(() => loadProject(openProjectSlug))
        .catch((err) => {
          console.error('[photo-web] failed to delete image asset', err);
          toast.error(formatRequestError(err));
        });
    }
    setNodes((current) => {
      const next = hasTakes
        ? current
            .map((node) => {
              if (node.id !== nodeId) return node;
              const nextAssetIds = node.data.assetIds.filter((id) => !assetIdsToDelete.includes(id));
              if (!nextAssetIds.length) return null;
              const nextActiveAssetId = nextAssetIds.includes(node.data.activeAssetId ?? '') ? node.data.activeAssetId : nextAssetIds[0];
              const nextAssets = node.data.assets.filter((asset) => nextAssetIds.includes(asset.id));
              const nextActiveAsset = nextAssets.find((asset) => asset.id === nextActiveAssetId) ?? nextAssets[0] ?? null;
              return { ...node, data: { ...node.data, assetIds: nextAssetIds, activeAssetId: nextActiveAssetId, assets: nextAssets, activeAsset: nextActiveAsset } };
            })
            .filter((node): node is Node<CanvasNodeData> => Boolean(node))
        : current.filter((node) => node.id !== nodeId);
      void persistNodesRef.current(next);
      return next;
    });
    setSelectedNodeIds((current) => current.filter((id) => id !== nodeId));
    setPopoverNodeId((current) => (current === nodeId ? null : current));
  }, [loadProject, nodes, openProjectSlug, projectTags]);

  const deleteNodeById = useCallback((nodeId: string, assetId?: string) => {
    const nodeToDelete = nodes.find((node) => node.id === nodeId);
    if (!canDeleteNode(nodeToDelete, projectTags)) {
      const tagNames = canonicalTagsForAsset(nodeToDelete?.data.activeAsset?.id, projectTags)
        .map((tag) => tag.name)
        .join(', ');
      toast.error(`This is the canonical image for ${tagNames} — pick a new canonical first.`);
      return;
    }
    setPendingDelete({ nodeId, assetId });
  }, [nodes, projectTags]);

  const requestArchiveImageAsset = useCallback((nodeId: string, assetId: string) => {
    setPendingArchive({ nodeId, assetId });
  }, []);

  const performArchiveImageAsset = useCallback(async (nodeId: string, assetId: string) => {
    if (!openProjectSlug) return;
    try {
      await api.archiveAsset(openProjectSlug, assetId, true);
      setPopoverNodeId((current) => (current === nodeId ? null : current));
      setViewerNodeId((current) => (current === nodeId ? null : current));
      setViewerAssetId((current) => (current === assetId ? null : current));
      setSelectedNodeIds((current) => current.filter((id) => id !== nodeId));
      await loadProject(openProjectSlug);
    } catch (err) {
      console.error('[photo-web] failed to archive image asset', err);
      toast.error(formatRequestError(err));
    }
  }, [loadProject, openProjectSlug]);

  const restoreImageAsset = useCallback(async (nodeId: string, assetId: string) => {
    if (!openProjectSlug) return;
    try {
      await api.archiveAsset(openProjectSlug, assetId, false);
      await loadProject(openProjectSlug);
    } catch (err) {
      console.error('[photo-web] failed to restore image asset', err);
      toast.error(formatRequestError(err));
    }
  }, [loadProject, openProjectSlug]);

  const saveProjectTags = useCallback(async (nextTags: TagDefinition[]) => {
    if (!openProjectSlug) return;
    const uniqueTags = Array.from(new Map(nextTags.map((tag) => [tag.id, tag])).values())
      .sort((first, second) => first.name.localeCompare(second.name));
    setProjectTags(uniqueTags);
    await api.saveProjectTags(openProjectSlug, uniqueTags);
  }, [openProjectSlug]);

  const createProjectTag = useCallback((tag: TagDefinition) => {
    void saveProjectTags([...projectTags.filter((existing) => existing.id !== tag.id), tag]).catch((err) => {
      console.error('[photo-web] failed to save project tags', err);
      toast.error(formatRequestError(err));
    });
  }, [projectTags, saveProjectTags]);

  const updateProjectTag = useCallback((tagId: string, patch: Partial<Pick<TagDefinition, 'name' | 'color'>>) => {
    const current = projectTags.find((tag) => tag.id === tagId);
    if (!current) return;
    const nextTag: TagDefinition = {
      id: current.id,
      name: patch.name?.trim() || current.name,
      color: patch.color ?? current.color,
    };
    void saveProjectTags(projectTags.map((tag) => (tag.id === tagId ? nextTag : tag))).catch((err) => {
      console.error('[photo-web] failed to update project tag', err);
      toast.error(formatRequestError(err));
    });
  }, [projectTags, saveProjectTags]);

  const deleteProjectTag = useCallback(async (tagId: string) => {
    if (!openProjectSlug) return;
    if (projectTags.find((tag) => tag.id === tagId)?.locked) return;
    const nextProjectTags = projectTags.filter((tag) => tag.id !== tagId);
    const affectedAssets = assets.filter((asset) => asset.tags.includes(tagId));
    setActiveUserTagFilters((current) => current.filter((tag) => tag !== tagId));
    setProjectTags(nextProjectTags);
    setAssets((current) => current.map((asset) => (
      asset.tags.includes(tagId) ? { ...asset, tags: asset.tags.filter((tag) => tag !== tagId) } : asset
    )));
    setNodes((current) => current.map((node) => {
      const nextAssets = node.data.assets.map((asset) => (
        asset.tags.includes(tagId) ? { ...asset, tags: asset.tags.filter((tag) => tag !== tagId) } : asset
      ));
      const nextActiveAsset = node.data.activeAsset?.tags.includes(tagId)
        ? { ...node.data.activeAsset, tags: node.data.activeAsset.tags.filter((tag) => tag !== tagId) }
        : node.data.activeAsset;
      return { ...node, data: { ...node.data, assets: nextAssets, activeAsset: nextActiveAsset } };
    }));
    try {
      await api.saveProjectTags(openProjectSlug, nextProjectTags);
      await Promise.all(affectedAssets.map((asset) => (
        api.patchDisplay(openProjectSlug, asset.id, asset.title, asset.tags.filter((tag) => tag !== tagId))
      )));
    } catch (err) {
      console.error('[photo-web] failed to delete project tag', err);
      toast.error(formatRequestError(err));
      await loadProject(openProjectSlug);
    }
  }, [assets, loadProject, openProjectSlug, projectTags]);

  const updateAssetTags = useCallback((nodeId: string, assetId: string, nextTags: string[]) => {
    if (!openProjectSlug) return;
    const asset = assetsRef.current.find((item) => item.id === assetId);
    if (!asset) return;
    setAssets((current) => current.map((item) => (item.id === assetId ? { ...item, tags: nextTags } : item)));
    setNodes((current) => current.map((node) => {
      if (!node.data.assetIds.includes(assetId)) return node;
      const nextAssets = node.data.assets.map((item) => (item.id === assetId ? { ...item, tags: nextTags } : item));
      const nextActiveAsset = node.data.activeAsset?.id === assetId ? { ...node.data.activeAsset, tags: nextTags } : node.data.activeAsset;
      return { ...node, data: { ...node.data, assets: nextAssets, activeAsset: nextActiveAsset } };
    }));
    void api.patchDisplay(openProjectSlug, assetId, asset.title, nextTags).catch((err) => {
      console.error('[photo-web] failed to update asset tags', err);
      toast.error(formatRequestError(err));
    });
  }, [openProjectSlug]);

  const updatePartitionedAssetTags = useCallback((
    nodeId: string,
    assetId: string,
    userTags: string[],
    characterTags: string[],
    locationTags: string[],
  ) => {
    const asset = assetsRef.current.find((item) => item.id === assetId);
    if (!asset) return;
    const preserved = asset.tags.filter((tag) => SYSTEM_TAGS.has(tag));
    updateAssetTags(nodeId, assetId, Array.from(new Set([...preserved, ...userTags, ...characterTags, ...locationTags])));
  }, [updateAssetTags]);

  const patchAssetTags = useCallback(async (assetId: string, nextTags: string[]) => {
    if (!openProjectSlug) return;
    const asset = assetsRef.current.find((item) => item.id === assetId);
    if (!asset) return;
    setAssets((current) => current.map((item) => (item.id === assetId ? { ...item, tags: nextTags } : item)));
    setNodes((current) => current.map((node) => {
      if (!node.data.assetIds.includes(assetId)) return node;
      const nextAssets = node.data.assets.map((item) => (item.id === assetId ? { ...item, tags: nextTags } : item));
      const nextActiveAsset = node.data.activeAsset?.id === assetId ? { ...node.data.activeAsset, tags: nextTags } : node.data.activeAsset;
      return { ...node, data: { ...node.data, assets: nextAssets, activeAsset: nextActiveAsset } };
    }));
    await api.patchDisplay(openProjectSlug, assetId, asset.title, nextTags);
  }, [openProjectSlug]);

  const saveProjectTagName = useCallback(async (tagId: string, name: string) => {
    if (!openProjectSlug) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const tags = await api.getProjectTags(openProjectSlug);
    const current = tags.find((tag) => tag.id === tagId);
    if (!current || current.name === trimmed) return;
    const nextTags = tags.map((tag) => (tag.id === tagId ? { ...tag, name: trimmed } : tag));
    setProjectTags(nextTags);
    await api.saveProjectTags(openProjectSlug, nextTags);
  }, [openProjectSlug]);

  /** Reset per-project canvas selection/filter state when a project is opened. */
  const resetForProjectOpen = useCallback(() => {
    setActiveUserTagFilters([]);
    setActiveEntityTagFilters([]);
    setSelectedIds([]);
    setSelectedNodeIds([]);
  }, []);

  /** Clear all project-scoped canvas state when the project is closed. */
  const resetForProjectClose = useCallback(() => {
    setActiveUserTagFilters([]);
    setActiveEntityTagFilters([]);
    setAssets([]);
    setProjectTags([]);
    setChatSessions([]);
    setActiveChatSessionId(null);
    setNodes([]);
    setSelectedIds([]);
    setSelectedNodeIds([]);
    setCanvas(emptyCanvas);
    setContextMenu(null);
    setPopoverNodeId(null);
  }, []);

  const sendChatMessage = async (session: ChatSession, text: string, settings: ChatTurnSettings, attachmentAssetIds: string[]) => {
    if (!openProjectSlug) return;
    const sourceNodeId = session.source.canvasNodeId;
    setError(null);
    try {
      if (sourceNodeId) {
        setGeneratingNodeIds((current) => new Set(current).add(sourceNodeId));
        setNodes((current) => current.map((node) => (node.id === sourceNodeId ? { ...node, data: { ...node.data, isGenerating: true } } : node)));
      }
      const response = await api.sendChatTurn(openProjectSlug, session.id, { text, settings, attachmentAssetIds });
      setChatSessions((current) => current.map((item) => (item.id === response.session.id ? response.session : item)));
      await loadProject(openProjectSlug);
      setActiveChatSessionId(response.session.id);
    } catch (err) {
      const message = formatRequestError(err);
      setError(message);
      throw err;
    } finally {
      if (sourceNodeId) {
        setGeneratingNodeIds((current) => {
          const next = new Set(current);
          next.delete(sourceNodeId);
          return next;
        });
        setNodes((current) => current.map((node) => (node.id === sourceNodeId ? { ...node, data: { ...node.data, isGenerating: false } } : node)));
      }
    }
  };

  const archiveChatSession = async (session: ChatSession) => {
    if (!openProjectSlug) return;
    try {
      const archived = await api.patchChatSession(openProjectSlug, session.id, { archived: true });
      setChatSessions((current) => current.map((item) => (item.id === archived.id ? archived : item)));
      setActiveChatSessionId(null);
      await loadProject(openProjectSlug);
    } catch (err) {
      setError(String(err));
    }
  };

  const flowPositionFromClientPoint = (point: { x: number; y: number }) => {
    const flowPosition = reactFlowRef.current?.screenToFlowPosition(point);
    if (flowPosition) return flowPosition;
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { x: point.x - rect.left, y: point.y - rect.top } : { x: point.x, y: point.y };
  };

  const importFiles = async (files: FileList | File[], position?: { x: number; y: number }) => {
    if (!openProjectSlug || isImporting) return;
    await flushCanvasSave();
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    setIsImporting(true);
    let imported = 0;
    try {
      setError(null);
      for (const [index, file] of images.entries()) {
        try {
          const nextPosition = position ? { x: position.x + (index % 3) * 280, y: position.y + Math.floor(index / 3) * 240 } : undefined;
          await api.importAsset(openProjectSlug, file, nextPosition);
          imported += 1;
        } catch (err) {
          const message = String(err);
          if (message.includes('Already imported')) {
            toast.info(`Skipped ${file.name}: already imported`);
            continue;
          }
          throw err;
        }
      }
      await reload();
      if (imported) toast.success(`Imported ${imported} image${imported === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(formatRequestError(err));
    } finally {
      setIsImporting(false);
    }
  };

  const openImportPicker = () => {
    pendingImportPositionRef.current = contextMenu ? flowPositionFromClientPoint({ x: contextMenu.x, y: contextMenu.y }) : undefined;
    setContextMenu(null);
    fileInputRef.current?.click();
  };

  const updateNode = async (id: string, patch: Partial<CanvasNode>) => {
    const cleanPatch = omitUndefined(patch as Record<string, unknown>) as Partial<CanvasNode>;
    setNodes((current) => {
      const updatedNode = current.find((node) => node.id === id);
      const renamedAssetIds = cleanPatch.displayName !== undefined ? updatedNode?.data.assetIds ?? [] : [];
      const nextNodes = current.map((node) => {
        if (node.id === id) {
          return { ...node, data: { ...node.data, ...cleanPatch } };
        }
        if (cleanPatch.displayName !== undefined && renamedAssetIds.length) {
          return {
            ...node,
            data: {
              ...node.data,
              parentDisplayNames: new Map([
                ...(node.data.parentDisplayNames ?? new Map<string, string>()),
                ...renamedAssetIds.map((assetId) => [assetId, cleanPatch.displayName ?? ''] as [string, string]),
              ]),
            },
          };
        }
        return node;
      });
      persistNodes(nextNodes, { refresh: false }).catch((err) => {
        console.error('[photo-web] failed to persist node update', err);
        toast.error(formatRequestError(err));
      });
      return nextNodes;
    });
  };

  const persistNodes = useCallback(async (nextNodes: Node<CanvasNodeData>[], options: { refresh?: boolean } = {}) => {
    if (!openProjectSlug) return;
    const next = nodesToCanvas(canvas, nextNodes);
    if (!(options.refresh ?? true)) {
      scheduleCanvasSave(next);
      return;
    }
    await flushCanvasSave();
    const saved = await api.saveCanvas(openProjectSlug, next);
    setCanvas(saved);
    if (options.refresh ?? true) {
      const callbacks = toFlowNodesCallbacksRef.current;
      setNodes(toFlowNodes(
        saved,
        assets,
        generatingNodeIdsRef.current,
        callbacks.projectTags,
        callbacks.changeVariant,
        callbacks.openViewer,
        callbacks.openDetails,
        callbacks.openAssetInViewer,
        callbacks.updateImageGroupDisplayName,
        callbacks.openChatForAsset,
        onCreateTagForNode,
      ));
    }
  }, [assets, canvas, flushCanvasSave, onCreateTagForNode, openProjectSlug, scheduleCanvasSave]);

  useEffect(() => {
    persistNodesRef.current = persistNodes;
  }, [persistNodes]);

  toFlowNodesCallbacksRef.current = {
    changeVariant,
    openViewer,
    openDetails,
    openAssetInViewer,
    updateImageGroupDisplayName,
    openChatForAsset,
    createProjectTag,
    projectTags,
  };
  nodeTagActionsRef.updatePartitionedAssetTags = updatePartitionedAssetTags;
  nodeTagActionsRef.createProjectTag = createProjectTag;

  useEffect(() => {
    setNodes((current) => current.map((node) => {
      return {
        ...node,
        data: {
          ...node.data,
          projectTags,
          onCreateTag: onCreateTagForNode,
        },
      };
    }));
  }, [onCreateTagForNode, projectTags]);

  const requestDeleteSelectedNodes = useCallback(() => {
    if (!selectedNodeIds.length) return;
    const deletableNodes = deletableSelectedNodes(nodes, selectedNodeIds, projectTags);
    if (!deletableNodes.length) {
      toast.error('The selection holds canonical images — pick new canonicals first.');
      return;
    }
    const imageNodeCount = deletableNodes.filter((node) => node.data.assetIds.length > 0).length;
    setPendingBulkDelete(deleteSelectedNodesMessage(selectedNodeIds.length, deletableNodes.length, imageNodeCount));
  }, [nodes, projectTags, selectedNodeIds]);

  const deleteSelectedNodes = useCallback(async () => {
    if (!selectedNodeIds.length) return;
    await flushCanvasSave();
    const deletableNodes = deletableSelectedNodes(nodes, selectedNodeIds, projectTags);
    if (!deletableNodes.length) return;
    const deletable = new Set(deletableNodes.map((node) => node.id));
    const selectedImageNodes = deletableNodes.filter((node) => node.data.assetIds.length > 0);
    const selectedDraftNodes = deletableNodes.filter((node) => node.data.assetIds.length === 0);
    try {
      if (selectedImageNodes.length) {
        await Promise.all(selectedImageNodes.flatMap((node) => node.data.assetIds.map((assetId) => api.archiveAsset(openProjectSlug, assetId, true))));
      }
    } catch (err) {
      console.error('[photo-web] failed to archive selected image assets', err);
      toast.error(formatRequestError(err));
      return;
    }
    const nextNodes = selectedDraftNodes.length
      ? nodes.filter((node) => !selectedDraftNodes.some((draftNode) => draftNode.id === node.id))
      : nodes;
    setNodes(nextNodes);
    setSelectedNodeIds((current) => current.filter((id) => !deletable.has(id)));
    setSelectedIds([]);
    if (popoverNodeId && deletable.has(popoverNodeId)) setPopoverNodeId(null);
    if (selectedDraftNodes.length) {
      await persistNodes(nextNodes);
    }
    await loadProject(openProjectSlug);
  }, [flushCanvasSave, loadProject, nodes, openProjectSlug, persistNodes, popoverNodeId, projectTags, selectedNodeIds]);

  useEffect(() => {
    if (!isCanvasActive) return;
    const deleteOnKey = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target) || !['Backspace', 'Delete'].includes(event.key)) return;
      event.preventDefault();
      requestDeleteSelectedNodes();
    };
    window.addEventListener('keydown', deleteOnKey);
    return () => window.removeEventListener('keydown', deleteOnKey);
  }, [isCanvasActive, requestDeleteSelectedNodes]);

  const createDraftAt = async (
    refs: string[],
    position: { x: number; y: number },
    options: { prompt?: string; params?: GenerationParams; displayName?: string; tags?: string[] } = {},
  ) => {
    const nodeId = `draft_${Date.now()}`;
    const callbacks = toFlowNodesCallbacksRef.current;
    const node: Node<CanvasNodeData> = {
      id: nodeId,
      position,
      type: 'canvasNode',
      data: {
        nodeId,
        displayName: options.displayName ?? '',
        x: position.x,
        y: position.y,
        tags: options.tags ?? [],
        refs: Array.from(new Set(refs)),
        prompt: options.prompt ?? '',
        params: options.params ?? defaultDraftParams,
        visualStyleId: null,
        assetIds: [],
        activeAssetId: null,
        assets: [],
        activeAsset: null,
        projectTags: callbacks.projectTags,
        onVariant: callbacks.changeVariant,
        onView: callbacks.openViewer,
        onDetails: openDetails,
        onDisplayNameChange: callbacks.updateImageGroupDisplayName,
        onCreateTag: onCreateTagForNode,
      },
    };
    const nextNodes = [...nodes, node];
    setNodes(nextNodes);
    setPopoverNodeId(node.id);
    await persistNodes(nextNodes);
  };

  const createLooseDraft = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    void createDraftAt(
      selectedIds,
      rect
        ? { x: Math.max(80, (contextMenu?.x ?? rect.left + 220) - rect.left), y: Math.max(80, (contextMenu?.y ?? rect.top + 160) - rect.top) }
        : { x: 160, y: 160 },
    );
    setContextMenu(null);
  };

  /** "Duplicate as draft": a new node prefilled with the take's recipe. No relationship is recorded. */
  const duplicateAsDraft = async (group: CanvasNodeData, sourceAsset: Asset) => {
    const refs = sourceAsset.generation?.refs ?? [];
    const params = sourceAsset.generation
      ? {
          model: sourceAsset.generation.model,
          aspectRatio: sourceAsset.generation.aspectRatio,
          imageSize: sourceAsset.generation.imageSize,
          seed: null,
          batchCount: 1,
        }
      : defaultDraftParams;
    const sourceNode = nodes.find((node) => node.id === group.nodeId);
    const position = sourceNode
      ? { x: sourceNode.position.x + 220, y: sourceNode.position.y }
      : { x: 180, y: 160 };
    await createDraftAt(refs, position, { prompt: sourceAsset.prompt?.text ?? '', params });
  };

  const reportGenerationFailure = (nodeId: string, err: unknown) => {
    const message = formatRequestError(err);
    setError(message);
    setGenerationError({ nodeId, message });
  };

  const clearGenerationFailure = () => {
    setGenerationError(null);
  };

  /** The one Generate action: run the node's recipe (prompt + refs + params),
   *  optionally overridden from the takes panel; results join the node's stack. */
  const generateFromNode = async (
    id: string,
    node: CanvasNodeData,
    overrides: { params?: GenerationParams; visualStyleId?: string | null } = {},
  ) => {
    await flushCanvasSave();
    const params = overrides.params ?? node.params;
    // The node's fields are the recipe; fall back to the active take's receipt
    // for nodes created before recipes were stored on the node.
    const prompt = node.prompt.trim() ? node.prompt : node.activeAsset?.prompt?.text ?? '';
    const refs = node.refs.length ? node.refs : node.activeAsset?.generation?.refs ?? [];
    // A new take shares the current take's identity: carry its entity tags so
    // the backend auto-attaches those entities' canonical references.
    const activeEntityTags = (node.activeAsset?.tags ?? []).filter((tagId) => (
      projectTags.some((tag) => tag.id === tagId && tag.locked)
    ));
    try {
      clearGenerationFailure();
      setError(null);
      setGeneratingNodeIds((current) => new Set(current).add(id));
      setNodes((current) => current.map((item) => (item.id === id ? { ...item, data: { ...item.data, isGenerating: true } } : item)));
      const payload: GeneratePayload = {
        prompt,
        refs,
        model: params.model,
        aspectRatio: params.aspectRatio,
        imageSize: params.imageSize,
        seed: params.seed,
        batchCount: params.batchCount,
        title: visibleDisplayName(node.displayName) || null,
        tags: Array.from(new Set([...(node.tags ?? []), ...activeEntityTags])),
        canvasNodeId: id,
        visualStyleId: overrides.visualStyleId !== undefined
          ? overrides.visualStyleId ?? null
          : node.visualStyleId ?? adaptation?.defaultVisualStyleId ?? null,
      };
      if (!payload.prompt.trim()) {
        setError('Add a prompt before generating.');
        return;
      }
      if (!payload.visualStyleId) {
        setError('Pick a visual style before generating.');
        return;
      }
      await api.generate(openProjectSlug, payload);
      setPopoverNodeId(id);
      await reload();
    } catch (err) {
      reportGenerationFailure(id, err);
    } finally {
      setGeneratingNodeIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setNodes((current) => current.map((item) => (item.id === id ? { ...item, data: { ...item.data, isGenerating: false } } : item)));
    }
  };

  /** Point an entity tag's canonical reference at an asset (or clear it). */
  const setTagCanonical = async (tagId: string, assetId: string | null) => {
    if (!openProjectSlug) return;
    setProjectTags(await api.setTagCanonical(openProjectSlug, tagId, assetId));
  };
  nodeTagActionsRef.setTagCanonical = (tagId, assetId) => void setTagCanonical(tagId, assetId);

  const setProjectCover = async (assetId: string) => {
    if (!openProjectSlug) return;
    const updated = await api.setProjectCover(openProjectSlug, assetId);
    onProjectUpdated(updated);
  };

  const landVariantDraft = useCallback(async (result: AdaptationCanvasImportResponse) => {
    if (!openProjectSlug) return;
    setCanvas(result.canvas);
    await loadProject(openProjectSlug);
    onShowCanvasView();
    const matchingId = result.nodeId;
    if (!matchingId) return;
    setSelectedNodeIds([matchingId]);
    setPopoverNodeId(matchingId);
    window.setTimeout(() => focusNodeOnCanvas(matchingId), 0);
  }, [focusNodeOnCanvas, loadProject, onShowCanvasView, openProjectSlug]);

  const draftCharacterVariantToCanvas = useCallback(async (characterSlug: string, variantKey: string) => {
    if (!openProjectSlug) return;
    setError(null);
    await landVariantDraft(await api.draftCharacterVariant(openProjectSlug, characterSlug, variantKey));
  }, [landVariantDraft, openProjectSlug, setError]);

  const draftLocationVariantToCanvas = useCallback(async (locationSlug: string, variantKey: string) => {
    if (!openProjectSlug) return;
    setError(null);
    await landVariantDraft(await api.draftLocationVariant(openProjectSlug, locationSlug, variantKey));
  }, [landVariantDraft, openProjectSlug, setError]);

  const handleConceptCanvasUpdate = useCallback((canvasDoc: CanvasDocument, nodeId?: string) => {
    setCanvas(canvasDoc);
    const callbacks = toFlowNodesCallbacksRef.current;
    setNodes(toFlowNodes(
      canvasDoc,
      assetsRef.current,
      generatingNodeIdsRef.current,
      callbacks.projectTags,
      callbacks.changeVariant,
      callbacks.openViewer,
      callbacks.openDetails,
      callbacks.openAssetInViewer,
      callbacks.updateImageGroupDisplayName,
      callbacks.openChatForAsset,
      callbacks.createProjectTag,
    ));
    void loadProject(openProjectSlug);
    if (!nodeId) return;
    onShowCanvasView();
    setSelectedNodeIds([nodeId]);
    setPopoverNodeId(nodeId);
    window.setTimeout(() => focusNodeOnCanvas(nodeId), 0);
  }, [focusNodeOnCanvas, loadProject, onShowCanvasView, openProjectSlug]);

  // A panel prompt was drafted to the canvas: refresh canvas state, jump to
  // the image canvas, and focus the new node.
  const handlePanelDraftedToCanvas = useCallback((canvasDoc: CanvasDocument, nodeId: string) => {
    setCanvas(canvasDoc);
    const callbacks = toFlowNodesCallbacksRef.current;
    setNodes(toFlowNodes(
      canvasDoc,
      assetsRef.current,
      generatingNodeIdsRef.current,
      callbacks.projectTags,
      callbacks.changeVariant,
      callbacks.openViewer,
      callbacks.openDetails,
      callbacks.openAssetInViewer,
      callbacks.updateImageGroupDisplayName,
      callbacks.openChatForAsset,
      callbacks.createProjectTag,
    ));
    void loadProject(openProjectSlug);
    onGoToImageCanvas();
    setSelectedNodeIds([nodeId]);
    setPopoverNodeId(nodeId);
    window.setTimeout(() => focusNodeOnCanvas(nodeId), 0);
  }, [focusNodeOnCanvas, loadProject, onGoToImageCanvas, openProjectSlug]);

  const focusConceptNode = useCallback((nodeId: string) => {
    onShowCanvasView();
    setSelectedNodeIds([nodeId]);
    setPopoverNodeId(nodeId);
    window.setTimeout(() => focusNodeOnCanvas(nodeId), 0);
  }, [focusNodeOnCanvas, onShowCanvasView]);

  /** Called when the workspace phase changes: close canvas popovers/filters. */
  const resetForPhaseChange = useCallback(() => {
    setActiveUserTagFilters([]);
    setActiveEntityTagFilters([]);
    setIsUserTagFilterMenuOpen(false);
    setPopoverNodeId(null);
    setActiveChatSessionId(null);
  }, []);

  const onConnectStart = (_: unknown, params: { nodeId: string | null }) => {
    const sourceNode = nodes.find((node) => node.id === params.nodeId);
    const sourceAssetId = sourceNode?.data.activeAsset?.id ?? null;
    setPendingConnectionSource(sourceAssetId);
  };

  const onConnectEnd = (event: MouseEvent | TouchEvent) => {
    if (!pendingConnectionSource || !(event instanceof MouseEvent)) return;
    const target = event.target as HTMLElement | null;
    const flowNodeElement = target?.closest?.('.react-flow__node') as HTMLElement | null;
    const dropTargetId = flowNodeElement?.dataset.id;
    const dropTarget = dropTargetId ? nodes.find((node) => node.id === dropTargetId && node.data.assetIds.length === 0) : undefined;
    if (dropTarget) {
      const nextNodes = nodes.map((node) =>
        node.id === dropTarget.id
          ? { ...node, data: { ...node.data, refs: Array.from(new Set([...node.data.refs, pendingConnectionSource])) } }
          : node,
      );
      setNodes(nextNodes);
      void persistNodes(nextNodes);
      setPopoverNodeId(dropTarget.id);
    } else {
      const flowPosition = reactFlowRef.current?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      void createDraftAt(
        [pendingConnectionSource],
        flowPosition ?? { x: event.clientX, y: event.clientY },
      );
    }
    setPendingConnectionSource(null);
  };

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const sourceAssetId = sourceNode?.data.activeAsset?.id ?? null;
    if (!sourceAssetId) return;
    const nextNodes = nodes.map((node) =>
      node.id === connection.target && node.data.assetIds.length === 0
        ? { ...node, data: { ...node.data, refs: Array.from(new Set([...node.data.refs, sourceAssetId])) } }
        : node,
    );
    setNodes(nextNodes);
    void persistNodes(nextNodes);
    setPopoverNodeId(connection.target);
  };

  return {
    // project data
    assets,
    projectTags,
    chatSessions,
    canvas,
    loadProject,
    flushCanvasSave,
    // nodes + selection
    nodes,
    filteredNodes,
    edges,
    selectedNode,
    selectedNodeIds,
    onNodesChange,
    saveLayout,
    onConnectStart,
    onConnectEnd,
    onConnect,
    setZoomFromViewport: (zoom: number) => setZoomPercent(zoomToPercent(zoom)),
    zoomPercent,
    reactFlowRef,
    canvasRef,
    fileInputRef,
    pendingImportPositionRef,
    // popovers / chat / viewer
    popoverNodeId,
    setPopoverNodeId,
    setActiveChatSessionId,
    setSelectedNodeIds,
    setSelectedIds,
    setIsUserTagFilterMenuOpen,
    activeChatSession,
    viewerNodeId,
    setViewerNodeId,
    viewerAssetId,
    setViewerAssetId,
    openViewerDetails,
    openAssetInSidebar,
    openAssetInViewer,
    openChatForAsset,
    focusNodeOnCanvas,
    focusConceptNode,
    // drag / import / context menu
    isDraggingFile,
    setIsDraggingFile,
    contextMenu,
    setContextMenu,
    contextMenuRef,
    isImporting,
    importFiles,
    openImportPicker,
    flowPositionFromClientPoint,
    createLooseDraft,
    // node/asset mutations
    updateNode,
    generateFromNode,
    generationError,
    duplicateAsDraft,
    changeVariant,
    setActiveTake,
    deleteNodeById,
    performDeleteNodeById,
    pendingDelete,
    setPendingDelete,
    pendingBulkDelete,
    setPendingBulkDelete,
    deleteSelectedNodes,
    pendingArchive,
    setPendingArchive,
    performArchiveImageAsset,
    requestArchiveImageAsset,
    restoreImageAsset,
    // tags
    availableUserTags,
    userTagsForOrganize,
    userTagCounts,
    entityTagCounts,
    tagAssetCounts,
    activeUserTagFilters,
    setActiveUserTagFilters,
    activeEntityTagFilters,
    setActiveEntityTagFilters,
    isUserTagFilterMenuOpen,
    showArchived,
    setShowArchived,
    createProjectTag,
    updateProjectTag,
    deleteProjectTag,
    saveProjectTagName,
    patchAssetTags,
    updatePartitionedAssetTags,
    // adaptation / project surface
    setTagCanonical,
    setProjectCover,
    draftCharacterVariantToCanvas,
    draftLocationVariantToCanvas,
    handleConceptCanvasUpdate,
    handlePanelDraftedToCanvas,
    // chat
    sendChatMessage,
    archiveChatSession,
    // lifecycle
    resetForProjectOpen,
    resetForProjectClose,
    resetForPhaseChange,
  };
}

export type CanvasWorkspace = ReturnType<typeof useCanvasWorkspace>;
