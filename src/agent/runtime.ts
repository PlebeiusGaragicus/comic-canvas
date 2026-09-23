/** TaskManager: runs task profiles as pi-agent-core Agents in the page
 *  (replaces pi_runtime.PiSessionManager + the RPC subprocess). */
import { Agent, type AgentMessage, type StreamFn } from '@earendil-works/pi-agent-core';
import type { AgentSessionKind, AgentTraceDocument, AgentTraceStep, PiTaskEvent, PiTaskProfile, PiTaskState, PiTaskStatus, TextEndpoint } from '../types';
import { ServiceError, conflict, invalid, notFound } from '../services/errors';
import { utcNow } from '../services/common';
import { newUlid } from '../services/ids';
import { createSession, listSessions, updateSession, writeTraceDocument } from '../services/agentSessions';
import { readSettings } from '../services/settings';
import { buildModel, makeStreamFn } from '../providers/textModel';
import { projectAgentEvent, TaskEventBuffer, type EventListener } from './events';
import { loadSeededBook, requireTextModel, seedMessages } from './book';
import { PROFILES } from './profiles';
import type { TaskArgs, TaskProfile, TaskStep } from './profiles/types';

export const ACTIVE_STATES: readonly PiTaskState[] = ['starting', 'running', 'aborting'];
export const STEP_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const MAX_REPAIR_ATTEMPTS = 2;
export const INTERRUPTED_ERROR = 'Interrupted by reload';

export class TaskHandle {
  readonly id = newUlid();
  readonly title: string;
  readonly target: string | null;
  readonly startedAt = utcNow();
  state: PiTaskState = 'starting';
  error: string | null = null;
  completedAt: string | null = null;
  bookTokenEstimate: number | null = null;
  readonly events = new TaskEventBuffer();
  agent: Agent | null = null;
  abortRequested = false;

  constructor(readonly slug: string, readonly profile: TaskProfile, readonly args: TaskArgs) {
    this.target = args.target;
    this.title = profile.title(args.target);
  }

  setState(state: PiTaskState, error?: string | null): void {
    this.state = state;
    if (error) this.error = error;
    if (state === 'done' || state === 'failed' || state === 'cancelled') this.completedAt = utcNow();
    const event: PiTaskEvent['event'] = { type: 'task_state', state };
    if (error) event.error = error;
    this.events.append(event);
  }

  toStatus(): PiTaskStatus {
    return {
      taskId: this.id,
      projectSlug: this.slug,
      profile: this.profile.id,
      title: this.title,
      target: this.target,
      state: this.state,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      error: this.error,
      bookTokenEstimate: this.bookTokenEstimate,
    };
  }

  requestAbort(): boolean {
    if (!ACTIVE_STATES.includes(this.state)) return false;
    this.abortRequested = true;
    this.setState('aborting');
    this.agent?.abort();
    return true;
  }
}

