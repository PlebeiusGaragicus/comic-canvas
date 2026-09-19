import { useEffect, useMemo, useState } from 'react';
import { assetLabel, capabilitiesForModel, defaultDraftParams, modelCapabilities, normalizedParamsForModel } from './shared';
import type { Asset, ChatSession, ChatTurnSettings } from '../types';
import { assetThumbnailUrl } from '../shared/assetUrls';

export function ChatRefinementPanel({
  session,
  assets,
  projectSlug,
  onClose,
  onSend,
  onArchive,
  onViewAsset,
}: {
  session: ChatSession;
  assets: Asset[];
  projectSlug: string;
  onClose: () => void;
  onSend: (session: ChatSession, text: string, settings: ChatTurnSettings, attachmentAssetIds: string[]) => Promise<void>;
  onArchive: (session: ChatSession) => void;
  onViewAsset: (assetId: string) => void;
}) {
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const [text, setText] = useState('');
  const [settings, setSettings] = useState<ChatTurnSettings>(session.defaults);
  const [attachmentAssetIds, setAttachmentAssetIds] = useState<string[]>([]);
  const [isReferencePickerOpen, setIsReferencePickerOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const capabilities = capabilitiesForModel(settings.model);
  const availableReferences = assets.filter((asset) => asset.id !== session.source.assetId && !attachmentAssetIds.includes(asset.id) && !asset.archivedAt);
  useEffect(() => {
    setSettings(session.defaults);
    setAttachmentAssetIds([]);
    setText('');
    setSendError(null);
    setIsSending(false);
  }, [session.id]);
  const send = async () => {
    if (!text.trim() || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      await onSend(session, text.trim(), settings, attachmentAssetIds);
      setText('');
      setAttachmentAssetIds([]);
      setIsReferencePickerOpen(false);
    } catch (err) {
      setSendError(String(err));
    } finally {
      setIsSending(false);
    }
  };
  return (
    <aside className="details-sidebar chat-refinement-panel">
      <div className="popover-header">
        <div>
          <h2>{session.title}</h2>
          <p className="muted">Image refinement chat</p>
        </div>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      <section className="sidebar-section">
        <h3>Source</h3>
        {assetById.get(session.source.assetId) && (
          <button className="asset-picker-row" onClick={() => onViewAsset(session.source.assetId)}>
            <img src={assetThumbnailUrl(projectSlug, assetById.get(session.source.assetId)!)} alt="" />
            <span>{assetLabel(assetById.get(session.source.assetId))}</span>
          </button>
        )}
      </section>
      <section className="sidebar-section chat-message-list">
        <h3>History</h3>
        {session.turns.length === 0 && <p className="muted">No turns yet. Send an instruction to create the first refinement.</p>}
        {session.turns.map((turn) => (
          <div key={turn.id} className={`chat-turn ${turn.role}`}>
            <strong>{turn.role === 'user' ? 'You' : 'Gemini'}</strong>
            {turn.text && <p>{turn.text}</p>}
            {turn.attachments.length > 0 && (
              <div className="chat-thumb-row">
                {turn.attachments.map((attachment) => {
                  const asset = assetById.get(attachment.assetId);
                  return asset ? (
                    <button key={attachment.assetId} className="chat-thumb" onClick={() => onViewAsset(asset.id)} title={assetLabel(asset)}>
                      <img src={assetThumbnailUrl(projectSlug, asset)} alt="" />
                    </button>
                  ) : null;
                })}
              </div>
            )}
            {turn.generatedAssetIds.length > 0 && (
              <div className="chat-thumb-row">
                {turn.generatedAssetIds.map((assetId) => {
                  const asset = assetById.get(assetId);
                  return asset ? (
                    <button key={assetId} className="chat-thumb generated" onClick={() => onViewAsset(assetId)} title={assetLabel(asset)}>
                      <img src={assetThumbnailUrl(projectSlug, asset)} alt="" />
                    </button>
                  ) : null;
                })}
              </div>
            )}
          </div>
        ))}
      </section>
      <section className="sidebar-section generation-section">
        <h3>Turn settings</h3>
        <select value={settings.model} disabled={isSending} onChange={(event) => setSettings((current) => ({ ...normalizedParamsForModel({ ...defaultDraftParams, ...current, batchCount: 1, seed: null }, event.target.value), thinkingLevel: current.thinkingLevel, includeThoughts: false } as ChatTurnSettings))}>
          {Object.keys(modelCapabilities).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <div className="row">
          <select value={settings.aspectRatio} disabled={isSending} onChange={(event) => setSettings((current) => ({ ...current, aspectRatio: event.target.value }))}>
            {capabilities.aspectRatios.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select value={settings.imageSize} disabled={isSending} onChange={(event) => setSettings((current) => ({ ...current, imageSize: event.target.value }))}>
            {capabilities.imageSizes.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <label className="field-label">
          Thinking
          <select value={settings.thinkingLevel ?? ''} disabled={isSending} onChange={(event) => setSettings((current) => ({ ...current, thinkingLevel: event.target.value || null }))}>
            <option value="">Default</option>
            <option value="minimal">Minimal</option>
            <option value="high">High</option>
          </select>
        </label>
      </section>
      <section className="sidebar-section">
        <h3>References for next turn</h3>
        {attachmentAssetIds.length === 0 && <p className="muted">Only the source image will be attached.</p>}
        <div className="parent-list">
          {attachmentAssetIds.map((assetId) => {
            const asset = assetById.get(assetId);
            return asset ? (
              <div className="parent-item" key={assetId}>
                <img src={assetThumbnailUrl(projectSlug, asset)} alt="" />
                <span>{assetLabel(asset)}</span>
                <button className="parent-remove" disabled={isSending} onClick={() => setAttachmentAssetIds((current) => current.filter((id) => id !== assetId))}>×</button>
              </div>
            ) : null;
          })}
        </div>
        <button className="add-parent-button" disabled={isSending} onClick={() => setIsReferencePickerOpen((current) => !current)}>+</button>
        {isReferencePickerOpen && (
          <div className="asset-picker-popover">
            {availableReferences.map((asset) => (
              <button
                className="asset-picker-row"
                key={asset.id}
                disabled={isSending}
                onClick={() => {
                  setAttachmentAssetIds((current) => [...current, asset.id]);
                  setIsReferencePickerOpen(false);
                }}
              >
                {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" /> : <div className="parent-thumb-placeholder" />}
                <span>{assetLabel(asset)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="sidebar-section">
        <textarea className="prompt-textarea" value={text} disabled={isSending} onChange={(event) => setText(event.target.value)} placeholder="Describe the refinement..." />
        {isSending && (
          <div className="chat-generation-status" role="status">
            <span className="spinner" aria-hidden="true" />
            Generating refinement...
          </div>
        )}
        {sendError && <div className="inline-error">Refinement failed: {sendError}</div>}
        <button className="generate-button" onClick={send} disabled={!text.trim() || isSending}>
          {isSending && <span className="spinner" aria-hidden="true" />}
          {isSending ? 'Generating...' : 'Send refinement'}
        </button>
        <button className="secondary" disabled={isSending} onClick={() => onArchive(session)}>Archive chat</button>
      </section>
    </aside>
  );
}
