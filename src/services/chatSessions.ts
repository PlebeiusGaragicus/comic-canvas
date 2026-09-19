/** Persistent Gemini refinement chat (ported from api/chat_sessions.py).
 *  History image parts are stored as `inlineData.dataRef` blob paths and
 *  expanded to base64 only for the request. */
import type { Asset, AssetMetadata, ChatAttachment, ChatSession, ChatTurn, ChatTurnPayload, ChatTurnResponse, ChatTurnSettings, CreateChatSessionPayload } from '../types';
import { deleteScopedDoc, getScopedDoc, listScopedDocs, putScopedDoc } from '../store/db';
import { readBlob, writeBlob } from '../store/blobs';
import { invalidateUrl } from '../store/objectUrls';
import { notifyChange } from '../store/changes';
import { newUlid } from './ids';
import { utcNow } from './common';
import { ServiceError, conflict, notFound } from './errors';
import { requireProject } from './projects';
import { assetImagePath, assetThumbnailPath, readAssetMetadata, writeAssetMetadata } from './assets';
import { attachChatAssetsToCanvas, validateRefs } from './canvas';
import { readSettings } from './settings';
import { imageOps } from '../shared/images';
import { base64ToBytes, bytesToBase64 } from '../shared/base64';
import type { ImageProvider } from '../providers/gemini';

type LoosePart = Record<string, unknown>;
type Content = Record<string, unknown> & { role?: string; parts?: LoosePart[] };

export function sessionDir(slug: string, sessionId: string): string {
  return `projects/${slug}/chat-sessions/${sessionId}`;
}

async function readStored(slug: string, sessionId: string): Promise<ChatSession | null> {
  return (await getScopedDoc<ChatSession>('chatSessions', slug, sessionId)) ?? null;
}

export async function readSession(slug: string, sessionId: string): Promise<ChatSession> {
  const session = await readStored(slug, sessionId);
  if (!session) throw notFound(`Chat session not found: ${sessionId}`);
  return session;
}

export async function writeSession(slug: string, session: ChatSession): Promise<ChatSession> {
  await putScopedDoc('chatSessions', slug, session.id, session);
  notifyChange('chatSessions', slug);
  return session;
}

