import { useEffect, useMemo, useRef, useState } from 'react';
import type { Node } from 'reactflow';
import type { AdaptationStatus, Asset, CanvasNode, GenerationParams, TagDefinition, VisualStyleDefinition } from '../types';
import { VisualStyleSelect } from '../visualStyles/VisualStyleSelect';
import { TagControlButton } from './assetTagRow';

import { assetLabel, autoCanonicalRefTags, canonicalTagsForAsset, capabilitiesForModel, defaultDraftParams, modelCapabilities, normalizedParamsForModel, styleEntityTagsOnNode, uniqueOptions, visibleDisplayName, visibleVariants } from './shared';
import type { CanvasNodeData } from './types';

function GenerationErrorNotice({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div className="generation-error-notice" role="alert">
      <strong>Generation failed</strong>
      <p>{message}</p>
    </div>
  );
}

export function NodeSidebar({
  node,
  assets,
  adaptation,
  projectTags,
  coverAssetId,
  onNodeChange,
  onGenerate,
  generationError,
  onSetTagCanonical,
  onSetProjectCover,
  onFindOnCanvas,
  onVariant,
  onSetActiveTake,
  onShowArchived,
  onDuplicate,
  onDelete,
  onArchiveImage,
  onRestoreImage,
  onOpenAsset,
  onPartitionedAssetTagsChange,
  onCreateTag,
  onRefineChat,
  archivedOnly = false,
}: {
  node: Node<CanvasNodeData>;
  assets: Asset[];
  adaptation: AdaptationStatus | null;
  projectTags: TagDefinition[];
  coverAssetId?: string | null;
  onNodeChange: (id: string, patch: Partial<CanvasNode>) => void;
  onGenerate: (id: string, node: CanvasNodeData, overrides?: { params?: GenerationParams; visualStyleId?: string | null }) => void;
  generationError?: string | null;
  onSetTagCanonical: (tagId: string, assetId: string | null) => void;
  onSetProjectCover: (assetId: string) => void;
  onFindOnCanvas: (nodeId: string) => void;
  onVariant: (nodeId: string, direction: -1 | 1) => void;
  onSetActiveTake: (nodeId: string, assetId: string) => void;
  onShowArchived: () => void;
  onDuplicate: (node: CanvasNodeData, sourceAsset: Asset) => void;
  onDelete: (id: string, assetId?: string) => void;
  onArchiveImage: (nodeId: string, assetId: string) => void;
  onRestoreImage: (nodeId: string, assetId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onPartitionedAssetTagsChange: (nodeId: string, assetId: string, userTags: string[], characterTags: string[], locationTags: string[]) => void;
  onCreateTag: (tag: TagDefinition) => void;
  onRefineChat: (nodeId: string, assetId: string) => void;
  archivedOnly?: boolean;
}) {
  if (!node.data.assetIds.length) {
    return (
      <DraftSidebar
        node={node}
        assets={assets}
        projectTags={projectTags}
        visualStyles={adaptation?.visualStyles ?? []}
        defaultVisualStyleId={adaptation?.defaultVisualStyleId}
        onDraftChange={onNodeChange}
        onGenerate={onGenerate}
        onDelete={onDelete}
        generationError={generationError}
      />
    );
  }
  if (!node.data.activeAsset) {
    return (
      <aside className="details-sidebar">
        <h2>Missing image</h2>
        <button className="danger" onClick={() => onDelete(node.id)}>Delete node</button>
      </aside>
    );
  }
  return (
    <ImageSidebar
      node={node}
      asset={node.data.activeAsset}
      assets={assets}
      adaptation={adaptation}
      projectTags={projectTags}
      coverAssetId={coverAssetId}
      onArchiveImage={onArchiveImage}
      onRestoreImage={onRestoreImage}
      onOpenAsset={onOpenAsset}
      onPartitionedAssetTagsChange={onPartitionedAssetTagsChange}
      onCreateTag={onCreateTag}
      onNodeChange={onNodeChange}
      onVariant={onVariant}
      onSetActiveTake={onSetActiveTake}
      onShowArchived={onShowArchived}
      onDuplicate={onDuplicate}
      onGenerate={onGenerate}
      generationError={generationError}
      onSetTagCanonical={onSetTagCanonical}
      onSetProjectCover={onSetProjectCover}
      onFindOnCanvas={onFindOnCanvas}
      onRefineChat={onRefineChat}
      archivedOnly={archivedOnly}
    />
  );
}

function DraftSidebar({
  node,
  assets,
  projectTags,
  visualStyles,
  defaultVisualStyleId,
  onDraftChange,
  onGenerate,
  onDelete,
  generationError,
}: {
  node: Node<CanvasNodeData>;
  assets: Asset[];
  projectTags: TagDefinition[];
  visualStyles: VisualStyleDefinition[];
  defaultVisualStyleId?: string | null;
  onDraftChange: (id: string, patch: Partial<CanvasNode>) => void;
  onGenerate: (id: string, node: CanvasNodeData) => void;
  onDelete: (id: string, assetId?: string) => void;
  generationError?: string | null;
}) {
  const draft = node.data;

  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [isParentPickerOpen, setIsParentPickerOpen] = useState(false);
  const parents = draft.refs.map((ref) => assets.find((asset) => asset.id === ref) ?? null);
  const availableParents = assets.filter((asset) => !draft.refs.includes(asset.id));
  const draftModel = draft.params.model ?? defaultDraftParams.model;
  const draftCapabilities = capabilitiesForModel(draftModel);
  const styleTags = styleEntityTagsOnNode(draft.tags, projectTags);
  const autoRefTags = autoCanonicalRefTags(draft.tags, draft.refs, projectTags);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(visibleDisplayName(draft.displayName));
  useEffect(() => {
    if (!isEditingName) setDraftName(visibleDisplayName(draft.displayName));
  }, [draft.displayName, isEditingName]);
  const saveName = () => {
    onDraftChange(node.id, { displayName: draftName.trim() });
    setIsEditingName(false);
  };
  useEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft.prompt]);
  return (
    <aside className="details-sidebar">
      <div className="popover-header">
        {isEditingName ? (
          <input
            className="sidebar-title-input"
            value={draftName}
            autoFocus
            aria-label="Draft name"
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveName();
              if (event.key === 'Escape') {
                setDraftName(visibleDisplayName(draft.displayName));
                setIsEditingName(false);
              }
            }}
          />
        ) : (
          <h2
            className={`sidebar-title ${visibleDisplayName(draft.displayName) ? '' : 'placeholder'}`}
            onDoubleClick={() => setIsEditingName(true)}
          >
            {visibleDisplayName(draft.displayName) || 'Draft'}
          </h2>
        )}
        <button className="danger" onClick={() => onDelete(node.id)}>Delete</button>
      </div>
      {styleTags.length > 0 && (
        <div className="canvas-role-badge">
          {styleTags.map((tag) => tag.name).join(', ')} anchor
        </div>
      )}
      {styleTags.length > 0 && (
        <p className="muted">
          Generate takes here; the take you keep becomes this style's canonical reference for future generations.
        </p>
      )}
      <section className="sidebar-section parent-section">
        <h3>Parents</h3>
        <div className="parent-list">
          {parents.length === 0 ? (
            <div className="parent-item">
              <div className="parent-thumb-placeholder" />
              <span className="muted">None</span>
            </div>
          ) : parents.map((parent, index) => (
            <div className="parent-item" key={draft.refs[index]}>
              {parent?.thumbnailUrl ? <img src={parent.thumbnailUrl} alt="" /> : <div className="parent-thumb-placeholder" />}
              <span>{visibleDisplayName(draft.parentDisplayNames?.get(draft.refs[index]) ?? '') || assetLabel(parent, 'Unknown parent')}</span>
              <button
                className="parent-remove"
                onClick={() => onDraftChange(node.id, { refs: draft.refs.filter((_, refIndex) => refIndex !== index) })}
                title="Remove parent"
              >
                ×
              </button>
            </div>
          ))}
          {autoRefTags.map((tag) => {
            const canonical = assets.find((asset) => asset.id === tag.canonicalAssetId) ?? null;
            return (
              <div
                className="parent-item auto-canonical-ref"
                key={`auto-${tag.id}`}
                title={`Attached automatically at generation time — canonical image for ${tag.name}. Remove the ${tag.name} tag to detach.`}
              >
                {canonical?.thumbnailUrl ? <img src={canonical.thumbnailUrl} alt="" /> : <div className="parent-thumb-placeholder" />}
                <span><span className="auto-canonical-star">★</span> {tag.name}</span>
              </div>
            );
          })}
        </div>
        <button className="add-parent-button" onClick={() => setIsParentPickerOpen((current) => !current)}>+</button>
        {isParentPickerOpen && (
          <div className="asset-picker-popover">
            {availableParents.length === 0 && <p className="muted">All assets are already parents.</p>}
            {availableParents.map((asset) => (
              <button
                className="asset-picker-row"
                key={asset.id}
                onClick={() => {
                  onDraftChange(node.id, { refs: [...draft.refs, asset.id] });
                  setIsParentPickerOpen(false);
                }}
              >
                {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" /> : <div className="parent-thumb-placeholder" />}
                <span>{visibleDisplayName(draft.parentDisplayNames?.get(asset.id) ?? '') || assetLabel(asset)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <VisualStyleSelect
        styles={visualStyles}
        value={draft.visualStyleId}
        defaultStyleId={defaultVisualStyleId}
        onChange={(styleId) => onDraftChange(node.id, { visualStyleId: styleId })}
      />
      <section className="sidebar-section">
        <label className="field-label">
          Prompt
          <textarea
            ref={promptRef}
            className="prompt-textarea"
            autoFocus
            value={draft.prompt}
            onChange={(event) => onDraftChange(node.id, { prompt: event.target.value })}
            placeholder="Prompt"
          />
        </label>
      </section>
      <section className="sidebar-section generation-section">
        <h3>Parameters</h3>
        <GenerationErrorNotice message={generationError} />
      <div className="row">
        <select
          value={draftModel ?? ''}
          onChange={(event) => onDraftChange(node.id, { params: normalizedParamsForModel(draft.params, event.target.value) })}
        >
          {Object.keys(modelCapabilities).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <input
          value={draft.params.seed ?? ''}
          onChange={(event) =>
            onDraftChange(node.id, { params: { ...draft.params, seed: event.target.value ? Number(event.target.value) : null } })
          }
          placeholder="Seed optional"
        />
      </div>
      <div className="row">
        <select
          value={draft.params.aspectRatio ?? '16:9'}
          onChange={(event) => onDraftChange(node.id, { params: { ...draft.params, aspectRatio: event.target.value } })}
        >
          {draftCapabilities.aspectRatios.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <select value={draft.params.imageSize ?? '1K'} onChange={(event) => onDraftChange(node.id, { params: { ...draft.params, imageSize: event.target.value } })}>
          {draftCapabilities.imageSizes.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <div className="generate-control">
        <button
          className="generate-button"
          onClick={() => onGenerate(node.id, draft)}
          disabled={!draft.prompt.trim() || draft.isGenerating}
        >
          {draft.isGenerating && <span className="spinner" aria-hidden="true" />}
          {draft.isGenerating ? 'Generating...' : 'Generate'}
        </button>
        <label>
          Batch size
          <input
            type="number"
            min={1}
            max={8}
            value={draft.params.batchCount}
            onChange={(event) => onDraftChange(node.id, { params: { ...draft.params, batchCount: Number(event.target.value) } })}
          />
        </label>
      </div>
      </section>
    </aside>
  );
}

function ImageSidebar({
  node,
  asset,
  assets,
  adaptation,
  projectTags,
  coverAssetId,
  onArchiveImage,
  onRestoreImage,
  onOpenAsset,
  onPartitionedAssetTagsChange,
  onCreateTag,
  onNodeChange,
  onVariant,
  onSetActiveTake,
  onShowArchived,
  onDuplicate,
  onGenerate,
  generationError,
  onSetTagCanonical,
  onSetProjectCover,
  onFindOnCanvas,
  onRefineChat,
  archivedOnly = false,
}: {
  node: Node<CanvasNodeData>;
  asset: Asset;
  assets: Asset[];
  adaptation: AdaptationStatus | null;
  projectTags: TagDefinition[];
  coverAssetId?: string | null;
  onArchiveImage: (nodeId: string, assetId: string) => void;
  onRestoreImage: (nodeId: string, assetId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onPartitionedAssetTagsChange: (nodeId: string, assetId: string, userTags: string[], characterTags: string[], locationTags: string[]) => void;
  onCreateTag: (tag: TagDefinition) => void;
  onNodeChange: (id: string, patch: Partial<CanvasNode>) => void;
  onVariant: (nodeId: string, direction: -1 | 1) => void;
  onSetActiveTake: (nodeId: string, assetId: string) => void;
  onShowArchived: () => void;
  onDuplicate: (node: CanvasNodeData, sourceAsset: Asset) => void;
  onGenerate: (id: string, node: CanvasNodeData, overrides?: { params?: GenerationParams; visualStyleId?: string | null }) => void;
  generationError?: string | null;
  onSetTagCanonical: (tagId: string, assetId: string | null) => void;
  onSetProjectCover: (assetId: string) => void;
  onFindOnCanvas: (nodeId: string) => void;
  onRefineChat: (nodeId: string, assetId: string) => void;
  archivedOnly?: boolean;
}) {
  const [isVariantPanelOpen, setIsVariantPanelOpen] = useState(false);
  const [variantParams, setVariantParams] = useState(defaultDraftParams);
  const [variantVisualStyleId, setVariantVisualStyleId] = useState<string | null>(null);
  const prompt = asset.prompt?.text ?? '';
  const refs = asset.generation?.refs ?? [];
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  // Takes whose assets aren't loaded are archived (normal mode loads live assets only).
  const hiddenArchivedCount = node.data.assetIds.filter((takeId) => !assetById.has(takeId)).length;
  const visibleVariantsList = visibleVariants(assets, node.data.assetIds, archivedOnly);
  const activeVariantIndex = Math.max(0, visibleVariantsList.findIndex((variant) => variant.id === asset.id));
  const hasMultipleVariants = visibleVariantsList.length > 1;
  const isGeneratedResult = node.id.startsWith('generated_');
  const styleTags = styleEntityTagsOnNode(node.data.tags, projectTags);
  const canonicalForTags = canonicalTagsForAsset(asset.id, projectTags);
  const isProjectCover = coverAssetId === asset.id;
  const showCanonicalSection = styleTags.length > 0 || canonicalForTags.length > 0;
  const activeModel = isVariantPanelOpen ? variantParams.model ?? asset.generation?.model : asset.generation?.model;
  const activeCapabilities = capabilitiesForModel(activeModel);
  const modelOptions = uniqueOptions(Object.keys(modelCapabilities), asset.generation?.model);
  const aspectRatioOptions = isVariantPanelOpen ? activeCapabilities.aspectRatios : uniqueOptions(activeCapabilities.aspectRatios, asset.generation?.aspectRatio);
  const imageSizeOptions = isVariantPanelOpen ? activeCapabilities.imageSizes : uniqueOptions(activeCapabilities.imageSizes, asset.generation?.imageSize);
  const changeSidebarVariantByClickSide = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!hasMultipleVariants) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const direction = event.clientX < rect.left + rect.width / 2 ? -1 : 1;
    onVariant(node.id, direction);
  };
  useEffect(() => {
    setVariantParams({
      model: asset.generation?.model ?? defaultDraftParams.model,
      aspectRatio: asset.generation?.aspectRatio ?? defaultDraftParams.aspectRatio,
      imageSize: asset.generation?.imageSize ?? defaultDraftParams.imageSize,
      seed: null,
      batchCount: 1,
    });
    setVariantVisualStyleId(asset.generation?.visualStyleId ?? adaptation?.defaultVisualStyleId ?? null);
  }, [adaptation?.defaultVisualStyleId, asset]);
  const isArchived = Boolean(asset.archivedAt);
  return (
    <aside className="details-sidebar">
      <div className="sidebar-action-row">
        {isArchived ? (
          <button className="secondary" onClick={() => onRestoreImage(node.id, asset.id)}>Unarchive</button>
        ) : (
          <button className="secondary" onClick={() => onArchiveImage(node.id, asset.id)}>Archive</button>
        )}
      </div>
      {isArchived && <p className="muted">This variant is archived. Use Tags → Show archived to browse archived items, then unarchive here.</p>}
      {canonicalForTags.length > 0 && (
        <div className="canvas-role-badge">
          Canonical for {canonicalForTags.map((tag) => tag.name).join(', ')}
        </div>
      )}
      {isGeneratedResult && <div className="canvas-role-badge">Generated child image</div>}
      {isGeneratedResult && <p className="muted">This image was generated from a durable source node. Archiving it does not remove the source prompt.</p>}
      <label className="field-label">
        Group name
        <input value={node.data.displayName} onChange={(event) => onNodeChange(node.id, { displayName: event.target.value })} />
      </label>
      <TagControlButton
        tagIds={asset.tags}
        projectTags={projectTags}
        onPartitionedTagsChange={(userTags, characterTags, locationTags) => (
          onPartitionedAssetTagsChange(node.id, asset.id, userTags, characterTags, locationTags)
        )}
        onCreateTag={onCreateTag}
        canonicalAssetId={asset.id}
        onSetCanonical={onSetTagCanonical}
        className="sidebar-tag-controls"
        popoverClassName="split-tag-popover-sidebar"
        portaled
        portaledAlign="right"
      />
      {asset.hasPixels && (
        <div className="sidebar-cover-row">
          <button type="button" className="secondary" onClick={() => onFindOnCanvas(node.id)}>
            Find on canvas
          </button>
          <button type="button" className="secondary" disabled={isProjectCover} onClick={() => onSetProjectCover(asset.id)}>
            {isProjectCover ? 'Project cover' : 'Set as project cover'}
          </button>
        </div>
      )}
      <div className="sidebar-variant-preview" onClick={changeSidebarVariantByClickSide}>
        {asset.thumbnailUrl && <img src={asset.thumbnailUrl} alt="" />}
        <span>{activeVariantIndex + 1} / {visibleVariantsList.length}</span>
        <button
          className="sidebar-preview-eye"
          onClick={(event) => {
            event.stopPropagation();
            node.data.onView(node.id);
          }}
          title="View full image"
        >
          👁️
        </button>
        {hasMultipleVariants && (
          <>
            <button
              className="sidebar-variant-nav previous"
              onClick={(event) => {
                event.stopPropagation();
                onVariant(node.id, -1);
              }}
              title="Previous variant"
            >
              &lt;
            </button>
            <button
              className="sidebar-variant-nav next"
              onClick={(event) => {
                event.stopPropagation();
                onVariant(node.id, 1);
              }}
              title="Next variant"
            >
              &gt;
            </button>
          </>
        )}
      </div>
      {node.data.assetIds.length > 1 && (
        <section className="sidebar-section stack-section">
          <h3>Takes <span className="stack-count">{node.data.assetIds.length}</span></h3>
          <div className="stack-take-list">
            {node.data.assetIds.map((takeId, index) => {
              const take = assetById.get(takeId);
              if (!take) return null;
              const isTakeArchived = Boolean(take.archivedAt);
              const isActiveTake = take.id === asset.id;
              const takeCanonicalFor = canonicalTagsForAsset(take.id, projectTags);
              return (
                <div key={takeId} className={`stack-take ${isActiveTake ? 'is-active' : ''} ${isTakeArchived ? 'is-archived' : ''}`}>
                  <button
                    type="button"
                    className="stack-take-thumb"
                    title={`Take ${index + 1}${isTakeArchived ? ' (archived)' : ''}${takeCanonicalFor.length ? ` — canonical for ${takeCanonicalFor.map((tag) => tag.name).join(', ')}` : ''}`}
                    onClick={() => onSetActiveTake(node.id, take.id)}
                  >
                    {take.thumbnailUrl ? <img src={take.thumbnailUrl} alt="" /> : <div className="parent-thumb-placeholder" />}
                    {takeCanonicalFor.length > 0 && <span className="stack-take-star">★</span>}
                    {isTakeArchived && <span className="stack-take-badge">archived</span>}
                  </button>
                  <button
                    type="button"
                    className="stack-take-action"
                    onClick={() => (isTakeArchived ? onRestoreImage(node.id, take.id) : onArchiveImage(node.id, take.id))}
                  >
                    {isTakeArchived ? 'Restore' : 'Archive'}
                  </button>
                </div>
              );
            })}
          </div>
          {hiddenArchivedCount > 0 && (
            <button type="button" className="stack-archived-chip" onClick={onShowArchived}>
              +{hiddenArchivedCount} archived take{hiddenArchivedCount === 1 ? '' : 's'} — show
            </button>
          )}
        </section>
      )}
      {showCanonicalSection && <section className="sidebar-section canonical-reference-section">
        <h3>Canonical Reference</h3>
        {projectTags.filter((tag) => tag.entityKind === 'style').map((tag) => {
          const isCanonical = tag.canonicalAssetId === asset.id;
          return (
            <button key={tag.id} className="secondary" onClick={() => onSetTagCanonical(tag.id, asset.id)} disabled={isCanonical}>
              {isCanonical ? `Canonical for ${tag.name}` : `★ Make canonical for ${tag.name}`}
            </button>
          );
        })}
      </section>}
      {asset.generation && (
        <section className="sidebar-section parent-section">
          <h3>Parents</h3>
          <div className="parent-list">
            {refs.length === 0 ? (
              <div className="parent-item">
                <div className="parent-thumb-placeholder" />
                <span className="muted">None</span>
              </div>
            ) : refs.map((ref) => {
              const parent = assetById.get(ref);
              const openParent = () => onOpenAsset(ref);
              return (
                <div className="parent-item" key={ref}>
                  {parent?.thumbnailUrl ? (
                    <button
                      type="button"
                      className="parent-thumb-button"
                      onClick={openParent}
                      title={`Open ${assetLabel(parent, 'Parent image')}`}
                    >
                      <img src={parent.thumbnailUrl} alt="" />
                    </button>
                  ) : (
                    <div className="parent-thumb-placeholder" />
                  )}
                  <span>{assetLabel(parent, 'Parent image')}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {asset.generation && (
        <VisualStyleSelect
          styles={adaptation?.visualStyles ?? []}
          value={isVariantPanelOpen ? variantVisualStyleId : asset.generation.visualStyleId}
          defaultStyleId={adaptation?.defaultVisualStyleId}
          disabled={!isVariantPanelOpen}
          onChange={setVariantVisualStyleId}
        />
      )}
      {prompt && (
        <section className="sidebar-section">
          <label className="field-label">
            Prompt
            <textarea className="prompt-textarea locked-field prompt-preview" value={prompt} readOnly />
          </label>
          <button className="generate-button" onClick={() => onRefineChat(node.id, asset.id)}>Refine in chat</button>
          <button className="secondary" onClick={() => onDuplicate(node.data, asset)}>Duplicate as draft</button>
        </section>
      )}
      {asset.generation && (
        <section className="sidebar-section generation-section">
          <h3>Parameters</h3>
          <GenerationErrorNotice message={generationError} />
          <label className="field-label">
            Model
            <select
              value={isVariantPanelOpen ? variantParams.model ?? asset.generation.model : asset.generation.model}
              disabled={!isVariantPanelOpen}
              onChange={(event) => setVariantParams((current) => normalizedParamsForModel(current, event.target.value))}
            >
              {modelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <div className="row">
            <label className="field-label">
              Aspect Ratio
              <select
                value={isVariantPanelOpen ? variantParams.aspectRatio ?? asset.generation.aspectRatio : asset.generation.aspectRatio}
                disabled={!isVariantPanelOpen}
                onChange={(event) => setVariantParams((current) => ({ ...current, aspectRatio: event.target.value }))}
              >
                {aspectRatioOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="field-label">
              Image Size
              <select
                value={isVariantPanelOpen ? variantParams.imageSize ?? asset.generation.imageSize : asset.generation.imageSize}
                disabled={!isVariantPanelOpen}
                onChange={(event) => setVariantParams((current) => ({ ...current, imageSize: event.target.value }))}
              >
                {imageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <div className="row">
            <label className="field-label">
              Seed
              <input
                value={isVariantPanelOpen ? variantParams.seed ?? '' : asset.generation.seed ?? 'auto'}
                readOnly={!isVariantPanelOpen}
                onChange={(event) =>
                  setVariantParams((current) => ({ ...current, seed: event.target.value ? Number(event.target.value) : null }))
                }
                placeholder="Seed optional"
              />
            </label>
          </div>
          {isVariantPanelOpen ? (
            <div className="generate-control">
              <button className="generate-button" onClick={() => onGenerate(node.id, node.data, { params: variantParams, visualStyleId: variantVisualStyleId })} disabled={!prompt.trim() || node.data.isGenerating}>
                {node.data.isGenerating && <span className="spinner" aria-hidden="true" />}
                {node.data.isGenerating ? 'Generating...' : 'Generate variants'}
              </button>
              <button className="secondary" onClick={() => setIsVariantPanelOpen(false)}>Cancel</button>
              <label>
                Batch size
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={variantParams.batchCount}
                  onChange={(event) => setVariantParams((current) => ({ ...current, batchCount: Number(event.target.value) }))}
                />
              </label>
            </div>
          ) : (
            <button className="secondary" onClick={() => setIsVariantPanelOpen(true)} disabled={node.data.isGenerating}>Create variants</button>
          )}
        </section>
      )}
    </aside>
  );
}
