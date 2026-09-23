import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { api } from '../api';
import { formatRequestError } from '../formatError';
import { Icon } from '../Icon';
import type { ProjectPhase } from '../projectNavigation';
import type { AgentSession, AgentSessionKind, AgentSessionStatus, PiTaskEvent, PiTaskState, PiTaskStatus, PiTraceDocument } from '../types';
import { useAttachedPiTask } from './usePiTask';
import { taskManager } from '../agent/runtime';
import { PiTaskPanel } from './PiTaskPanel';
import { cleanSessionPreview, formatSessionSubtitle, PiTraceTimeline, summarizeTrace } from './PiTraceView';

const emptyTrace: PiTraceDocument = {
  steps: [],
  stats: { messageCount: 0, toolCount: 0, userCount: 0, assistantCount: 0 },
};

/** Kinds that run project-wide with no per-target argument — safe to re-run as-is. */
const RERUNNABLE_KINDS = new Set<AgentSessionKind>([
  'read-book',
  'discover-characters',
  'extract-all-characters',
  'discover-locations',
  'extract-all-locations',
  'suggest-concept-character',
  'suggest-concept-location',
]);

type StatusFilter = 'all' | AgentSessionStatus;

const STATUS_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'succeeded', label: 'Done' },
  { id: 'failed', label: 'Failed' },
  { id: 'archived', label: 'Archived' },
];

function kindLabel(kind: AgentSessionKind) {
  switch (kind) {
    case 'read-book':
      return 'Read book';
    case 'discover-characters':
      return 'Find characters';
    case 'extract-character':
      return 'Extract character';
    case 'refine-character':
      return 'Refine character';
    case 'extract-all-characters':
      return 'Extract all characters';
    case 'discover-locations':
      return 'Find locations';
    case 'extract-location':
      return 'Extract location';
    case 'refine-location':
      return 'Refine location';
    case 'extract-all-locations':
      return 'Extract all locations';
    case 'suggest-concept-character':
      return 'Character suggest';
    case 'suggest-concept-location':
      return 'Location suggest';
    case 'draft-panel-prompt':
      return 'Draft panel prompt';
    case 'refine-panel-prompt':
      return 'Refine panel prompt';
    case 'chunk-panels':
      return 'Chunk panels';
    default:
      return kind;
  }
}

function statusLabel(status: AgentSessionStatus) {
  switch (status) {
    case 'running':
      return 'Running';
    case 'succeeded':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'archived':
      return 'Archived';
    default:
      return status;
  }
}