export async function listSessions(slug: string, includeArchived = false): Promise<ChatSession[]> {
  await requireProject(slug);
  const rows = await listScopedDocs<ChatSession>('chatSessions', slug);
  return rows
    .map((row) => row.doc)
    .filter((session) => includeArchived || !session.archivedAt)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function defaultSettingsForSource(slug: string, sourceAssetId: string): Promise<ChatTurnSettings> {
  const asset = await readAssetMetadata(slug, sourceAssetId);
  const defaults = (await readSettings()).imageDefaults;
  const generation = asset.generation;
  return {
    model: generation?.model ?? defaults.model,
    aspectRatio: generation?.aspectRatio ?? defaults.aspectRatio,
    imageSize: generation?.imageSize ?? defaults.imageSize,
    thinkingLevel: null,
    includeThoughts: false,
  };
}

export async function createSession(slug: string, payload: CreateChatSessionPayload): Promise<ChatSession> {
  await requireProject(slug);
  const source = await readAssetMetadata(slug, payload.sourceAssetId);
  const now = utcNow();
  const defaults = await defaultSettingsForSource(slug, source.id);
  return writeSession(slug, {
    version: 1,
    id: newUlid(),
    projectSlug: slug,
    status: 'active',
    title: payload.title || `Refine ${source.title}`,
    source: { assetId: source.id, canvasNodeId: payload.canvasNodeId ?? null },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    defaults,
    protectedAssetIds: [source.id],
    turns: [],
    provider: { name: 'google-genai', model: defaults.model, history: [] },
  });
}

export async function patchSession(slug: string, sessionId: string, payload: { title?: string | null; archived?: boolean | null }): Promise<ChatSession> {
  const session = await readSession(slug, sessionId);
  if (payload.title !== undefined && payload.title !== null) session.title = payload.title;
  if (payload.archived !== undefined && payload.archived !== null) {
    session.archivedAt = payload.archived ? utcNow() : null;
    session.status = payload.archived ? 'archived' : 'active';
  }
  session.updatedAt = utcNow();
  return writeSession(slug, session);
}

export async function deleteSessionDocument(slug: string, sessionId: string): Promise<void> {
  await deleteScopedDoc('chatSessions', slug, sessionId);
  notifyChange('chatSessions', slug);
}

// --- blobs ------------------------------------------------------------------------

const SUFFIXES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

export async function saveBlob(slug: string, sessionId: string, data: Uint8Array, mimeType = 'image/png'): Promise<string> {
  const suffix = SUFFIXES[mimeType] ?? '.bin';
  const name = `${newUlid()}${suffix}`;
  await writeBlob(`${sessionDir(slug, sessionId)}/blobs/${name}`, data);
  return `blobs/${name}`;
}

export async function readChatBlob(slug: string, sessionId: string, dataRef: string): Promise<Uint8Array> {
  try {
    const file = await readBlob(`${sessionDir(slug, sessionId)}/${dataRef}`);
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw new ServiceError(`Missing chat blob: ${dataRef}`, { code: 'storage', cause: error });
  }
}

function inlineOf(part: LoosePart): { key: string; inline: LoosePart } | null {
  for (const key of ['inlineData', 'inline_data']) {
    const inline = part[key];
    if (inline && typeof inline === 'object') return { key, inline: inline as LoosePart };
  }
  return null;
}

function mimeOf(inline: LoosePart): string {
  return (inline.mimeType as string | undefined) ?? (inline.mime_type as string | undefined) ?? 'image/png';
}

export async function inlinePartWithRef(
  slug: string,
  sessionId: string,
  data: Uint8Array,
  mimeType = 'image/png',
  thoughtSignature: string | null = null,
): Promise<LoosePart> {
  const part: LoosePart = { inlineData: { mimeType, dataRef: await saveBlob(slug, sessionId, data, mimeType) } };
  if (thoughtSignature !== null) part.thoughtSignature = thoughtSignature;
  return part;
}

/** History with data refs expanded to base64 for the provider request. */
export async function providerHistoryForRequest(slug: string, sessionId: string, history: Content[]): Promise<Content[]> {
  const expanded: Content[] = [];
  for (const content of history) {
    const parts: LoosePart[] = [];
    for (const part of content.parts ?? []) {
      const found = inlineOf(part);
      const dataRef = found ? ((found.inline.dataRef ?? found.inline.data_ref) as string | undefined) : undefined;
      if (found && dataRef) {
        const { dataRef: _dr, data_ref: _dr2, ...rest } = found.inline as Record<string, unknown>;
        void _dr;
        void _dr2;
        parts.push({ ...part, [found.key]: { ...rest, data: bytesToBase64(await readChatBlob(slug, sessionId, dataRef)) } });
      } else {
        parts.push({ ...part });
      }
    }
    expanded.push({ ...content, parts });
  }
  return expanded;
}

/** Persisted copy of a model content: inline image data swapped for blob refs. */
export async function providerHistoryWithBlobRefs(slug: string, sessionId: string, content: Content): Promise<Content> {
  const parts: LoosePart[] = [];
  for (const part of content.parts ?? []) {
    const found = inlineOf(part);
    if (found && typeof found.inline.data === 'string') {
      const mimeType = mimeOf(found.inline);
      const data = base64ToBytes(found.inline.data);
      const { [found.key]: _old, ...rest } = part;
      void _old;
      parts.push({ ...rest, inlineData: { mimeType, dataRef: await saveBlob(slug, sessionId, data, mimeType) } });
    } else {
      parts.push({ ...part });
    }
  }
  return { ...content, parts };
}

export async function userProviderContent(slug: string, sessionId: string, text: string, attachments: ChatAttachment[]): Promise<Content> {
  const parts: LoosePart[] = [{ text }];
  for (const attachment of attachments) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await (await readBlob(assetImagePath(slug, attachment.assetId))).arrayBuffer());
    } catch (error) {
      throw notFound(`Attachment pixels not found: ${attachment.assetId}`);
    }
    parts.push(await inlinePartWithRef(slug, sessionId, bytes, 'image/png'));
  }
  return { role: 'user', parts };
}

// --- protection ------------------------------------------------------------------

export async function protectedAssetIds(slug: string): Promise<Set<string>> {
  const protectedIds = new Set<string>();
  for (const session of await listSessions(slug, true)) {
    for (const id of session.protectedAssetIds) protectedIds.add(id);
    protectedIds.add(session.source.assetId);
    for (const turn of session.turns) {
      for (const id of turn.generatedAssetIds) protectedIds.add(id);
      for (const attachment of turn.attachments) protectedIds.add(attachment.assetId);
    }
  }
  return protectedIds;
}

