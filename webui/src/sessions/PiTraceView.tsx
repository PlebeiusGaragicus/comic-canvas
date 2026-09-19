import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  PiTraceAssistantStep,
  PiTraceDocument,
  PiTraceInfoBanner,
  PiTraceStep,
  PiTraceToolCall,
  PiTraceUserStep,
} from '../types';
import { MarkdownContent, TraceMessageContent } from './MarkdownContent';

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTokenBadge(usage: PiTraceAssistantStep['usage']) {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.input != null) parts.push(`${usage.input.toLocaleString()}↓`);
  if (usage.output != null) parts.push(`${usage.output.toLocaleString()}↑`);
  if (!parts.length) return null;
  const cache = usage.cacheRead ? ` (${usage.cacheRead.toLocaleString()} cached)` : '';
  return `${parts.join(' ')}${cache}`;
}

function formatArgs(argumentsValue: Record<string, unknown>) {
  try {
    return JSON.stringify(argumentsValue, null, 2);
  } catch {
    return String(argumentsValue);
  }
}

function PiTraceToolCallBlock({
  tool,
  collapsed,
}: {
  tool: PiTraceToolCall;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className={`pi-trace-tool ${tool.isError ? 'is-error' : ''}`}>
      <button type="button" className="pi-trace-tool-head" onClick={() => setOpen((value) => !value)}>
        <span className="pi-trace-tool-label">1 tool call ({tool.name || 'tool'})</span>
        <span className="pi-trace-tool-toggle">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="pi-trace-tool-body">
          <pre className="pi-trace-tool-args">{tool.name} {formatArgs(tool.arguments)}</pre>
          {tool.details?.diff && <pre className="pi-trace-tool-diff">{tool.details.diff}</pre>}
          {tool.result && <pre className="pi-trace-tool-result">{tool.result}</pre>}
        </div>
      )}
    </div>
  );
}

function PiTraceThinkingBlock({ text, collapsed }: { text: string; collapsed: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className="pi-trace-thinking">
      <button type="button" className="pi-trace-thinking-head" onClick={() => setOpen((value) => !value)}>
        <span>Thinking</span>
        <span className="pi-trace-thinking-toggle">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="pi-trace-thinking-body">
          <MarkdownContent text={text} />
        </div>
      )}
    </div>
  );
}

function PiTraceUserBlock({ step }: { step: PiTraceUserStep }) {
  return (
    <article className="pi-trace-block pi-trace-block-user">
      <header className="pi-trace-block-head">
        <strong>User</strong>
        {step.timestamp && <time dateTime={step.timestamp}>{formatTimestamp(step.timestamp)}</time>}
      </header>
      <div className="pi-trace-block-body">
        <TraceMessageContent text={step.text} />
      </div>
    </article>
  );
}

function PiTraceAssistantBlock({
  step,
  collapsed,
}: {
  step: PiTraceAssistantStep;
  collapsed: boolean;
}) {
  const modelLabel = [step.provider, step.model].filter(Boolean).join('/') || 'Assistant';
  const tokenBadge = formatTokenBadge(step.usage);
  return (
    <article className="pi-trace-block pi-trace-block-assistant">
      <header className="pi-trace-block-head">
        <strong>Assistant {modelLabel}</strong>
        {step.timestamp && <time dateTime={step.timestamp}>{formatTimestamp(step.timestamp)}</time>}
        {tokenBadge && <span className="pi-trace-token-badge">{tokenBadge}</span>}
      </header>
      <div className="pi-trace-block-body">
        {step.thinking.map((text, index) => (
          <PiTraceThinkingBlock key={index} text={text} collapsed={collapsed} />
        ))}
        {step.toolCalls.map((tool) => (
          <PiTraceToolCallBlock key={tool.id || `${tool.name}-${tool.result ?? 'pending'}`} tool={tool} collapsed={collapsed} />
        ))}
        {step.text && (
          <div className="pi-trace-answer">
            <MarkdownContent text={step.text} />
          </div>
        )}
      </div>
    </article>
  );
}

const BANNER_LABELS: Record<PiTraceInfoBanner['kind'], string> = {
  compaction: 'Compaction',
  branch_summary: 'Branch summary',
  seed: 'Book context',
  step: 'Step',
};

function PiTraceBannerBlock({ step }: { step: PiTraceInfoBanner }) {
  const label = BANNER_LABELS[step.kind];
  return (
    <article className="pi-trace-block pi-trace-block-banner">
      <header className="pi-trace-block-head">
        <strong>{label}</strong>
        {step.timestamp && <time dateTime={step.timestamp}>{formatTimestamp(step.timestamp)}</time>}
        {step.tokensBefore != null && <span className="pi-trace-token-badge">{step.tokensBefore.toLocaleString()} tokens before</span>}
      </header>
      <div className="pi-trace-block-body">
        <MarkdownContent text={step.text} />
      </div>
    </article>
  );
}

function PiTraceStepBlock({ step, collapsed }: { step: PiTraceStep; collapsed: boolean }) {
  if (step.kind === 'user') return <PiTraceUserBlock step={step} />;
  if (step.kind === 'assistant') return <PiTraceAssistantBlock step={step} collapsed={collapsed} />;
  return <PiTraceBannerBlock step={step} />;
}

export function PiTraceTimeline({
  trace,
  collapsed = true,
  emptyMessage = 'No trace yet.',
  isLoading = false,
  footer,
}: {
  trace: PiTraceDocument | null;
  collapsed?: boolean;
  emptyMessage?: string;
  isLoading?: boolean;
  footer?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [trace?.steps.length, isLoading]);

  return (
    <div className="pi-trace-timeline" ref={scrollRef} role="log" aria-live="polite">
      {isLoading && !trace?.steps.length ? (
        <p className="pi-trace-empty">Loading trace…</p>
      ) : !trace?.steps.length ? (
        <p className="pi-trace-empty">{emptyMessage}</p>
      ) : (
        trace.steps.map((step, index) => (
          <PiTraceStepBlock key={`${step.kind}-${step.timestamp ?? index}`} step={step} collapsed={collapsed} />
        ))
      )}
      {footer}
    </div>
  );
}

export function summarizeTrace(trace: PiTraceDocument | null) {
  if (!trace) {
    return { preview: '', messageCount: 0, toolCount: 0 };
  }
  const firstUser = trace.steps.find((step): step is PiTraceUserStep => step.kind === 'user');
  return {
    preview: firstUser?.text ?? '',
    messageCount: trace.stats.messageCount,
    toolCount: trace.stats.toolCount,
  };
}

export function formatSessionSubtitle(updatedAt: string, stats: { messageCount: number; toolCount: number }) {
  const date = formatTimestamp(updatedAt);
  const messages = `${stats.messageCount} message${stats.messageCount === 1 ? '' : 's'}`;
  const tools = `${stats.toolCount} tool${stats.toolCount === 1 ? '' : 's'}`;
  return `${date} · ${messages} · ${tools}`;
}

export function cleanSessionPreview(text: string | null | undefined): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';
  const candidate = trimmed.split('\n').map((line) => line.trim()).find(Boolean) ?? trimmed;
  return candidate.length > 80 ? `${candidate.slice(0, 77)}…` : candidate;
}
