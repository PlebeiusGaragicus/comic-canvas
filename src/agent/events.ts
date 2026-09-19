/** Project pi-agent-core events into the UI event vocabulary (was pi_events.py)
 *  and keep a per-task ring buffer with replay-from-seq subscriptions. */
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { PiTaskEvent } from '../types';
import { clip, utcNow } from '../services/common';

export const RING_BUFFER_SIZE = 2000;

const LIFECYCLE_TYPES = new Set(['agent_start', 'turn_start', 'turn_end', 'agent_end']);

export type ProjectedEvent = PiTaskEvent['event'];

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

export function projectAgentEvent(event: AgentEvent): ProjectedEvent | null {
  switch (event.type) {
    case 'message_end': {
      const message = event.message as { role?: string; content?: unknown };
      if (message.role !== 'assistant') return null;
      const content = Array.isArray(message.content) ? (message.content as Array<{ type?: string; text?: string }>) : [];
      const text = content
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text as string)
        .join('\n');
      if (!text) return null;
      return { type: 'assistant_text', text: clip(text, 4000) };
    }
    case 'tool_execution_start':
      return {
        type: 'tool_start',
        toolName: event.toolName ?? '',
        args: event.args !== undefined && event.args !== null ? clip(stringify(event.args), 500) : '',
      };
    case 'tool_execution_end': {
      const resultText = event.result !== undefined && event.result !== null ? stringify(event.result) : '';
      return {
        type: 'tool_end',
        toolName: event.toolName ?? '',
        isError: Boolean(event.isError),
        size: resultText.length,
        result: clip(resultText, 600),
      };
    }
    default:
      return LIFECYCLE_TYPES.has(event.type) ? { type: event.type } : null;
  }
}

export type EventListener = (record: PiTaskEvent) => void;

export class TaskEventBuffer {
  private seq = 0;
  private readonly records: PiTaskEvent[] = [];
  private readonly listeners = new Set<EventListener>();

  get lastSeq(): number {
    return this.seq;
  }

  append(event: ProjectedEvent): PiTaskEvent {
    this.seq += 1;
    const record: PiTaskEvent = { seq: this.seq, ts: utcNow(), event };
    this.records.push(record);
    if (this.records.length > RING_BUFFER_SIZE) this.records.splice(0, this.records.length - RING_BUFFER_SIZE);
    for (const listener of [...this.listeners]) listener(record);
    return record;
  }

  since(seq: number): PiTaskEvent[] {
    return this.records.filter((record) => record.seq > seq);
  }

  /** Replays records after `fromSeq`, then streams new ones. */
  subscribe(listener: EventListener, fromSeq = 0): () => void {
    for (const record of this.since(fromSeq)) listener(record);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
