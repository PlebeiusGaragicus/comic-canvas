import ReactFlow, { Controls, Panel } from 'reactflow';
import type { Node } from 'reactflow';
import { ChatRefinementPanel } from './ChatRefinementPanel';
import { maxZoom, minZoom, withArchivedOnlyAsset } from './flowDocument';
import { ImageViewer } from './ImageViewer';
import { nodeTypes } from './nodes';
import { NodeSidebar } from './sidebars';
import type { CanvasNodeData } from './types';
import type { CanvasWorkspace } from './useCanvasWorkspace';
import { ConfirmDialog } from '../ui';
import type { AdaptationStatus, Project } from '../types';

/** The React Flow surface plus import input, context menu, and drop overlay.
 *  Rendered inside the <main> canvas host element. */
export function CanvasFlowSurface({ workspace }: { workspace: CanvasWorkspace }) {
  const ws = workspace;
  return (
    <>
      <input
        ref={ws.fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={async (event) => {
          if (event.target.files) await ws.importFiles(event.target.files, ws.pendingImportPositionRef.current);
          ws.pendingImportPositionRef.current = undefined;
          event.currentTarget.value = '';
        }}
      />
      <ReactFlow
        nodeTypes={nodeTypes}
        nodes={ws.filteredNodes}
        edges={ws.edges}
        edgesFocusable={false}
        edgesUpdatable={false}
        selectNodesOnDrag={false}
        elementsSelectable
        minZoom={minZoom}
        maxZoom={maxZoom}
        onMove={(_, viewport) => ws.setZoomFromViewport(viewport.zoom)}
        onNodesChange={ws.onNodesChange}
        onNodeDragStop={ws.saveLayout}
        onInit={(instance) => {
          ws.reactFlowRef.current = instance;
        }}
        onConnectStart={ws.onConnectStart}
        onConnectEnd={ws.onConnectEnd}
        onConnect={ws.onConnect}
        onNodeClick={(event, node) => {
          const target = event.target;
          if (target instanceof HTMLElement && target.closest('.split-tag-popover, .tag-control-button, .node-tag-menu, .node-tag-row')) {
            return;
          }
          ws.setActiveChatSessionId(null);
          ws.setPopoverNodeId(node.id);
        }}
        onPaneClick={() => {
          ws.setPopoverNodeId(null);
          ws.setIsUserTagFilterMenuOpen(false);
        }}
        onSelectionChange={({ nodes: selected }) => {
          ws.setSelectedNodeIds(selected.map((node) => node.id));
          ws.setSelectedIds(selected.flatMap((node) => (node.data.activeAsset ? [node.data.activeAsset.id] : [])));
        }}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Controls showZoom={false} showInteractive={false} />
        <Panel position="bottom-left" className="zoom-panel">
          {ws.zoomPercent}%
        </Panel>
      </ReactFlow>
      {ws.isDraggingFile && <div className="drop-overlay">Drop photos to import</div>}
      {ws.contextMenu && (
        <div ref={ws.contextMenuRef} className="context-menu" style={{ left: ws.contextMenu.x, top: ws.contextMenu.y }}>
          <button onClick={ws.openImportPicker} disabled={ws.isImporting}>{ws.isImporting ? 'Importing...' : 'Import'}</button>
          <button onClick={ws.createLooseDraft}>Generate</button>
        </div>
      )}
    </>
  );
}

/** Sidebars, chat panel, viewer, and confirm dialogs. Rendered as siblings of
 *  <main> so the details sidebar participates in the .app flex layout. */
export function CanvasPanels({
  workspace,
  projectSlug,
  adaptation,
  currentProject,
}: {
  workspace: CanvasWorkspace;
  projectSlug: string;
  adaptation: AdaptationStatus | null;
  currentProject: Project | undefined;
}) {
  const ws = workspace;
  return (
    <>
      {ws.selectedNode && (
        <NodeSidebar
          node={ws.selectedNode}
          assets={ws.assets}
          adaptation={adaptation}
          projectTags={ws.projectTags}
          coverAssetId={currentProject?.coverAssetId ?? null}
          onNodeChange={ws.updateNode}
          onGenerate={ws.generateFromNode}
          generationError={ws.generationError?.nodeId === ws.selectedNode.id ? ws.generationError.message : null}
          onSetTagCanonical={ws.setTagCanonical}
          onSetProjectCover={ws.setProjectCover}
          onFindOnCanvas={ws.focusNodeOnCanvas}
          onVariant={ws.changeVariant}
          onSetActiveTake={ws.setActiveTake}
          onShowArchived={() => ws.setShowArchived(true)}
          onDuplicate={ws.duplicateAsDraft}
          onDelete={ws.deleteNodeById}
          onArchiveImage={ws.requestArchiveImageAsset}
          onRestoreImage={ws.restoreImageAsset}
          onOpenAsset={ws.openAssetInSidebar}
          onPartitionedAssetTagsChange={ws.updatePartitionedAssetTags}
          onCreateTag={ws.createProjectTag}
          onRefineChat={ws.openChatForAsset}
          archivedOnly={ws.showArchived}
        />
      )}
      {ws.activeChatSession && (
        <ChatRefinementPanel
          session={ws.activeChatSession}
          assets={ws.assets}
          projectSlug={projectSlug}
          onClose={() => ws.setActiveChatSessionId(null)}
          onSend={ws.sendChatMessage}
          onArchive={ws.archiveChatSession}
          onViewAsset={ws.openAssetInViewer}
        />
      )}
      {(ws.viewerNodeId || ws.viewerAssetId) && (
        <ImageViewer
          node={(() => {
            const match = ws.nodes.find((item) => item.id === ws.viewerNodeId && item.data.assetIds.length > 0);
            if (!match) return undefined;
            if (!ws.showArchived) return match;
            return withArchivedOnlyAsset(match);
          })()}
          fallbackAsset={ws.assets.find((asset) => asset.id === ws.viewerAssetId)}
          assets={ws.assets}
          projectSlug={projectSlug}
          projectTags={ws.projectTags}
          coverAssetId={currentProject?.coverAssetId ?? null}
          onClose={() => {
            ws.setViewerNodeId(null);
            ws.setViewerAssetId(null);
          }}
          onVariant={ws.changeVariant}
          onViewAsset={ws.openAssetInViewer}
          onDetails={ws.openViewerDetails}
          onArchiveImage={ws.requestArchiveImageAsset}
          onRestoreImage={ws.restoreImageAsset}
          onPartitionedAssetTagsChange={ws.updatePartitionedAssetTags}
          onCreateTag={ws.createProjectTag}
          onSetProjectCover={ws.setProjectCover}
          archivedOnly={ws.showArchived}
        />
      )}
      {ws.pendingArchive && (
        <ConfirmDialog
          title="Confirm archive"
          body="Archive this variant? Open Tags and choose Show archived to find and restore it."
          confirmLabel="Archive"
          onConfirm={() => {
            void ws.performArchiveImageAsset(ws.pendingArchive!.nodeId, ws.pendingArchive!.assetId);
            ws.setPendingArchive(null);
          }}
          onCancel={() => ws.setPendingArchive(null)}
        />
      )}
      {ws.pendingBulkDelete && (
        <ConfirmDialog
          title="Delete selected nodes"
          body={ws.pendingBulkDelete}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => {
            ws.setPendingBulkDelete(null);
            void ws.deleteSelectedNodes();
          }}
          onCancel={() => ws.setPendingBulkDelete(null)}
        />
      )}
      {ws.pendingDelete && (
        <ConfirmDialog
          title="Confirm delete"
          body={(ws.nodes.find((node) => node.id === ws.pendingDelete!.nodeId)?.data.assetIds.length ?? 0) > 0
            ? 'Remove this empty image node from the canvas?'
            : 'Delete this draft?'}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => {
            ws.performDeleteNodeById(ws.pendingDelete!.nodeId, ws.pendingDelete!.assetId);
            ws.setPendingDelete(null);
          }}
          onCancel={() => ws.setPendingDelete(null)}
        />
      )}
    </>
  );
}
