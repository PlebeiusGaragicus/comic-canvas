/** Agent task ledger (ported from api/agent_sessions.py). Traces are stored
 *  separately as raw pi-agent-core messages and projected on read (Phase 6). */
import type { AgentSession, AgentSessionKind, AgentSessionPatchPayload, AgentSessionStatus, AgentTraceDocument } from '../types';
import { deleteScopedDoc, getScopedDoc, listScopedDocs, putScopedDoc } from '../store/db';
import { notifyChange } from '../store/changes';
import { utcNow } from './common';
import { newUlid } from './ids';
import { conflict, notFound } from './errors';
import { requireProject } from './projects';

export interface CreateAgentSessionOptions {
  kind: AgentSessionKind;
  title: string;
  sessionId?: string;
  status?: AgentSessionStatus;
  source?: Record<string, unknown>;
  parentSessionId?: string | null;
  traceId?: string | null;
}

export interface UpdateAgentSessionOptions {
  status?: AgentSessionStatus;
  title?: string;
  parentSessionId?: string | null;
  source?: Record<string, unknown>;
  error?: string | null;
  stats?: Record<string, unknown> | null;
  traceId?: string | null;
  completed?: boolean;
}

async function readStored(slug: string, sessionId: string): Promise<AgentSession | null> {
  return (await getScopedDoc<AgentSession>('agentSessions', slug, sessionId)) ?? null;
}

export async function writeSession(slug: string, session: AgentSession): Promise<AgentSession> {
  await putScopedDoc('agentSessions', slug, session.id, session);
  notifyChange('agentSessions', slug);
  return session;
}

export async function createSession(slug: string, options: CreateAgentSessionOptions): Promise<AgentSession> {
  await requireProject(slug);
  if (options.sessionId && (await readStored(slug, options.sessionId))) {
    throw conflict(`Agent session id already exists: ${options.sessionId}`);
  }
  const now = utcNow();
  const id = options.sessionId ?? newUlid();
  return writeSession(slug, {
    version: 1,
    id,
    projectSlug: slug,
    title: options.title,
    kind: options.kind,
    status: options.status ?? 'running',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null,
    parentSessionId: options.parentSessionId ?? null,
    source: { ...(options.source ?? {}) },
    error: null,
    stats: null,
    traceId: options.traceId ?? id,
  });
}

export async function updateSession(slug: string, sessionId: string | null | undefined, options: UpdateAgentSessionOptions): Promise<AgentSession | null> {
  if (!sessionId) return null;
  const session = await readStored(slug, sessionId);
  if (!session) return null;
  if (options.status !== undefined) session.status = options.status;
  if (options.title !== undefined) session.title = options.title;
  if (options.parentSessionId !== undefined) session.parentSessionId = options.parentSessionId;
  if (options.source !== undefined) session.source = { ...session.source, ...options.source };
  if (options.error !== undefined) session.error = options.error;
  if (options.stats !== undefined) session.stats = options.stats;
  if (options.traceId !== undefined) session.traceId = options.traceId;
  if (options.completed || options.status === 'succeeded' || options.status === 'failed') session.completedAt = utcNow();
  session.updatedAt = utcNow();
  return writeSession(slug, session);
}

export async function listSessions(slug: string, includeArchived = false): Promise<AgentSession[]> {
  await requireProject(slug);
  const rows = await listScopedDocs<AgentSession>('agentSessions', slug);
  return rows
    .map((row) => row.doc)
    .filter((session) => includeArchived || !session.archivedAt)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export async function readSession(slug: string, sessionId: string): Promise<AgentSession> {
  const session = await readStored(slug, sessionId);
  if (!session) throw notFound(`Agent session not found: ${sessionId}`);
  return session;
}

export async function patchSession(slug: string, sessionId: string, payload: AgentSessionPatchPayload): Promise<AgentSession> {
  const session = await readSession(slug, sessionId);
  if (payload.title !== undefined && payload.title !== null) session.title = payload.title;
  if (payload.archived !== undefined && payload.archived !== null) {
    if (payload.archived) {
      session.archivedAt = utcNow();
      session.status = 'archived';
    } else {
      session.archivedAt = null;
      session.status = session.completedAt ? 'succeeded' : 'running';
    }
  }
  session.updatedAt = utcNow();
  return writeSession(slug, session);
}

export async function deleteSession(slug: string, sessionId: string): Promise<void> {
  await deleteScopedDoc('agentSessions', slug, sessionId);
  await deleteScopedDoc('agentTraces', slug, sessionId);
  notifyChange('agentSessions', slug);
}

// --- traces ---------------------------------------------------------------------

export async function readTraceDocument(slug: string, traceId: string): Promise<AgentTraceDocument | null> {
  return (await getScopedDoc<AgentTraceDocument>('agentTraces', slug, traceId)) ?? null;
}

export async function writeTraceDocument(slug: string, trace: AgentTraceDocument): Promise<void> {
  await putScopedDoc('agentTraces', slug, trace.taskId, trace);
}