class AbortedError extends Error {
  constructor() {
    super('Task cancelled');
    this.name = 'AbortedError';
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type TaskChangeListener = (status: PiTaskStatus) => void;

export class TaskManager {
  private readonly handles = new Map<string, TaskHandle>();
  private readonly sweptSlugs = new Set<string>();
  private readonly changeListeners = new Set<TaskChangeListener>();
  private unloadGuardInstalled = false;
  /** Builds the stream function for an endpoint; tests swap in a faux provider. */
  streamFnFactory: (endpoint: TextEndpoint) => StreamFn = makeStreamFn;

  /** Fires when a task starts or changes state (replaces the dashboard's polling). */
  onChange(listener: TaskChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChange(handle: TaskHandle): void {
    const status = handle.toStatus();
    for (const listener of [...this.changeListeners]) listener(status);
  }

  getProfile(profileId: string): TaskProfile {
    const profile = PROFILES[profileId as PiTaskProfile];
    if (!profile) throw notFound(`Unknown pi task profile: ${profileId}`);
    return profile;
  }

  async startTask(slug: string, profileId: string, args: TaskArgs): Promise<PiTaskStatus> {
    const profile = this.getProfile(profileId);
    if (args.target && !profile.acceptsTarget) throw invalid(`${profile.id} does not accept a target`);
    if (args.instructions && !profile.acceptsInstructions) throw invalid(`${profile.id} does not accept instructions`);
    if (typeof navigator !== 'undefined' && navigator.onLine === false && profile.id !== 'read-book') {
      throw new ServiceError('You are offline. Agent tasks need a network connection to reach your model endpoint.', { code: 'offline' });
    }
    await this.sweep(slug);
    await profile.precheck(slug, args);
    for (const handle of this.handles.values()) {
      if (handle.slug === slug && handle.profile.id === profile.id && handle.target === args.target && ACTIVE_STATES.includes(handle.state)) {
        throw conflict(`A '${profile.id}' task is already running`);
      }
    }
    const handle = new TaskHandle(slug, profile, args);
    this.handles.set(handle.id, handle);
    const source: Record<string, unknown> = { type: 'pi-task', profile: profile.id };
    if (args.target !== null) source.target = args.target;
    await createSession(slug, { kind: profile.id as AgentSessionKind, title: handle.title, sessionId: handle.id, source, traceId: handle.id });
    handle.events.append({ type: 'task_start', profile: profile.id, title: handle.title });
    this.installUnloadGuard();
    this.emitChange(handle);
    handle.events.subscribe((record) => {
      if (record.event.type === 'task_state') this.emitChange(handle);
    }, handle.events.lastSeq);
    void this.runTask(handle);
    return handle.toStatus();
  }

  getStatus(slug: string, taskId: string): PiTaskStatus | null {
    const handle = this.handles.get(taskId);
    return handle && handle.slug === slug ? handle.toStatus() : null;
  }

  async listStatuses(slug: string, options: { profile?: string; active?: boolean } = {}): Promise<PiTaskStatus[]> {
    await this.sweep(slug);
    let statuses = [...this.handles.values()].filter((handle) => handle.slug === slug).map((handle) => handle.toStatus());
    if (options.profile !== undefined) statuses = statuses.filter((status) => status.profile === options.profile);
    if (options.active !== undefined) statuses = statuses.filter((status) => ACTIVE_STATES.includes(status.state) === options.active);
    return statuses.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  }

  abort(slug: string, taskId: string): boolean {
    const handle = this.handles.get(taskId);
    if (!handle || handle.slug !== slug) return false;
    return handle.requestAbort();
  }

  /** Replays records after `fromSeq`, then streams live ones. Returns an unsubscribe. */
  subscribe(slug: string, taskId: string, listener: EventListener, fromSeq = 0): () => void {
    const handle = this.handles.get(taskId);
    if (!handle || handle.slug !== slug) throw notFound(`Pi task not found: ${taskId}`);
    return handle.events.subscribe(listener, fromSeq);
  }

  hasActiveTasks(): boolean {
    return [...this.handles.values()].some((handle) => ACTIVE_STATES.includes(handle.state));
  }

  /** Tasks die with the page: ledger rows still `running` from a previous
   *  page load are marked failed (replaces the PID sweep). */
  async sweep(slug: string): Promise<void> {
    if (this.sweptSlugs.has(slug)) return;
    this.sweptSlugs.add(slug);
    let sessions;
    try {
      sessions = await listSessions(slug, true);
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'not-found') return;
      throw error;
    }
    for (const session of sessions) {
      if (session.status === 'running' && !this.handles.has(session.id)) {
        await updateSession(slug, session.id, { status: 'failed', error: INTERRUPTED_ERROR, completed: true });
      }
    }
  }

  resetForTests(): void {
    this.handles.clear();
    this.sweptSlugs.clear();
    this.changeListeners.clear();
    this.streamFnFactory = makeStreamFn;
  }

  /** Test hook: wait for a task to reach a terminal state. */
  async waitForTask(taskId: string): Promise<PiTaskStatus> {
    const handle = this.handles.get(taskId);
    if (!handle) throw notFound(`Pi task not found: ${taskId}`);
    if (!ACTIVE_STATES.includes(handle.state)) return handle.toStatus();
    await new Promise<void>((resolve) => {
      const unsubscribe = handle.events.subscribe((record) => {
        if (record.event.type === 'task_state' && !ACTIVE_STATES.includes(record.event.state as PiTaskState)) {
          unsubscribe();
          resolve();
        }
      }, handle.events.lastSeq);
    });
    return handle.toStatus();
  }

  private installUnloadGuard(): void {
    if (this.unloadGuardInstalled || typeof window === 'undefined') return;
    this.unloadGuardInstalled = true;
    window.addEventListener('beforeunload', (event) => {
      if (this.hasActiveTasks()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  private async runTask(handle: TaskHandle): Promise<void> {
    const { slug, profile, args } = handle;
    const trace: AgentTraceDocument = { version: 1, taskId: handle.id, projectSlug: slug, steps: [] };
    let stepIndex = 0;
    try {
      handle.setState('running');
      for await (const step of profile.plan(slug, args)) {
        stepIndex += 1;
        if (handle.abortRequested) throw new AbortedError();
        handle.events.append({ type: 'task_progress', index: stepIndex, label: step.name });
        const prompt = await step.buildPrompt();
        let merged: Record<string, unknown> | null | void;
        if (prompt === null) {
          merged = await step.onSuccess(false);
        } else {
          const traceStep = await this.runStep(handle, step, prompt);
          trace.steps.push(traceStep);
          await writeTraceDocument(slug, trace);
          merged = traceStep.result;
        }
        if (merged) await updateSession(slug, handle.id, { source: merged });
      }
      // Ledger first, then the terminal event: subscribers that react to
      // task_state (dashboard refresh, tests) must see the final row.
      await updateSession(slug, handle.id, { status: 'succeeded', completed: true });
      handle.setState('done');
    } catch (error) {
      if (error instanceof AbortedError || handle.abortRequested) {
        await updateSession(slug, handle.id, { status: 'failed', error: 'Cancelled', completed: true });
        handle.setState('cancelled');
      } else {
        const message = errorText(error);
        console.error('[comic-canvas] agent task failed', { taskId: handle.id, profile: profile.id, message });
        await updateSession(slug, handle.id, { status: 'failed', error: message, completed: true });
        handle.setState('failed', message);
      }
    } finally {
      handle.agent = null;
    }
  }

  private async runStep(handle: TaskHandle, step: TaskStep, prompt: string): Promise<AgentTraceStep & { result: Record<string, unknown> | null }> {
    const settings = await readSettings();
    const resolved = await requireTextModel();
    const model = buildModel(resolved.endpoint, resolved.model);
    const messages: AgentMessage[] = [];
    let seededMessages = 0;
    let seededTokenEstimate: number | null = null;
    if (step.seedBook) {
      const book = await loadSeededBook(handle.slug);
      messages.push(...seedMessages(book.text, model.id));
      seededMessages = messages.length;
      seededTokenEstimate = book.tokenEstimate;
      handle.bookTokenEstimate = book.tokenEstimate;
      handle.events.append({ type: 'book_context', tokenEstimate: book.tokenEstimate, contextWindow: model.contextWindow });
    }
    const agent = new Agent({
      initialState: { systemPrompt: step.systemPrompt, model, tools: step.tools, messages, thinkingLevel: settings.thinkingLevel },
      streamFn: this.streamFnFactory(resolved.endpoint),
      getApiKey: () => resolved.endpoint.apiKey.trim() || undefined,
      toolExecution: 'sequential',
    });
    handle.agent = agent;
    const unsubscribe = agent.subscribe((event) => {
      const projected = projectAgentEvent(event);
      if (projected) handle.events.append(projected);
    });
    try {
      await this.promptWithTimeout(handle, agent, prompt);
      let result: Record<string, unknown> | null = null;
      let attempts = 0;
      for (;;) {
        try {
          result = (await step.onSuccess(true)) ?? null;
          break;
        } catch (error) {
          if (handle.abortRequested) throw new AbortedError();
          attempts += 1;
          if (attempts > MAX_REPAIR_ATTEMPTS) throw error;
          const repair = step.repairPrompt ?? `You did not complete the task: ${errorText(error)}. Use the tools now to finish it. Do not answer with prose only.`;
          handle.events.append({ type: 'task_progress', index: attempts, label: `repair attempt ${attempts}: ${step.name}` });
          await this.promptWithTimeout(handle, agent, repair);
        }
      }
      return { name: step.name, model: model.id, messages: agent.state.messages, seededMessages, seededTokenEstimate, result };
    } finally {
      unsubscribe();
      handle.agent = null;
    }
  }

  private async promptWithTimeout(handle: TaskHandle, agent: Agent, prompt: string): Promise<void> {
    const timer = setTimeout(() => agent.abort(), STEP_TIMEOUT_MS);
    try {
      await agent.prompt(prompt);
    } finally {
      clearTimeout(timer);
    }
    if (handle.abortRequested) throw new AbortedError();
    const errorMessage = agent.state.errorMessage;
    if (errorMessage) throw new ServiceError(errorMessage, { code: 'provider' });
    const last = agent.state.messages[agent.state.messages.length - 1] as { role?: string; stopReason?: string } | undefined;
    if (last?.role === 'assistant' && last.stopReason === 'aborted') {
      throw new ServiceError(`Step "${prompt.slice(0, 40)}…" timed out`, { code: 'provider' });
    }
  }
}

export const taskManager = new TaskManager();
