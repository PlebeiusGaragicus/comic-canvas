import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { api } from '../api';
import { formatRequestError } from '../formatError';
import { PiTaskPanel } from '../sessions/PiTaskPanel';
import { usePiTask } from '../sessions/usePiTask';
import { VisualStyleList } from '../visualStyles/VisualStyleList';
import type { Asset, AdaptationStatus, CanvasDocument, ConceptArtSubjectKind, ConceptCard } from '../types';
import { assetImageUrl, assetThumbnailUrl } from '../shared/assetUrls';

function conceptCardTag(cardId: string) {
  return `concept-card-${cardId.toLowerCase()}`;
}

function conceptCardTitle(card: ConceptCard) {
  if (card.displayName.trim()) return card.displayName.trim();
  const firstLine = card.prompt.trim().split('\n').find(Boolean);
  if (firstLine) return firstLine.slice(0, 80);
  return card.id.replace(/^card_/, 'Concept');
}

function subjectLabel(subjectKind: ConceptArtSubjectKind | null) {
  return subjectKind === 'location' ? 'Location' : subjectKind === 'character' ? 'Character' : 'Concept';
}

/** All assets linked to a card, newest-signal first (canvas nodes, tags, card record). */
function assetsForCard(card: ConceptCard, assets: Asset[], assetsById: Map<string, Asset>, canvas: CanvasDocument): Asset[] {
  const cardTag = conceptCardTag(card.id);
  const orderedIds: string[] = [];
  const addId = (assetId: string | null | undefined) => {
    if (assetId && !orderedIds.includes(assetId)) orderedIds.push(assetId);
  };

  Object.values(canvas.nodes).forEach((node) => {
    if ((node.origin?.kind !== 'conceptCard' || node.origin.id !== card.id) && !node.tags.includes(cardTag)) return;
    addId(node.activeAssetId);
    node.assetIds.forEach(addId);
  });
  assets.filter((asset) => asset.tags.includes(cardTag)).forEach((asset) => addId(asset.id));
  addId(card.activeAssetId);
  card.assetIds.forEach(addId);

  return orderedIds
    .map((assetId) => assetsById.get(assetId) ?? null)
    .filter((asset): asset is Asset => Boolean(asset));
}

function promptTextareaRows(text: string) {
  const lines = text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 90)), 0);
  return Math.min(14, Math.max(4, lines + 1));
}

