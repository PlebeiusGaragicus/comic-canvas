import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatRequestError } from '../formatError';
import { taskManager } from '../agent/runtime';
import type { PiTaskEvent, PiTaskProfile, PiTaskState } from '../types';

const TERMINAL_STATES: PiTaskState[] = ['done', 'failed', 'cancelled'];

export function isTerminalTaskState(state: PiTaskState | null): boolean {
  return state !== null && TERMINAL_STATES.includes(state);
}

/**
 * Drives one narrow agent task profile: starts it, subscribes to its in-page
 * event stream (reattaching to an already-running task on mount), and reports
 * live events + terminal state. `onFinished` fires once per completed run;
 * `onMutation` fires on each successful tool_end so multi-target tasks can
 * refresh the launching view as results land, not just at the end.
 */
export function usePiTask(
  projectSlug: string | null,
  profile: PiTaskProfile,
  onFinished?: (state: PiTaskState) => void | Promise<void>,
  onMutation?: (toolName: string) => void | Promise<void>,
) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [state, setState] = useState<PiTaskState | null>(null);
  const [events, setEvents] = useState<PiTaskEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const onMutationRef = useRef(onMutation);
  onMutationRef.current = onMutation;

  const closeStream = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  const attach = useCallback(
    (slug: string, id: string) => {
      closeStream();
      finishedRef.current = false;
      setTaskId(id);
      setEvents([]);
      let unsubscribe: (() => void) | null = null;
      try {
        unsubscribe = taskManager.subscribe(slug, id, (record) => {
          setEvents((current) => [...current, record]);
          if (record.event.type === 'tool_end' && !record.event.isError) {
            void onMutationRef.current?.(String(record.event.toolName ?? ''));
          }
          if (record.event.type === 'task_state') {
            const nextState = record.event.state as PiTaskState;
            setState(nextState);
            if (record.event.error) setError(String(record.event.error));
            if (isTerminalTaskState(nextState) && !finishedRef.current) {
              finishedRef.current = true;
              void onFinishedRef.current?.(nextState);
            }
          }
        });
      } catch (err) {
        setError(formatRequestError(err));
        return;
      }
      unsubscribeRef.current = unsubscribe;
    },
    [closeStream],
  );

  // Reattach to an already-running task for this profile on mount.
  useEffect(() => {
    if (!projectSlug) {
      setTaskId(null);
      setState(null);
      setEvents([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const active = await api.listPiTasks(projectSlug, { profile, active: true });
        if (!cancelled && active.length) {
          setState(active[0].state);
          setTarget(active[0].target ?? null);
          attach(projectSlug, active[0].taskId);
        }
      } catch (err) {
        console.error('[comic-canvas] failed to check running agent tasks', err);
      }
    })();
    return () => {
      cancelled = true;
      closeStream();
    };
  }, [attach, closeStream, profile, projectSlug]);

  const start = useCallback(
    async (options: { target?: string; force?: boolean; instructions?: string } = {}) => {
      if (!projectSlug) return;
      setError(null);
      try {
        const status = await api.startPiTask(projectSlug, profile, options);
        setState(status.state);
        setTarget(status.target ?? null);
        attach(projectSlug, status.taskId);
      } catch (err) {
        setError(formatRequestError(err));
      }
    },
    [attach, profile, projectSlug],
  );

  const abort = useCallback(async () => {
    if (!projectSlug || !taskId) return;
    try {
      await api.abortPiTask(projectSlug, taskId);
    } catch (err) {
      setError(formatRequestError(err));
    }
  }, [projectSlug, taskId]);

  const dismiss = useCallback(() => {
    closeStream();
    setTaskId(null);
    setTarget(null);
    setState(null);
    setEvents([]);
    setError(null);
  }, [closeStream]);

  const isActive = state !== null && !isTerminalTaskState(state);

  return { taskId, target, state, events, error, isActive, start, abort, dismiss };
}

/**
 * Attaches to one already-running task by id (Agent dashboard): streams its
 * events and reports live state. Does not start tasks. `onEvent` fires for
 * every record so the caller can react (e.g. refresh the trace pane).
 */
export function useAttachedPiTask(
  projectSlug: string,
  taskId: string,
  initialState: PiTaskState,
  onFinished?: (state: PiTaskState) => void | Promise<void>,
  onEvent?: (record: PiTaskEvent) => void,
) {
  const [state, setState] = useState<PiTaskState>(initialState);
  const [events, setEvents] = useState<PiTaskEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let finished = false;
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = taskManager.subscribe(projectSlug, taskId, (record) => {
        setEvents((current) => [...current, record]);
        onEventRef.current?.(record);
        if (record.event.type === 'task_state') {
          const nextState = record.event.state as PiTaskState;
          setState(nextState);
          if (record.event.error) setError(String(record.event.error));
          if (isTerminalTaskState(nextState) && !finished) {
            finished = true;
            void onFinishedRef.current?.(nextState);
          }
        }
      });
    } catch (err) {
      setError(formatRequestError(err));
    }
    return () => {
      finished = true;
      unsubscribe?.();
    };
  }, [projectSlug, taskId]);

  const abort = useCallback(async () => {
    try {
      await api.abortPiTask(projectSlug, taskId);
    } catch (err) {
      setError(formatRequestError(err));
    }
  }, [projectSlug, taskId]);

  return { state, events, error, abort };
}
