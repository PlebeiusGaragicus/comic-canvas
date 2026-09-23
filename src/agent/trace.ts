/** Project stored pi-agent-core messages into the trace document the
 *  dashboard renders (was pi_session_trace.py over JSONL). */
import type { AgentTraceDocument, PiTraceAssistantStep, PiTraceDocument, PiTraceStats, PiTraceStep, PiTraceToolCall, PiTraceUsage } from '../types';
import { clip } from '../services/common';

const TOOL_RESULT_CLIP = 600;
const TEXT_CLIP = 4000;
const THINKING_CLIP = 2000;

type Loose = Record<string, unknown>;

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') parts.push(block);
    else if (block && typeof block === 'object' && (block as Loose).type === 'text') parts.push(String((block as Loose).text ?? ''));
  }
  return parts.filter(Boolean).join('\n').trim();
}

function usageOf(message: Loose): PiTraceUsage | null {
  const usage = message.usage;
  if (!usage || typeof usage !== 'object') return null;
  const loose = usage as Loose;
  const num = (value: unknown) => (typeof value === 'number' ? value : null);
  return { input: num(loose.input), output: num(loose.output), cacheRead: num(loose.cacheRead), cacheWrite: num(loose.cacheWrite), totalTokens: num(loose.totalTokens) };
}

function timestampOf(message: Loose): string | null {
  const ts = message.timestamp;
  return typeof ts === 'number' ? new Date(ts).toISOString() : typeof ts === 'string' ? ts : null;
}

export function projectMessages(messages: unknown[], stepModel: string | null, seeded = 0): { steps: PiTraceStep[]; stats: PiTraceStats } {
  const steps: PiTraceStep[] = [];
  const stats: PiTraceStats = { messageCount: 0, toolCount: 0, userCount: 0, assistantCount: 0 };
  let pendingAssistant: PiTraceAssistantStep | null = null;
  let pendingTools = new Map<string, PiTraceToolCall>();
  let pendingModel: string | null = stepModel;
  let pendingProvider: string | null = null;

  const flush = () => {
    if (!pendingAssistant) return;
    pendingAssistant.toolCalls = [...pendingTools.values()];
    stats.toolCount += pendingAssistant.toolCalls.length;
    steps.push(pendingAssistant);
    stats.assistantCount += 1;
    stats.messageCount += 1;
    pendingAssistant = null;
    pendingTools = new Map();
  };

  messages.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as Loose;
    const role = message.role;
    const timestamp = timestampOf(message);
    if (index < seeded) {
      // Seeded context is summarised, not replayed.
      if (role === 'user') {
        flush();
        const text = extractText(message.content);
        steps.push({ kind: 'seed', timestamp, text: `Book context seeded (${text.length.toLocaleString()} characters).` });
      }
      return;
    }
    if (role === 'user') {
      flush();
      const text = clip(extractText(message.content), TEXT_CLIP);
      if (text) {
        steps.push({ kind: 'user', timestamp, text });
        stats.userCount += 1;
        stats.messageCount += 1;
      }
      return;
    }
    if (role === 'toolResult') {
      const toolCallId = String(message.toolCallId ?? '');
      const tool = pendingTools.get(toolCallId);
      if (!tool) return;
      const text = extractText(message.content);
      tool.result = text ? clip(text, TOOL_RESULT_CLIP) : '';
      tool.isError = Boolean(message.isError);
      const details = message.details;
      if (details && typeof details === 'object') {
        const loose = details as Loose;
        const projected: { diff?: string; firstChangedLine?: number } = {};
        if (typeof loose.diff === 'string' && loose.diff.trim()) projected.diff = clip(loose.diff, TOOL_RESULT_CLIP);
        if (typeof loose.firstChangedLine === 'number') projected.firstChangedLine = loose.firstChangedLine;
        tool.details = Object.keys(projected).length ? projected : null;
      }
      return;
    }
    if (role !== 'assistant') return;
    const content = Array.isArray(message.content) ? (message.content as Loose[]) : [];
    const thinking: string[] = [];
    const toolCalls: PiTraceToolCall[] = [];
    const textParts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'thinking') {
        const value = String(block.thinking ?? '').trim();
        if (value) thinking.push(clip(value, THINKING_CLIP));
      } else if (block.type === 'toolCall') {
        const args = block.arguments;
        toolCalls.push({
          id: String(block.id ?? ''),
          name: String(block.name ?? ''),
          arguments: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : { raw: args },
          result: null,
          isError: false,
          details: null,
        });
      } else if (block.type === 'text') {
        const value = String(block.text ?? '').trim();
        if (value) textParts.push(value);
      }
    }
    const errorMessage = typeof message.errorMessage === 'string' && message.errorMessage ? message.errorMessage : null;
    if (!thinking.length && !toolCalls.length && !textParts.length && !errorMessage) return;
    if (pendingAssistant && toolCalls.length && !thinking.length && !textParts.length) {
      for (const tool of toolCalls) pendingTools.set(tool.id, tool);
      return;
    }
    flush();
    const provider = typeof message.provider === 'string' ? message.provider : pendingProvider;
    const model = typeof message.model === 'string' ? message.model : pendingModel;
    pendingAssistant = {
      kind: 'assistant',
      timestamp,
      provider,
      model,
      thinkingLevel: typeof message.providerThinkingLevel === 'string' ? message.providerThinkingLevel : null,
      stopReason: typeof message.stopReason === 'string' ? message.stopReason : null,
      usage: usageOf(message),
      thinking,
      text: textParts.length ? clip(textParts.join('\n\n'), TEXT_CLIP) : errorMessage ? `Error: ${errorMessage}` : null,
      toolCalls: [],
    };
    pendingTools = new Map(toolCalls.filter((tool) => tool.id).map((tool) => [tool.id, tool]));
    pendingProvider = provider;
    pendingModel = model;
  });
  flush();
  return { steps, stats };
}

export function projectTrace(trace: AgentTraceDocument | null): PiTraceDocument {
  const steps: PiTraceStep[] = [];
  const stats: PiTraceStats = { messageCount: 0, toolCount: 0, userCount: 0, assistantCount: 0 };
  if (!trace) return { sessionId: null, version: null, steps, stats };
  trace.steps.forEach((step, index) => {
    if (trace.steps.length > 1) {
      steps.push({ kind: 'step', timestamp: null, text: `Step ${index + 1}: ${step.name}` });
    }
    const projected = projectMessages(step.messages, step.model, step.seededMessages ?? 0);
    steps.push(...projected.steps);
    stats.messageCount += projected.stats.messageCount;
    stats.toolCount += projected.stats.toolCount;
    stats.userCount += projected.stats.userCount;
    stats.assistantCount += projected.stats.assistantCount;
  });
  return { sessionId: trace.taskId, version: trace.version, steps, stats };
}