export async function blockingSessionIds(slug: string, assetId: string): Promise<string[]> {
  const blockers: string[] = [];
  for (const session of await listSessions(slug, true)) {
    if (assetId === session.source.assetId || session.protectedAssetIds.includes(assetId)) {
      blockers.push(session.id);
      continue;
    }
    const inTurns = session.turns.some(
      (turn) => turn.generatedAssetIds.includes(assetId) || turn.attachments.some((a) => a.assetId === assetId),
    );
    if (inTurns) blockers.push(session.id);
  }
  return blockers;
}

// --- turns -------------------------------------------------------------------------

export async function appendTurn(
  slug: string,
  sessionId: string,
  payload: ChatTurnPayload,
  provider: ImageProvider,
  options: { signal?: AbortSignal } = {},
): Promise<ChatTurnResponse> {
  await requireProject(slug);
  const session = await readSession(slug, sessionId);
  if (session.archivedAt) throw conflict('Archived chat sessions cannot receive new turns');
  if (!payload.text.trim()) throw new ServiceError('Message text is required', { code: 'invalid' });
  const settings = payload.settings ?? session.defaults;
  const attachmentIds = [...new Set([session.source.assetId, ...(payload.attachmentAssetIds ?? [])])];
  await validateRefs(slug, attachmentIds);
  const attachments: ChatAttachment[] = attachmentIds.map((assetId) => ({
    kind: 'asset',
    assetId,
    purpose: assetId === session.source.assetId ? 'source' : 'reference',
  }));
  const userContent = await userProviderContent(slug, session.id, payload.text, attachments);
  const requestParts = (await providerHistoryForRequest(slug, session.id, [userContent]))[0].parts ?? [];
  const result = await provider.sendChatTurn({
    history: await providerHistoryForRequest(slug, session.id, session.provider.history as Content[]),
    messageParts: requestParts,
    model: settings.model,
    aspectRatio: settings.aspectRatio,
    imageSize: settings.imageSize,
    thinkingLevel: settings.thinkingLevel ?? null,
    includeThoughts: settings.includeThoughts,
    signal: options.signal,
  });

  const userTurnId = newUlid();
  const modelTurnId = newUlid();
  const now = utcNow();
  const created: Asset[] = [];
  for (const [index, image] of result.images.entries()) {
    const assetId = newUlid();
    const png = await imageOps.normalizeToPng(new Blob([image.data as BlobPart], { type: image.mimeType }));
    await writeBlob(assetImagePath(slug, assetId), png);
    await writeBlob(assetThumbnailPath(slug, assetId), await imageOps.makeThumbnail(png));
    invalidateUrl(assetImagePath(slug, assetId));
    const metadata: AssetMetadata = {
      id: assetId,
      kind: 'generated',
      title: `Refinement ${assetId}`,
      tags: [],
      contentHash: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      prompt: { text: payload.text },
      generation: {
        refs: attachmentIds,
        runId: modelTurnId,
        runIndex: index,
        model: settings.model,
        aspectRatio: settings.aspectRatio,
        imageSize: settings.imageSize,
        seed: null,
        chatSessionId: session.id,
        chatTurnId: modelTurnId,
        visualStyleId: null,
      },
      provider: { name: 'google-genai', response: { imageFile: `${assetId}.png`, response: result.providerResponse } as Record<string, unknown> },
    };
    created.push(await writeAssetMetadata(slug, metadata));
  }
  if (created.length === 0) {
    throw new ServiceError(result.text || 'Gemini returned no image for this refinement. Try a more explicit edit instruction.', {
      code: 'provider',
    });
  }
  const userTurn: ChatTurn = { id: userTurnId, role: 'user', createdAt: now, text: payload.text, settings, attachments, generatedAssetIds: [] };
  const modelTurn: ChatTurn = {
    id: modelTurnId,
    role: 'model',
    createdAt: now,
    text: result.text,
    settings,
    attachments: [],
    generatedAssetIds: created.map((asset) => asset.id),
  };
  session.turns.push(userTurn, modelTurn);
  for (const assetId of [...attachmentIds, ...created.map((asset) => asset.id)]) {
    if (!session.protectedAssetIds.includes(assetId)) session.protectedAssetIds.push(assetId);
  }
  session.provider.history.push(userContent);
  session.provider.history.push(await providerHistoryWithBlobRefs(slug, session.id, result.modelContent as Content));
  session.provider.model = settings.model;
  session.updatedAt = now;
  const saved = await writeSession(slug, session);
  await attachChatAssetsToCanvas(slug, saved, modelTurn, created);
  return { session: saved, assets: created };
}