function sourceValue(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function sessionPreviewText(session: AgentSession, trace: PiTraceDocument | null | undefined) {
  const traceSummary = summarizeTrace(trace ?? null);
  if (traceSummary.preview) {
    return cleanSessionPreview(traceSummary.preview);
  }
  if (session.error) return cleanSessionPreview(session.error);
  if (session.status === 'running') return 'The agent is working on this session.';
  if (!session.traceId) return 'No trace captured.';
  return 'No messages yet.';
}

function sessionSubtitle(session: AgentSession, trace: PiTraceDocument | null | undefined) {
  const stats = trace?.stats ?? {
    messageCount: Number(session.stats?.messageCount ?? 0),
    toolCount: Number(session.stats?.toolCount ?? 0),
  };
  return formatSessionSubtitle(session.updatedAt, stats);
}

function sessionSourceText(session: AgentSession) {
  if (session.kind === 'read-book') return 'Prepared the book context used by later agent tasks.';
  const outputCardId = sourceValue(session.source, 'outputCardId');
  if (outputCardId) return `Created concept card ${outputCardId}.`;
  const outputNodeId = sourceValue(session.source, 'outputNodeId');
  if (outputNodeId) return `Created canvas node ${outputNodeId}.`;
  const panelId = sourceValue(session.source, 'panelId');
  const promptId = sourceValue(session.source, 'promptId');
  if (panelId && promptId) return `Wrote image prompt ${promptId} on ${panelId}.`;
  const subjectKind = sourceValue(session.source, 'subjectKind');
  if (subjectKind) return `Concept Art ${subjectKind} suggestion.`;
  return 'Agent session.';
}

/** Where "Open" should navigate for a session — its produced artifact, else the kind's home view. */
function sessionDestination(session: AgentSession): { phase: ProjectPhase; label: string } {
  if (sourceValue(session.source, 'outputCardId')) return { phase: 'concept-art', label: 'Open concept art' };
  if (sourceValue(session.source, 'outputNodeId')) return { phase: 'image-canvas', label: 'Open canvas' };
  if (sourceValue(session.source, 'panelId')) return { phase: 'layout-editor', label: 'Open layout' };
  switch (session.kind) {
    case 'read-book':
      return { phase: 'story', label: 'Open story' };
    case 'discover-characters':
    case 'extract-character':
    case 'extract-all-characters':
    case 'refine-character':
      return { phase: 'characters-hub', label: 'Open characters' };
    case 'discover-locations':
    case 'extract-location':
    case 'extract-all-locations':
    case 'refine-location':
      return { phase: 'locations-hub', label: 'Open locations' };
    case 'suggest-concept-character':
    case 'suggest-concept-location':
      return { phase: 'concept-art', label: 'Open concept art' };
    case 'draft-panel-prompt':
    case 'refine-panel-prompt':
      return { phase: 'layout-editor', label: 'Open layout' };
    default:
      return { phase: 'story', label: 'Open story' };
  }
}

function formatDuration(session: AgentSession): string | null {
  const start = new Date(session.createdAt).getTime();
  const endSource = session.completedAt ?? (session.status === 'running' ? null : session.updatedAt);
  const end = endSource ? new Date(endSource).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const secs = Math.round((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

/** One live task in the dashboard strip: subscribes to its event buffer by id. */
function ActiveTaskCard({
  projectSlug,
  task,
  onFinished,
  onDismiss,
  onEvent,
  onOpenSession,
}: {
  projectSlug: string;
  task: PiTaskStatus;
  onFinished: (state: PiTaskState) => void | Promise<void>;
  onDismiss: () => void;
  onEvent: (taskId: string, record: PiTaskEvent) => void;
  onOpenSession: () => void;
}) {
  const handleEvent = useCallback((record: PiTaskEvent) => onEvent(task.taskId, record), [onEvent, task.taskId]);
  const { state, events, error, abort } = useAttachedPiTask(projectSlug, task.taskId, task.state, onFinished, handleEvent);
  return (
    <PiTaskPanel
      title={task.title}
      state={state}
      events={events}
      error={error}
      onAbort={() => void abort()}
      onDismiss={onDismiss}
      onOpenSession={onOpenSession}
    />
  );
}

export function AgentDashboardView({
  projectSlug,
  onReloadAdaptation,
  onOpenPhase,
  focusSessionId,
  onFocusSessionHandled,
}: {
  projectSlug: string;
  onReloadAdaptation: () => Promise<void>;
  onOpenPhase: (phase: ProjectPhase) => void;
  /** Session to select on arrival (deep link from a task panel elsewhere). */
  focusSessionId?: string | null;
  onFocusSessionHandled?: () => void;
}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [trace, setTrace] = useState<PiTraceDocument | null>(null);
  const [traceCache, setTraceCache] = useState<Record<string, PiTraceDocument>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isTraceLoading, setIsTraceLoading] = useState(false);
  const [traceCollapsed, setTraceCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [rerunning, setRerunning] = useState(false);
  // Tracked live tasks stay visible after they finish until dismissed.
  const [trackedTasks, setTrackedTasks] = useState<PiTaskStatus[]>([]);
  const trackedIdsRef = useRef<Set<string>>(new Set());
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await api.listAgentSessions(projectSlug, true);
      setSessions(next);
      setActiveSessionId((current) => current && next.some((session) => session.id === current) ? current : next[0]?.id ?? null);
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // Track running tasks: pick up the ones already active, then listen for new starts.
  useEffect(() => {
    let cancelled = false;
    const track = (tasks: PiTaskStatus[]) => {
      const fresh = tasks.filter((task) => task.projectSlug === projectSlug && !trackedIdsRef.current.has(task.taskId));
      if (!fresh.length) return;
      for (const task of fresh) trackedIdsRef.current.add(task.taskId);
      setTrackedTasks((current) => [...current, ...fresh]);
    };
    void api.listPiTasks(projectSlug, { active: true })
      .then((active) => {
        if (!cancelled) track(active);
      })
      .catch((err) => console.error('[comic-canvas] failed to list agent tasks', err));
    const unsubscribe = taskManager.onChange((status) => {
      if (!cancelled && status.state === 'starting') track([status]);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [projectSlug]);

  const dismissTask = useCallback((taskId: string) => {
    trackedIdsRef.current.delete(taskId);
    setTrackedTasks((current) => current.filter((task) => task.taskId !== taskId));
  }, []);

  const onTaskFinished = useCallback(async () => {
    await loadSessions();
    await onReloadAdaptation();
  }, [loadSessions, onReloadAdaptation]);

  const loadTrace = useCallback(async (sessionId: string) => {
    setIsTraceLoading(true);
    setError(null);
    try {
      const nextTrace = await api.getAgentSessionTrace(projectSlug, sessionId);
      setTrace(nextTrace);
      setTraceCache((current) => ({ ...current, [sessionId]: nextTrace }));
    } catch (err) {
      setTrace(null);
      setError(formatRequestError(err));
    } finally {
      setIsTraceLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    if (!activeSession?.id) {
      setTrace(null);
      return;
    }
    const cached = traceCache[activeSession.id];
    if (cached && activeSession.status !== 'running') {
      setTrace(cached);
      return;
    }
    if (!activeSession.traceId) {
      setTrace(emptyTrace);
      return;
    }
    void loadTrace(activeSession.id);
  }, [activeSession?.id, activeSession?.traceId, activeSession?.status, loadTrace, traceCache]);

  // Deep link: select the session a task panel elsewhere pointed at.
  useEffect(() => {
    if (!focusSessionId) return;
    if (!sessions.some((session) => session.id === focusSessionId)) return;
    setActiveSessionId(focusSessionId);
    onFocusSessionHandled?.();
  }, [focusSessionId, onFocusSessionHandled, sessions]);

  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSession?.id ?? null;
  const traceRefreshTimerRef = useRef<number | null>(null);
  const lastTraceRefreshRef = useRef(0);

  useEffect(() => () => {
    if (traceRefreshTimerRef.current !== null) window.clearTimeout(traceRefreshTimerRef.current);
  }, []);

  // Agent session ids equal task ids, so a live task's events map straight
  // onto the session selected in the trace pane: refresh the trace
  // (throttled) as results land instead of polling on a timer.
  const handleTaskEvent = useCallback((taskId: string, record: PiTaskEvent) => {
    const type = record.event.type;
    if (type !== 'tool_end' && type !== 'task_progress' && type !== 'task_state') return;
    if (type === 'task_state') void loadSessions();
    if (activeSessionIdRef.current !== taskId) return;
    if (traceRefreshTimerRef.current !== null) return;
    const delay = Math.max(0, 1200 - (Date.now() - lastTraceRefreshRef.current));
    traceRefreshTimerRef.current = window.setTimeout(() => {
      traceRefreshTimerRef.current = null;
      lastTraceRefreshRef.current = Date.now();
      if (activeSessionIdRef.current === taskId) void loadTrace(taskId);
    }, delay);
  }, [loadSessions, loadTrace]);

  const archiveSession = async (session: AgentSession) => {
    setError(null);
    try {
      const archived = await api.patchAgentSession(projectSlug, session.id, { archived: true });
      setSessions((current) => current.map((item) => item.id === archived.id ? archived : item));
      setTraceCache((current) => {
        const next = { ...current };
        delete next[archived.id];
        return next;
      });
    } catch (err) {
      setError(formatRequestError(err));
    }
  };

  const rerunSession = async (session: AgentSession) => {
    setError(null);
    setRerunning(true);
    try {
      await api.startPiTask(projectSlug, session.kind, { force: true });
      // taskManager.onChange surfaces the new run in the Live lane.
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setRerunning(false);
    }
  };

  const sessionCards = useMemo(() => sessions.map((session) => {
    const cachedTrace = traceCache[session.id];
    return {
      session,
      preview: sessionPreviewText(session, cachedTrace),
      subtitle: sessionSubtitle(session, cachedTrace),
    };
  }), [sessions, traceCache]);

  const stats = useMemo(() => {
    const counts = { runs: 0, running: 0, succeeded: 0, failed: 0, archived: 0 };
    for (const session of sessions) {
      if (session.status === 'archived') {
        counts.archived += 1;
        continue;
      }
      counts.runs += 1;
      if (session.status === 'running') counts.running += 1;
      else if (session.status === 'succeeded') counts.succeeded += 1;
      else if (session.status === 'failed') counts.failed += 1;
    }
    return counts;
  }, [sessions]);

  const tabCount = (id: StatusFilter) => {
    switch (id) {
      case 'all':
        return stats.runs;
      case 'running':
        return stats.running;
      case 'succeeded':
        return stats.succeeded;
      case 'failed':
        return stats.failed;
      case 'archived':
        return stats.archived;
      default:
        return 0;
    }
  };

  const filteredCards = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sessionCards.filter(({ session, preview }) => {
      if (statusFilter === 'all' ? session.status === 'archived' : session.status !== statusFilter) {
        return false;
      }
      if (!needle) return true;
      const haystack = `${session.title} ${kindLabel(session.kind)} ${preview}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [sessionCards, statusFilter, search]);

  const activeTrace = trace ?? (activeSession ? traceCache[activeSession.id] ?? null : null);
  const activeStats = activeTrace?.stats ?? {
    messageCount: Number(activeSession?.stats?.messageCount ?? 0),
    toolCount: Number(activeSession?.stats?.toolCount ?? 0),
  };
  const parentSession = activeSession?.parentSessionId
    ? sessions.find((session) => session.id === activeSession.parentSessionId) ?? null
    : null;
  const destination = activeSession ? sessionDestination(activeSession) : null;
  const duration = activeSession ? formatDuration(activeSession) : null;

  return (
    <div className="agent-hub">
      <header className="agent-hub-header">
        <h1 className="agent-hub-title">Agents</h1>
        {stats.running > 0 && (
          <span className="agent-hub-live-count">{stats.running} running</span>
        )}
        <button
          className="secondary agent-hub-refresh"
          type="button"
          onClick={() => void loadSessions()}
          disabled={isLoading}
          aria-label="Refresh sessions"
        >
          <Icon name="refresh" />
          <span>Refresh</span>
        </button>
      </header>

      {trackedTasks.length > 0 && (
        <section className="agent-hub-live" aria-label="Live agents">
          {trackedTasks.map((task) => (
            <ActiveTaskCard
              key={task.taskId}
              projectSlug={projectSlug}
              task={task}
              onFinished={onTaskFinished}
              onDismiss={() => dismissTask(task.taskId)}
              onEvent={handleTaskEvent}
              onOpenSession={() => setActiveSessionId(task.taskId)}
            />
          ))}
        </section>
      )}

      <div className="agent-hub-browser">
        <aside className="agent-hub-list-pane">
          <div className="agent-hub-filters">
            <input
              className="agent-hub-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search sessions…"
              aria-label="Search sessions"
            />
            <div className="agent-hub-filter-tabs" role="group" aria-label="Filter by status">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={clsx('secondary agent-hub-filter-tab', statusFilter === tab.id && 'is-active')}
                  onClick={() => setStatusFilter(tab.id)}
                >
                  {tab.label}
                  <span className="agent-hub-filter-count">{tabCount(tab.id)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="agent-hub-session-list">
            {filteredCards.map(({ session, preview, subtitle }) => (
              <button
                key={session.id}
                type="button"
                className={clsx('agent-dashboard-session-item', activeSession?.id === session.id && 'is-selected')}
                onClick={() => setActiveSessionId(session.id)}
              >
                <span className="agent-dashboard-session-title-row">
                  <span className="agent-dashboard-session-title">{session.title}</span>
                  <span className={clsx('agent-session-status', `is-${session.status}`)}>{statusLabel(session.status)}</span>
                </span>
                <span className="agent-dashboard-session-kind">{kindLabel(session.kind)}</span>
                <span className="agent-dashboard-session-preview">{preview}</span>
                <small>{subtitle}</small>
              </button>
            ))}
            {!sessions.length && (
              <div className="agent-hub-empty">
                <p className="muted">No agent sessions yet. Run Read book, Suggest, or Draft prompt from the other views.</p>
              </div>
            )}
            {sessions.length > 0 && !filteredCards.length && (
              <div className="agent-hub-empty">
                <p className="muted">No sessions match this filter.</p>
              </div>
            )}
          </div>
        </aside>

        <section className="agent-hub-detail">
          {error && <p className="error">{error}</p>}
          {activeSession ? (
            <>
              <header className="agent-hub-detail-head">
                <div className="agent-hub-detail-heading">
                  <div className="agent-session-heading">
                    <h2>{activeSession.title}</h2>
                    <span className={clsx('agent-session-status', `is-${activeSession.status}`)}>{statusLabel(activeSession.status)}</span>
                  </div>
                  <p className="muted">
                    <span className="agent-dashboard-session-kind">{kindLabel(activeSession.kind)}</span>
                    {' · '}
                    {sessionSourceText(activeSession)}
                  </p>
                  {parentSession && (
                    <button
                      type="button"
                      className="agent-hub-breadcrumb"
                      onClick={() => setActiveSessionId(parentSession.id)}
                    >
                      ↰ Forked from {parentSession.title}
                    </button>
                  )}
                </div>
                <div className="agent-hub-detail-actions">
                  {destination && (
                    <button className="secondary" type="button" onClick={() => onOpenPhase(destination.phase)}>
                      {destination.label}
                    </button>
                  )}
                  {RERUNNABLE_KINDS.has(activeSession.kind) && (
                    <button className="secondary" type="button" disabled={rerunning} onClick={() => void rerunSession(activeSession)}>
                      {rerunning ? 'Starting…' : 'Re-run'}
                    </button>
                  )}
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setTraceCollapsed((value) => !value)}
                    disabled={!activeTrace?.steps.length}
                  >
                    {traceCollapsed ? 'Expand trace' : 'Collapse trace'}
                  </button>
                  {activeSession.status !== 'archived' && (
                    <button className="secondary" type="button" onClick={() => void archiveSession(activeSession)}>Archive</button>
                  )}
                </div>
              </header>

              <div className="agent-hub-detail-metrics">
                {duration && <span className="agent-hub-metric">⏱ {duration}</span>}
                <span className="agent-hub-metric">{activeStats.messageCount} message{activeStats.messageCount === 1 ? '' : 's'}</span>
                <span className="agent-hub-metric">{activeStats.toolCount} tool{activeStats.toolCount === 1 ? '' : 's'}</span>
              </div>

              {activeSession.error && <p className="error">{activeSession.error}</p>}
              <PiTraceTimeline
                trace={activeTrace}
                collapsed={traceCollapsed}
                isLoading={isTraceLoading}
                emptyMessage={activeSession.status === 'running' ? 'Waiting for agent events…' : 'No trace yet.'}
              />
            </>
          ) : (
            <div className="agent-hub-detail-empty">
              <span className="agent-hub-detail-empty-icon" aria-hidden="true" />
              <p className="muted">Select an agent session to browse its trace.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
