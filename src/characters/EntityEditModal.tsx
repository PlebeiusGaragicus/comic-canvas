import { useEffect, useState } from 'react';
import { Modal } from '../ui';
import { TagControlButton } from '../canvas/assetTagRow';
import { SYSTEM_TAGS } from '../canvas/shared';
import { slugifyKey, type EntityRecord, type EntityRecordKind } from './characterShared';
import type { usePiTask } from '../sessions/usePiTask';
import type { TagDefinition } from '../types';

type PiTaskController = ReturnType<typeof usePiTask>;

export interface EntityVariantDraft {
  label: string;
  storyContext: string;
  prompt: string;
}

export interface EntityDraft {
  name: string;
  summary: string;
  visualDescription: string;
  /** Characters only; stays '' for locations. */
  performanceNotes: string;
  continuityNotes: string;
  tagIds: string[];
  variants: Record<string, EntityVariantDraft>;
  removedVariants: string[];
}

function draftFromRecord(record: EntityRecord, entityTagId: string): EntityDraft {
  return {
    name: record.name,
    summary: record.summary,
    visualDescription: record.visualDescription,
    performanceNotes: 'performanceNotes' in record ? record.performanceNotes : '',
    continuityNotes: record.continuityNotes,
    tagIds: Array.from(new Set([entityTagId, ...record.userTags])),
    variants: Object.fromEntries(
      Object.entries(record.variants).map(([variantKey, variant]) => [
        variantKey,
        {
          label: variant.label,
          storyContext: variant.storyContext,
          prompt: variant.prompt,
        },
      ]),
    ),
    removedVariants: [],
  };
}

