import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { isTerminalTaskState } from './usePiTask';
import type { PiTaskEvent, PiTaskState } from '../types';

type PanelItem =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'progress'; key: string; index: number; label: string }
  | { kind: 'tool'; key: string; name: string; args: string; state: 'running' | 'ok' | 'error'; result: string };

function buildItems(events: PiTaskEvent[]): PanelItem[] {
  const items: PanelItem[] = [];
  for (const record of events) {
    const event = record.event;
    if (event.type === 'assistant_text' && typeof event.text === 'string') {
      items.push({ kind: 'text', key: `e${record.seq}`, text: event.text });
    } else if (event.type === 'task_progress') {
      items.push({
        kind: 'progress',
        key: `e${record.seq}`,
        index: Number(event.index ?? 0),
        label: String(event.label ?? ''),
      });
    } else if (event.type === 'book_context') {
      const tokens = Number(event.tokenEstimate ?? 0);
      const window = Number(event.contextWindow ?? 0);
      items.push({
        kind: 'text',
        key: `e${record.seq}`,
        text: `Book context seeded: about ${tokens.toLocaleString()} tokens${window ? ` of a ${window.toLocaleString()}-token window` : ''}.`,
      });
    } else if (event.type === 'tool_start') {
      items.push({
        kind: 'tool',
        key: `e${record.seq}`,
        name: String(event.toolName ?? ''),
        args: String(event.args ?? ''),
        state: 'running',
        result: '',
      });
    } else if (event.type === 'tool_end') {
      const open = [...items].reverse().find(
        (item): item is Extract<PanelItem, { kind: 'tool' }> =>
          item.kind === 'tool' && item.state === 'running' && item.name === String(event.toolName ?? ''),
      );
      if (open) {
        open.state = event.isError ? 'error' : 'ok';
        open.result = String(event.result ?? '');
      }
    }
  }
  return items;
}

/** One-line summary of the most recent activity, shown while the panel is collapsed. */
function latestActivity(items: PanelItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === 'progress') return `Step ${item.index}: ${item.label}`;
    if (item.kind === 'tool') return `${item.state === 'running' ? '⋯' : item.state === 'error' ? '✕' : '✓'} ${item.name}`;
    const line = item.text.trim().split('\n').find(Boolean);
    if (line) return line;
  }
  return 'Waiting for the agent…';
}

function stateLabel(state: PiTaskState | null): string {
  switch (state) {
    case 'starting':
      return 'Starting…';
    case 'running':
      return 'Running';
    case 'aborting':
      return 'Cancelling…';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return '';
  }
}

export function PiTaskPanel({
  title,
  state,
  events,
  error,
  onAbort,
  onDismiss,
  onOpenSession,
}: {
  title: string;
  state: PiTaskState | null;
  events: PiTaskEvent[];
  error: string | null;
  onAbort: () => void;
  onDismiss: () => void;
  /** Navigates to this task's session in the Agent dashboard; makes the title a link. */
  onOpenSession?: () => void;
}) {
  const items = useMemo(() => buildItems(events), [events]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [items.length, state, expanded]);

  if (state === null) return null;
  const terminal = isTerminalTaskState(state);

  return (
    <section className={clsx('pi-task-panel', `is-${state}`, expanded && 'is-expanded')} aria-live="polite">
      <header className="pi-task-panel-header">
        <span className={clsx('pi-task-state-dot', `is-${state}`)} aria-hidden />
        {onOpenSession ? (
          <h3>
            <button className="pi-task-panel-title-link" type="button" onClick={onOpenSession} title="Open in Agents">
              {title}
            </button>
          </h3>
        ) : (
          <h3>{title}</h3>
        )}
        <span className="pi-task-state-label">{stateLabel(state)}</span>
        <button
          className="secondary pi-task-panel-button"
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide log' : 'Show log'}
        </button>
        {!terminal && (
          <button className="secondary pi-task-panel-button" type="button" onClick={onAbort} disabled={state === 'aborting'}>
            Cancel
          </button>
        )}
        {terminal && (
          <button className="secondary pi-task-panel-button" type="button" onClick={onDismiss} aria-label="Dismiss task panel">
            ✕
          </button>
        )}
      </header>
      {error && <p className="error pi-task-panel-error">{error}</p>}
      {!expanded && !error && (
        <p className="pi-task-panel-summary" title={latestActivity(items)}>{latestActivity(items)}</p>
      )}
      {expanded && (
      <div className="pi-task-panel-body" ref={bodyRef}>
        {items.map((item) =>
          item.kind === 'text' ? (
            <p key={item.key} className="pi-task-text">{item.text}</p>
          ) : item.kind === 'progress' ? (
            <p key={item.key} className="pi-task-progress">
              Step {item.index}: {item.label}
            </p>
          ) : (
            <button
              key={item.key}
              type="button"
              className={clsx('pi-task-tool-chip', `is-${item.state}`, expandedKey === item.key && 'is-expanded')}
              onClick={() => setExpandedKey((current) => (current === item.key ? null : item.key))}
            >
              <span className="pi-task-tool-name">
                {item.state === 'running' ? '⋯' : item.state === 'error' ? '✕' : '✓'} {item.name}
              </span>
              {expandedKey === item.key && (
                <span className="pi-task-tool-detail">
                  {item.args && <code>{item.args}</code>}
                  {item.result && <code>{item.result}</code>}
                </span>
              )}
            </button>
          ),
        )}
        {!items.length && <p className="muted">Waiting for the agent…</p>}
      </div>
      )}
    </section>
  );
}
