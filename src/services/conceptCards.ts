/** Concept art cards (ported from api/concept_cards.py). */
import type { CanvasNode, ConceptArtSubjectKind, ConceptCard, ConceptCardCreatePayload, ConceptCardPatchPayload, ConceptNodeResponse } from '../types';
import { deleteScopedDoc, getScopedDoc, listScopedDocs, putScopedDoc } from '../store/db';
import { notifyChange } from '../store/changes';
import { newUlid } from './ids';
import { utcNow } from './common';
import { ServiceError, notFound } from './errors';
import { ensureAdaptation } from './adaptation';
import { importAsset, patchDisplay, readAsset } from './assets';
import { nodeTags, readStoredCanvas, writeCanvas } from './canvas';
import { createImageGroupNode, nextCanvasPosition } from './canvasNodes';

export const CONCEPT_TAG = 'concept';

export function conceptCardTag(cardId: string): string {
  return `concept-card-${cardId.toLowerCase()}`;
}

export function conceptTags(subjectKind: ConceptArtSubjectKind): string[] {
  return nodeTags(CONCEPT_TAG, `concept-${subjectKind}`);
}

async function readCardsRaw(slug: string): Promise<ConceptCard[]> {
  await ensureAdaptation(slug);
  return (await listScopedDocs<ConceptCard>('conceptCards', slug)).map((row) => row.doc);
}

async function writeCard(slug: string, card: ConceptCard): Promise<ConceptCard> {
  await putScopedDoc('conceptCards', slug, card.id, card);
  notifyChange('conceptCards', slug);
  return card;
}

export async function listCards(slug: string, includeArchived = false): Promise<ConceptCard[]> {
  const cards = await readCardsRaw(slug);
  return cards
    .filter((card) => includeArchived || !card.archivedAt)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export async function readCard(slug: string, cardId: string): Promise<ConceptCard> {
  await ensureAdaptation(slug);
  const card = await getScopedDoc<ConceptCard>('conceptCards', slug, cardId);
  if (!card) throw notFound(`Concept card not found: ${cardId}`);
  return card;
}

export async function createCard(slug: string, payload: ConceptCardCreatePayload): Promise<ConceptCard> {
  await ensureAdaptation(slug);
  const now = utcNow();
  const card: ConceptCard = {
    version: 1,
    id: newUlid(),
    projectSlug: slug,
    subjectKind: payload.subjectKind,
    displayName: payload.displayName ?? '',
    prompt: payload.prompt || defaultConceptPrompt(payload.subjectKind),
    assetIds: [],
    activeAssetId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  return writeCard(slug, card);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Swap concept-character/concept-location tags on the card's assets and canvas nodes. */
async function retagCardSubject(slug: string, card: ConceptCard, previous: ConceptArtSubjectKind): Promise<void> {
  const oldTag = `concept-${previous}`;
  const newTag = `concept-${card.subjectKind}`;
  const cardTag = conceptCardTag(card.id);
  for (const assetId of card.assetIds) {
    let asset;
    try {
      asset = await readAsset(slug, assetId);
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'not-found') continue;
      throw error;
    }
    if (!asset.tags.includes(cardTag) && !asset.tags.includes(oldTag)) continue;
    await patchDisplay(slug, assetId, { tags: dedupe(asset.tags.map((tag) => (tag === oldTag ? newTag : tag))) });
  }
  const canvas = await readStoredCanvas(slug);
  let changed = false;
  for (const node of Object.values(canvas.nodes) as CanvasNode[]) {
    const ownedByCard = node.origin?.kind === 'conceptCard' && node.origin.id === card.id;
    if (!ownedByCard && !node.tags.includes(cardTag)) continue;
    if (node.tags.includes(oldTag)) {
      node.tags = dedupe(node.tags.map((tag) => (tag === oldTag ? newTag : tag)));
      changed = true;
    }
  }
  if (changed) await writeCanvas(slug, canvas);
}

export async function updateCard(slug: string, cardId: string, payload: ConceptCardPatchPayload): Promise<ConceptCard> {
  const card = await readCard(slug, cardId);
  const previousSubject = card.subjectKind;
  if (payload.displayName !== undefined) card.displayName = payload.displayName;
  if (payload.prompt !== undefined) card.prompt = payload.prompt;
  if (payload.subjectKind !== undefined) card.subjectKind = payload.subjectKind;
  if (payload.archived !== undefined && payload.archived !== null) card.archivedAt = payload.archived ? utcNow() : null;
  card.updatedAt = utcNow();
  await writeCard(slug, card);
  if (payload.subjectKind !== undefined && payload.subjectKind !== previousSubject) {
    await retagCardSubject(slug, card, previousSubject);
  }
  return card;
}

export async function deleteCard(slug: string, cardId: string): Promise<void> {
  await readCard(slug, cardId);
  await deleteScopedDoc('conceptCards', slug, cardId);
  notifyChange('conceptCards', slug);
}

/** Import an image and attach it to an existing card as its active image. */
export async function uploadCardImage(slug: string, cardId: string, file: File): Promise<ConceptCard> {
  const card = await readCard(slug, cardId);
  const title = file.name || `${card.displayName || 'Concept'} upload`;
  const asset = await importAsset(slug, file, { title });
  await patchDisplay(slug, asset.id, {
    tags: dedupe(['comic-adaptation', CONCEPT_TAG, `concept-${card.subjectKind}`, conceptCardTag(card.id)]),
  });
  const existing = await readCard(slug, cardId);
  existing.assetIds = dedupe([...existing.assetIds, asset.id]);
  existing.activeAssetId = asset.id;
  existing.updatedAt = utcNow();
  return writeCard(slug, existing);
}

export async function draftCardToCanvas(slug: string, cardId: string): Promise<ConceptNodeResponse> {
  const card = await readCard(slug, cardId);
  const canvas = await readStoredCanvas(slug);
  const { x, y } = nextCanvasPosition(canvas);
  const { nodeId, canvas: saved } = await createImageGroupNode(slug, {
    displayName: card.displayName,
    tags: nodeTags(...conceptTags(card.subjectKind), conceptCardTag(card.id)),
    prompt: card.prompt,
    refs: [],
    params: { batchCount: 1 },
    x,
    y,
    assetIds: card.assetIds,
    activeAssetId: card.activeAssetId ?? null,
    origin: { kind: 'conceptCard', id: card.id },
  });
  return { nodeId, canvas: saved };
}

export const CHARACTER_SHEET_LAYOUT_BLOCK =
  'Layout: top row — front full-body, three-quarter full-body, back full-body, ' +
  'same neutral standing pose, consistent scale. Bottom row — head close-ups for each expression. ' +
  'White background. No text, no labels, no watermarks.';

export function defaultCharacterReferenceSheetPrompt(): string {
  return `Character reference sheet\n[describe essential visual traits here]\n${CHARACTER_SHEET_LAYOUT_BLOCK}\nExpressions: [list expressions here]`;
}

export function defaultConceptPrompt(subjectKind: ConceptArtSubjectKind): string {
  return subjectKind === 'character' ? defaultCharacterReferenceSheetPrompt() : '';
}

export async function existingConceptSummaries(slug: string): Promise<string[]> {
  const summaries: string[] = [];
  for (const card of await listCards(slug)) {
    const preview = card.prompt.trim() ? card.prompt.trim().split('\n', 1)[0] : card.displayName || card.id;
    summaries.push(`${card.subjectKind}: ${preview}`);
  }
  return summaries;
}
