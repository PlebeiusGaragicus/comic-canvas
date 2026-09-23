import { useEffect, useState } from 'react';
import { api } from '../api';
import { HelpTip, Modal } from '../ui';
import { HubCardMenu } from '../conceptArt/HubCardMenu';
import type { VisualStyleDefinition } from '../types';

export const DEFAULT_VISUAL_STYLE_TEMPLATE = `Style:
Color palette:
Realism:
Lighting:
`;

function visualStylePromptPreview(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) return 'Empty style snippet';
  const firstLine = trimmed.split('\n').map((line) => line.trim()).find(Boolean) ?? trimmed;
  return firstLine.replace(/^Style:\s*/i, '').trim() || trimmed;
}

export function VisualStyleList({
  projectSlug,
  styles,
  onReload,
}: {
  projectSlug: string;
  styles: VisualStyleDefinition[];
  onReload: () => Promise<void>;
}) {
  const [editingStyle, setEditingStyle] = useState<VisualStyleDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftPrompt, setDraftPrompt] = useState(DEFAULT_VISUAL_STYLE_TEMPLATE);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VisualStyleDefinition | null>(null);

  const openCreate = () => {
    setDraftName('');
    setDraftPrompt(DEFAULT_VISUAL_STYLE_TEMPLATE);
    setCreating(true);
  };

  const openEdit = (style: VisualStyleDefinition) => {
    setDraftName(style.name);
    setDraftPrompt(style.prompt);
    setEditingStyle(style);
  };

  const saveCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    setIsSaving(true);
    try {
      await api.createVisualStyle(projectSlug, { name, prompt: draftPrompt });
      setCreating(false);
      await onReload();
    } finally {
      setIsSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editingStyle) return;
    const name = draftName.trim();
    if (!name) return;
    setIsSaving(true);
    try {
      await api.updateVisualStyle(projectSlug, editingStyle.id, { name, prompt: draftPrompt });
      setEditingStyle(null);
      await onReload();
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsSaving(true);
    try {
      await api.deleteVisualStyle(projectSlug, pendingDelete.id);
      setPendingDelete(null);
      await onReload();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="visual-style-panel">
      <header className="visual-style-panel-head">
        <div className="archetype-card-title">
          <h2>Visual Styles</h2>
          <HelpTip text="Reusable style snippets appended to canvas image prompts when you pick a style on a draft or image." />
        </div>
        <button type="button" onClick={openCreate}>Add style</button>
      </header>
      {styles.length === 0 ? (
        <p className="muted visual-style-empty">No visual styles yet. Add one to reuse a consistent look across generated images.</p>
      ) : (
        <div className="visual-style-chip-grid">
          {styles.map((style) => (
            <article
              key={style.id}
              className={`visual-style-chip ${style.default ? 'is-default' : ''}`}
            >
              <div className="visual-style-chip-head">
                <h3 title={style.name}>{style.name}</h3>
                {style.default ? <span className="visual-style-default-badge">Default</span> : null}
                <HubCardMenu
                  disabled={isSaving}
                  ariaLabel={`${style.name} style actions`}
                  onEdit={() => openEdit(style)}
                  onSetDefault={style.default ? undefined : async () => {
                    setIsSaving(true);
                    try {
                      await api.updateVisualStyle(projectSlug, style.id, { default: true });
                      await onReload();
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                  onDelete={() => setPendingDelete(style)}
                />
              </div>
              <button
                type="button"
                className="visual-style-chip-preview"
                title={style.prompt.trim() || 'Empty style snippet'}
                onClick={() => openEdit(style)}
              >
                {visualStylePromptPreview(style.prompt)}
              </button>
            </article>
          ))}
        </div>
      )}
      {creating && (
        <Modal title="Add visual style" onClose={() => !isSaving && setCreating(false)}>
          <label className="field-label">
            Name
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
          </label>
          <label className="field-label">
            Style snippet
            <textarea className="modal-textarea" value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} rows={10} />
          </label>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setCreating(false)} disabled={isSaving}>Cancel</button>
            <button className="generate-button" onClick={saveCreate} disabled={isSaving || !draftName.trim()}>{isSaving ? 'Saving...' : 'Create style'}</button>
          </div>
        </Modal>
      )}
      {editingStyle && (
        <Modal title={`Edit ${editingStyle.name}`} onClose={() => !isSaving && setEditingStyle(null)}>
          <label className="field-label">
            Name
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
          </label>
          <label className="field-label">
            Style snippet
            <textarea className="modal-textarea" value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} rows={10} />
          </label>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setEditingStyle(null)} disabled={isSaving}>Cancel</button>
            <button className="generate-button" onClick={saveEdit} disabled={isSaving || !draftName.trim()}>{isSaving ? 'Saving...' : 'Save style'}</button>
          </div>
        </Modal>
      )}
      {pendingDelete && (
        <Modal title="Delete visual style?" onClose={() => !isSaving && setPendingDelete(null)}>
          <p>Remove <strong>{pendingDelete.name}</strong>? Existing images keep their recorded style id; drafts may reference a missing style.</p>
          <div className="modal-actions">
            <button className="danger" onClick={confirmDelete} disabled={isSaving}>{isSaving ? 'Deleting...' : 'Delete style'}</button>
            <button className="secondary" onClick={() => setPendingDelete(null)} disabled={isSaving}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