function variantDisplayLabel(variantKey: string, draft: EntityVariantDraft): string {
  if (variantKey === 'base') return 'Base';
  return draft.label.trim() || variantKey
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function sortedVariantKeys(keys: string[]): string[] {
  return [...keys].sort((left, right) => {
    if (left === 'base') return -1;
    if (right === 'base') return 1;
    return left.localeCompare(right);
  });
}

const KIND_TEXT = {
  character: {
    nameLabel: 'Character name',
    emptyHint: 'This character is registered but empty. Extract it to fill in the description and reference-sheet prompts from the book.',
    summaryPlaceholder: 'Who they are and why they matter in the story',
    visualPlaceholder: 'Body, face, clothing, silhouette, recurring visual traits',
    continuityPlaceholder: 'Traits that must stay consistent across panels and variants',
    variantPlaceholder: 'New variant, e.g. "young" or "post-duel"',
    variantEmptyHint: 'No variants yet. Extract with pi, or add a base variant to write a reference-sheet prompt by hand.',
    labelPlaceholder: 'Post-duel',
    storyContextPlaceholder: 'After the duel in chapter 2',
    refinePlaceholder: 'Feedback, e.g. "make her scar more prominent, add a post-duel variant"',
  },
  location: {
    nameLabel: 'Location name',
    emptyHint: 'This location is registered but empty. Extract it to fill in the description and establishing-shot prompts from the book.',
    summaryPlaceholder: 'What this place is and why it matters in the story',
    visualPlaceholder: 'Architecture or landscape, scale, materials, palette, recurring visual features',
    continuityPlaceholder: 'Features that must stay consistent across panels and variants',
    variantPlaceholder: 'New variant, e.g. "after-the-fire"',
    variantEmptyHint: 'No variants yet. Extract with pi, or add a base variant to write an establishing-shot prompt by hand.',
    labelPlaceholder: 'After the fire',
    storyContextPlaceholder: 'After the fire in chapter 5',
    refinePlaceholder: 'Feedback, e.g. "the barn should look older, add an after-the-fire variant"',
  },
} as const;

export function EntityEditModal({
  kind,
  entitySlug,
  record,
  isExtracted,
  hasBookSession,
  projectTags,
  busy,
  extractTask,
  refineTask,
  onSave,
  onDraftVariant,
  onClose,
  onRequestDelete,
  onCreateTag,
}: {
  kind: EntityRecordKind;
  entitySlug: string;
  record: EntityRecord;
  isExtracted: boolean;
  hasBookSession: boolean;
  projectTags: TagDefinition[];
  busy: boolean;
  extractTask: PiTaskController;
  refineTask: PiTaskController;
  onSave: (draft: EntityDraft) => Promise<void>;
  onDraftVariant: (variantKey: string) => Promise<void>;
  onClose: () => void;
  onRequestDelete: () => void;
  onCreateTag: (tag: TagDefinition) => void;
}) {
  const [draft, setDraft] = useState<EntityDraft>(() => draftFromRecord(record, entitySlug));
  const [newVariantKey, setNewVariantKey] = useState('');
  const [refineFeedback, setRefineFeedback] = useState('');
  const text = KIND_TEXT[kind];

  // Re-seed the form when the agent lands an extract/refine result for this record.
  useEffect(() => {
    setDraft(draftFromRecord(record, entitySlug));
  }, [entitySlug, record.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const extracting = extractTask.isActive && extractTask.target === entitySlug;
  const refining = refineTask.isActive && refineTask.target === entitySlug;
  const agentBusy = extracting || refining;

  const setField = (field: keyof EntityDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const setVariantField = (variantKey: string, field: keyof EntityVariantDraft, value: string) => {
    setDraft((current) => ({
      ...current,
      variants: {
        ...current.variants,
        [variantKey]: { ...current.variants[variantKey], [field]: value },
      },
    }));
  };

  const addVariant = () => {
    const key = slugifyKey(newVariantKey || 'variant');
    if (!key || draft.variants[key]) return;
    setDraft((current) => ({
      ...current,
      variants: {
        ...current.variants,
        [key]: {
          label: newVariantKey.trim(),
          storyContext: '',
          prompt: '',
        },
      },
      removedVariants: current.removedVariants.filter((removed) => removed !== key),
    }));
    setNewVariantKey('');
  };

  const removeVariant = (variantKey: string) => {
    setDraft((current) => {
      const variants = { ...current.variants };
      delete variants[variantKey];
      return {
        ...current,
        variants,
        removedVariants: record.variants[variantKey]
          ? Array.from(new Set([...current.removedVariants, variantKey]))
          : current.removedVariants,
      };
    });
  };

  const startExtract = () => {
    void extractTask.start({ target: entitySlug });
  };

  const startRefine = () => {
    const feedback = refineFeedback.trim();
    if (!feedback) return;
    void refineTask.start({ target: entitySlug, instructions: feedback });
    setRefineFeedback('');
  };

  const variantKeys = sortedVariantKeys(Object.keys(draft.variants));

  return (
    <Modal
      title={draft.name || entitySlug}
      dialogClassName="editor-dialog--character-edit"
      onClose={onClose}
    >
      <div className="adaptation-file-form character-edit-form">
        {!isExtracted && (
          <div className="character-edit-agent-row">
            <p className="muted">{text.emptyHint}</p>
            <button
              className="generate-button"
              type="button"
              disabled={!hasBookSession || agentBusy}
              title={hasBookSession ? 'Fill this record from the book with pi' : 'Read the book first (Story view)'}
              onClick={startExtract}
            >
              {extracting ? 'Extracting…' : 'Extract with pi'}
            </button>
          </div>
        )}
        <label className="field-label character-edit-name">
          {text.nameLabel}
          <input
            type="text"
            value={draft.name}
            onChange={(event) => setField('name', event.target.value)}
            placeholder={text.nameLabel}
          />
        </label>
        <div className="field-label">
          Tags
          <div className="character-edit-tags">
            <TagControlButton
              tagIds={draft.tagIds}
              projectTags={projectTags}
              onPartitionedTagsChange={(userTags, characterTags, locationTags) => {
                setDraft((current) => ({
                  ...current,
                  tagIds: Array.from(new Set([
                    ...current.tagIds.filter((tagId) => SYSTEM_TAGS.has(tagId)),
                    ...userTags,
                    entitySlug,
                    ...characterTags.filter((tagId) => tagId !== entitySlug),
                    ...locationTags.filter((tagId) => tagId !== entitySlug),
                  ])),
                }));
              }}
              onCreateTag={onCreateTag}
              className="character-edit-tag-control"
              portaled
            />
          </div>
        </div>
        <label className="field-label">
          Summary
          <textarea
            className="modal-textarea"
            rows={3}
            value={draft.summary}
            onChange={(event) => setField('summary', event.target.value)}
            placeholder={text.summaryPlaceholder}
          />
        </label>
        <label className="field-label">
          Visual description
          <textarea
            className="modal-textarea"
            rows={6}
            value={draft.visualDescription}
            onChange={(event) => setField('visualDescription', event.target.value)}
            placeholder={text.visualPlaceholder}
          />
        </label>
        {kind === 'character' && (
          <label className="field-label">
            Performance notes
            <textarea
              className="modal-textarea"
              rows={4}
              value={draft.performanceNotes}
              onChange={(event) => setField('performanceNotes', event.target.value)}
              placeholder="Temperament, speech, posture, mannerisms — the material expressions are chosen from"
            />
          </label>
        )}
        <label className="field-label">
          Continuity notes
          <textarea
            className="modal-textarea"
            rows={3}
            value={draft.continuityNotes}
            onChange={(event) => setField('continuityNotes', event.target.value)}
            placeholder={text.continuityPlaceholder}
          />
        </label>

        <div className="character-edit-variant-list">
          <h3 className="character-edit-section-heading">Variants</h3>
          {variantKeys.length === 0 && (
            <p className="muted">{text.variantEmptyHint}</p>
          )}
          {variantKeys.map((variantKey) => {
            const variant = draft.variants[variantKey];
            return (
              <div key={variantKey} className="character-edit-variant-item character-edit-variant-card">
                <div className="character-edit-variant-head">
                  <strong>{variantDisplayLabel(variantKey, variant)}</strong>
                  <code className="muted">{variantKey === 'base' ? entitySlug : `${entitySlug}-${variantKey}`}</code>
                  <span className="character-edit-variant-head-actions">
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy || !variant.prompt.trim() || !record.variants[variantKey]?.prompt.trim()}
                      title={record.variants[variantKey]?.prompt.trim()
                        ? 'Create a draft node on the canvas for this look (its sheet becomes this variant’s reference)'
                        : 'Save a prompt first, then draft to canvas'}
                      onClick={() => void onDraftVariant(variantKey)}
                    >
                      Draft to canvas
                    </button>
                    {variantKey !== 'base' && (
                      <button className="secondary" type="button" onClick={() => removeVariant(variantKey)}>
                        Remove
                      </button>
                    )}
                  </span>
                </div>
                {variantKey !== 'base' && (
                  <div className="character-edit-variant-meta">
                    <label className="field-label">
                      Label
                      <input
                        type="text"
                        value={variant.label}
                        onChange={(event) => setVariantField(variantKey, 'label', event.target.value)}
                        placeholder={text.labelPlaceholder}
                      />
                    </label>
                    <label className="field-label">
                      Story context
                      <input
                        type="text"
                        value={variant.storyContext}
                        onChange={(event) => setVariantField(variantKey, 'storyContext', event.target.value)}
                        placeholder={text.storyContextPlaceholder}
                      />
                    </label>
                  </div>
                )}
                <label className="field-label">
                  Image prompt
                  <textarea
                    className="modal-textarea"
                    rows={6}
                    value={variant.prompt}
                    onChange={(event) => setVariantField(variantKey, 'prompt', event.target.value)}
                  />
                </label>
              </div>
            );
          })}
          <div className="character-edit-variant-add">
            <input
              type="text"
              value={newVariantKey}
              onChange={(event) => setNewVariantKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addVariant();
                }
              }}
              placeholder={variantKeys.length ? text.variantPlaceholder : 'base'}
            />
            <button className="secondary" type="button" onClick={addVariant} disabled={!slugifyKey(newVariantKey || 'variant') || Boolean(draft.variants[slugifyKey(newVariantKey || 'variant')])}>
              + variant
            </button>
          </div>
        </div>

        {isExtracted && (
          <div className="character-edit-refine">
            <h3 className="character-edit-section-heading">Refine with pi</h3>
            <div className="character-edit-refine-row">
              <input
                type="text"
                value={refineFeedback}
                onChange={(event) => setRefineFeedback(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    startRefine();
                  }
                }}
                placeholder={text.refinePlaceholder}
                disabled={agentBusy || !hasBookSession}
              />
              <button
                className="secondary"
                type="button"
                onClick={startRefine}
                disabled={agentBusy || !hasBookSession || !refineFeedback.trim()}
                title={hasBookSession ? 'Have pi revise this record against the book' : 'Read the book first (Story view)'}
              >
                {refining ? 'Refining…' : 'Refine'}
              </button>
            </div>
            {refining && <p className="muted">pi is revising this record — the form refreshes when it lands.</p>}
            {refineTask.error && <p className="error">{refineTask.error}</p>}
          </div>
        )}
        {extractTask.error && <p className="error">{extractTask.error}</p>}
      </div>
      <div className="modal-actions character-edit-modal-actions">
        <button onClick={() => void onSave(draft)} disabled={busy || agentBusy || !draft.name.trim()}>
          {busy ? 'Saving...' : 'Save'}
        </button>
        <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="character-edit-actions-spacer" />
        <button className="danger" type="button" disabled={busy || agentBusy} onClick={onRequestDelete}>
          Delete
        </button>
      </div>
    </Modal>
  );
}