export function ConceptArtView({
  projectSlug,
  adaptation,
  assets,
  canvas,
  viewMode,
  onConceptCanvasUpdate,
  onReloadProject,
  onReloadAdaptation,
  onOpenAgentSession,
}: {
  projectSlug: string;
  adaptation: AdaptationStatus;
  assets: Asset[];
  canvas: CanvasDocument;
  viewMode: 'list' | 'canvas';
  onConceptCanvasUpdate: (canvasDoc: CanvasDocument, nodeId?: string) => void;
  onFocusNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onReloadProject: () => Promise<void>;
  onReloadAdaptation: () => Promise<void>;
  onOpenAgentSession: (sessionId: string) => void;
}) {
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const [conceptCards, setConceptCards] = useState<ConceptCard[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingConcept, setDeletingConcept] = useState(false);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSubjectKind, setEditSubjectKind] = useState<ConceptArtSubjectKind>('character');
  const [editPrompt, setEditPrompt] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [uploadingCard, setUploadingCard] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const editingCard = editingCardId ? conceptCards.find((card) => card.id === editingCardId) ?? null : null;

  const loadConceptCards = useCallback(async () => {
    const cards = await api.listConceptCards(projectSlug, true);
    setConceptCards(cards);
  }, [projectSlug]);

  useEffect(() => {
    void loadConceptCards().catch((err) => setError(formatRequestError(err)));
  }, [loadConceptCards]);

  const openEditModal = (card: ConceptCard) => {
    setEditingCardId(card.id);
    setEditName(card.displayName);
    setEditSubjectKind(card.subjectKind);
    setEditPrompt(card.prompt);
    setModalError(null);
    setError(null);
  };

  const closeEditModal = () => {
    if (savingEdit || uploadingCard) return;
    setEditingCardId(null);
    setModalError(null);
  };

  const createConcept = async (subjectKind: ConceptArtSubjectKind) => {
    const busyId = `__create-${subjectKind}__`;
    setBusyKey(busyId);
    setError(null);
    try {
      const created = await api.createConceptCard(projectSlug, { subjectKind });
      await loadConceptCards();
      setConceptCards((cards) => (cards.some((card) => card.id === created.id) ? cards : [created, ...cards]));
      openEditModal(created);
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const onSuggestFinished = useCallback(async () => {
    await loadConceptCards();
    await onReloadAdaptation();
  }, [loadConceptCards, onReloadAdaptation]);
  const characterSuggestTask = usePiTask(projectSlug, 'suggest-concept-character', onSuggestFinished);
  const locationSuggestTask = usePiTask(projectSlug, 'suggest-concept-location', onSuggestFinished);

  const uploadCardImage = async (cardId: string, file: File) => {
    setUploadingCard(true);
    setModalError(null);
    try {
      const updated = await api.uploadConceptCardImage(projectSlug, cardId, file);
      setConceptCards((cards) => cards.map((card) => (card.id === updated.id ? updated : card)));
      await onReloadProject();
    } catch (err) {
      setModalError(formatRequestError(err));
    } finally {
      setUploadingCard(false);
    }
  };

  const draftConceptCard = async (cardId: string) => {
    setBusyKey(cardId);
    setError(null);
    setModalError(null);
    try {
      const result = await api.draftConceptCard(projectSlug, cardId);
      setEditingCardId(null);
      onConceptCanvasUpdate(result.canvas, result.nodeId);
    } catch (err) {
      setModalError(formatRequestError(err));
      setError(formatRequestError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const deleteConceptCard = async (cardId: string) => {
    setBusyKey(cardId);
    setDeletingConcept(true);
    setError(null);
    try {
      await api.deleteConceptCard(projectSlug, cardId);
      await loadConceptCards();
      setPendingDeleteId(null);
      setEditingCardId((current) => (current === cardId ? null : current));
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setBusyKey(null);
      setDeletingConcept(false);
    }
  };

  const saveEditCard = async () => {
    if (!editingCard) return;
    setSavingEdit(true);
    setModalError(null);
    try {
      const updated = await api.updateConceptCard(projectSlug, editingCard.id, {
        displayName: editName,
        prompt: editPrompt,
        subjectKind: editSubjectKind,
      });
      setConceptCards((cards) => cards.map((card) => (card.id === updated.id ? updated : card)));
      setEditingCardId(null);
    } catch (err) {
      setModalError(formatRequestError(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleArchiveCard = async (card: ConceptCard) => {
    setSavingEdit(true);
    setModalError(null);
    try {
      const updated = await api.updateConceptCard(projectSlug, card.id, { archived: card.archivedAt === null || card.archivedAt === undefined });
      setConceptCards((cards) => cards.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setModalError(formatRequestError(err));
      setError(formatRequestError(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const conceptWorkflowBusy = characterSuggestTask.isActive || locationSuggestTask.isActive;
  const visibleCards = useMemo(
    () => conceptCards.filter((card) => showArchived || !card.archivedAt),
    [conceptCards, showArchived],
  );
  const characterCards = visibleCards.filter((card) => card.subjectKind === 'character');
  const locationCards = visibleCards.filter((card) => card.subjectKind !== 'character');
  const archivedCount = conceptCards.filter((card) => card.archivedAt).length;

  const conceptChrome = (
    <>
      {viewMode === 'list' && (
        <div className="concept-art-styles-panel">
          <VisualStyleList
            projectSlug={projectSlug}
            styles={adaptation.visualStyles}
            onReload={onReloadProject}
          />
        </div>
      )}
      <header className="layout-view-toolbar concept-art-toolbar">
        <div className="concept-art-toolbar-groups">
          <div className="concept-art-toolbar-group">
            <span className="concept-art-toolbar-label">Character</span>
            <div className="concept-art-toolbar-actions">
              <button
                type="button"
                onClick={() => void createConcept('character')}
                disabled={busyKey === '__create-character__' || conceptWorkflowBusy}
              >
                {busyKey === '__create-character__' ? 'Creating...' : 'New'}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => void characterSuggestTask.start()}
                disabled={!adaptation.hasBookSession || conceptWorkflowBusy}
              >
                {characterSuggestTask.isActive ? 'Suggesting...' : 'Suggest'}
              </button>
            </div>
          </div>
          <div className="concept-art-toolbar-group">
            <span className="concept-art-toolbar-label">Location</span>
            <div className="concept-art-toolbar-actions">
              <button
                type="button"
                onClick={() => void createConcept('location')}
                disabled={busyKey === '__create-location__' || conceptWorkflowBusy}
              >
                {busyKey === '__create-location__' ? 'Creating...' : 'New'}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => void locationSuggestTask.start()}
                disabled={!adaptation.hasBookSession || conceptWorkflowBusy}
              >
                {locationSuggestTask.isActive ? 'Suggesting...' : 'Suggest'}
              </button>
            </div>
          </div>
          {viewMode === 'list' && archivedCount > 0 && (
            <div className="concept-art-toolbar-group">
              <span className="concept-art-toolbar-label">Archived</span>
              <div className="concept-art-toolbar-actions">
                <button
                  className={clsx('secondary', showArchived && 'is-active')}
                  type="button"
                  onClick={() => setShowArchived((value) => !value)}
                >
                  {showArchived ? `Hide archived (${archivedCount})` : `Show archived (${archivedCount})`}
                </button>
              </div>
            </div>
          )}
        </div>
      </header>
      {error && <p className="error error-banner layout-view-error">{error}</p>}
      {characterSuggestTask.state !== null && (
        <PiTaskPanel
          title="Suggest character concept"
          state={characterSuggestTask.state}
          events={characterSuggestTask.events}
          error={characterSuggestTask.error}
          onAbort={() => void characterSuggestTask.abort()}
          onDismiss={characterSuggestTask.dismiss}
          onOpenSession={characterSuggestTask.taskId ? () => onOpenAgentSession(characterSuggestTask.taskId!) : undefined}
        />
      )}
      {locationSuggestTask.state !== null && (
        <PiTaskPanel
          title="Suggest location concept"
          state={locationSuggestTask.state}
          events={locationSuggestTask.events}
          error={locationSuggestTask.error}
          onAbort={() => void locationSuggestTask.abort()}
          onDismiss={locationSuggestTask.dismiss}
          onOpenSession={locationSuggestTask.taskId ? () => onOpenAgentSession(locationSuggestTask.taskId!) : undefined}
        />
      )}
    </>
  );

  const renderCard = (card: ConceptCard) => {
    const cardAssets = assetsForCard(card, assets, assetsById, canvas);
    const asset = cardAssets[0] ?? null;
    const busy = busyKey === card.id;
    const title = conceptCardTitle(card);
    const archived = Boolean(card.archivedAt);
    return (
      <article
        key={card.id}
        className={clsx('story-card', 'character-hub-card', 'concept-art-card', archived && 'is-archived')}
        onClick={() => openEditModal(card)}
      >
        <div className={clsx('character-hub-thumb', asset && 'has-image')}>
          {asset ? (
            <div className="character-hub-thumb-frame">
              <img src={assetThumbnailUrl(projectSlug, asset)} alt="" />
              <button
                type="button"
                className="character-hub-preview-eye"
                onClick={(event) => {
                  event.stopPropagation();
                  setPreviewAssetId(asset.id);
                }}
                title="View full screen"
                aria-label={`View ${title} full screen`}
              >
                View
              </button>
            </div>
          ) : (
            <p className="muted character-hub-thumb-prompt">{card.prompt.trim() || 'No prompt yet — click to edit.'}</p>
          )}
        </div>
        <div className="character-hub-body">
          <div className="concept-art-card-head">
            <div className="concept-art-card-badges">
              <span className="concept-art-subject-badge">{subjectLabel(card.subjectKind)}</span>
              {archived && <span className="concept-art-archived-badge">Archived</span>}
              {cardAssets.length > 1 && <span className="concept-art-count-badge">{cardAssets.length} images</span>}
            </div>
            <div className="character-hub-card-header">
              <h3>{title}</h3>
            </div>
          </div>
          <div className="character-hub-actions">
            <button
              className="secondary"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void draftConceptCard(card.id);
              }}
              disabled={busy || archived}
            >
              {busy ? 'Drafting...' : 'Draft'}
            </button>
          </div>
        </div>
      </article>
    );
  };

  const renderSection = (label: string, cards: ConceptCard[], subjectKind: ConceptArtSubjectKind) => (
    <section className="concept-art-section">
      <header className="concept-art-section-header">
        <h2>{label}</h2>
        <span className="concept-art-section-count">{cards.length}</span>
      </header>
      {cards.length ? (
        <div className="character-card-grid">{cards.map(renderCard)}</div>
      ) : (
        <div className="concept-art-section-empty">
          <p className="muted">
            No {subjectKind} concepts yet. Use <strong>New</strong> to start one by hand
            {adaptation.hasBookSession ? (
              <>
                {' '}or <strong>Suggest</strong> to let pi invent one from the book.
              </>
            ) : (
              '. Read the book on the Story page to unlock Suggest.'
            )}
          </p>
        </div>
      )}
    </section>
  );

  const editingCardAssets = editingCard ? assetsForCard(editingCard, assets, assetsById, canvas) : [];

  return (
    <>
      {viewMode === 'canvas' ? (
        <div className="concept-art-canvas-chrome">{conceptChrome}</div>
      ) : (
        <div className="story-adaptation-screen story-panels-screen concept-art-screen">
          {conceptChrome}
          <div className="characters-hub-workspace concept-art-workspace">
            {renderSection('Characters', characterCards, 'character')}
            {renderSection('Locations', locationCards, 'location')}
          </div>
        </div>
      )}
      {editingCard && createPortal(
        <div
          className="confirm-backdrop character-edit-modal"
          onClick={closeEditModal}
        >
          <div
            className="confirm-dialog character-edit-dialog concept-art-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="concept-edit-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="concept-art-edit-head">
              <h2 id="concept-edit-title">{conceptCardTitle(editingCard)}</h2>
              <div className="concept-art-edit-head-badges">
                <span className="concept-art-subject-badge">{subjectLabel(editingCard.subjectKind)}</span>
                {editingCard.archivedAt && <span className="concept-art-archived-badge">Archived</span>}
              </div>
            </header>
            {modalError && <p className="error">{modalError}</p>}
            <div className="concept-art-edit-grid">
              <label className="field-stack">
                <span>Name</span>
                <input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  disabled={savingEdit}
                  placeholder={editSubjectKind === 'character' ? 'e.g. Night Watch Pony' : 'e.g. Harbor Fish Market'}
                />
              </label>
              <div className="field-stack concept-art-edit-kind">
                <span>Kind</span>
                <div className="concept-art-kind-toggle" role="group" aria-label="Concept kind">
                  <button
                    type="button"
                    className={clsx('secondary', editSubjectKind === 'character' && 'is-active')}
                    onClick={() => setEditSubjectKind('character')}
                    disabled={savingEdit}
                  >
                    Character
                  </button>
                  <button
                    type="button"
                    className={clsx('secondary', editSubjectKind === 'location' && 'is-active')}
                    onClick={() => setEditSubjectKind('location')}
                    disabled={savingEdit}
                  >
                    Location
                  </button>
                </div>
              </div>
            </div>
            <label className="field-stack">
              <span>Prompt</span>
              <textarea
                value={editPrompt}
                onChange={(event) => setEditPrompt(event.target.value)}
                disabled={savingEdit}
                rows={promptTextareaRows(editPrompt)}
              />
            </label>
            <div className="field-stack concept-art-edit-images">
              <div className="concept-art-edit-images-head">
                <span>Images</span>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploadingCard || savingEdit}
                >
                  {uploadingCard ? 'Uploading...' : 'Upload image'}
                </button>
              </div>
              {editingCardAssets.length ? (
                <div className="concept-art-edit-image-strip">
                  {editingCardAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      className={clsx('concept-art-edit-image', asset.id === editingCard.activeAssetId && 'is-active-image')}
                      onClick={() => setPreviewAssetId(asset.id)}
                      title={asset.id === editingCard.activeAssetId ? 'Active image — click to view' : 'Click to view'}
                    >
                      <img src={assetThumbnailUrl(projectSlug, asset)} alt="" />
                      {asset.id === editingCard.activeAssetId && <span className="concept-art-edit-image-active">Active</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted concept-art-edit-no-images">
                  No images yet. Upload a reference, or draft to the canvas and generate one there.
                </p>
              )}
            </div>
            <div className="row concept-art-edit-actions">
              <button className="primary" disabled={savingEdit || uploadingCard} onClick={() => void saveEditCard()}>
                {savingEdit ? 'Saving...' : 'Save'}
              </button>
              <button className="secondary" disabled={savingEdit || uploadingCard} onClick={closeEditModal}>Cancel</button>
              <span className="concept-art-edit-actions-spacer" />
              <button
                className="secondary"
                type="button"
                disabled={savingEdit || uploadingCard || busyKey === editingCard.id || Boolean(editingCard.archivedAt)}
                onClick={() => void draftConceptCard(editingCard.id)}
              >
                {busyKey === editingCard.id ? 'Drafting...' : 'Draft to canvas'}
              </button>
              <button
                className="secondary"
                type="button"
                disabled={savingEdit || uploadingCard}
                onClick={() => void toggleArchiveCard(editingCard)}
              >
                {editingCard.archivedAt ? 'Unarchive' : 'Archive'}
              </button>
              <button
                className="danger"
                type="button"
                disabled={savingEdit || uploadingCard || deletingConcept}
                onClick={() => setPendingDeleteId(editingCard.id)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (file && editingCardId) {
            void uploadCardImage(editingCardId, file);
          }
        }}
      />
      {pendingDeleteId && createPortal(
        <div
          className="confirm-backdrop character-delete-confirm"
          onClick={() => !deletingConcept && setPendingDeleteId(null)}
        >
          <div
            className="confirm-dialog character-delete-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="concept-delete-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="concept-delete-confirm-title">Delete concept?</h2>
            <p>
              Remove this concept card?
              Generated images in the library are kept.
            </p>
            <div className="row">
              <button
                className="danger"
                disabled={deletingConcept}
                onClick={() => void deleteConceptCard(pendingDeleteId)}
              >
                {deletingConcept ? 'Deleting...' : 'Delete concept'}
              </button>
              <button className="secondary" disabled={deletingConcept} onClick={() => setPendingDeleteId(null)}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {previewAssetId && createPortal(
        <div
          className="archetype-lightbox"
          onClick={() => setPreviewAssetId(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Concept art preview"
        >
          <img
            src={assetsById.get(previewAssetId) ? assetImageUrl(projectSlug, assetsById.get(previewAssetId)!) : undefined}
            alt=""
            onClick={(event) => event.stopPropagation()}
          />
          <button
            type="button"
            className="archetype-lightbox-close"
            onClick={() => setPreviewAssetId(null)}
            aria-label="Close"
          >
            x
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
