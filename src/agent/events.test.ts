import { describe, expect, it } from 'vitest';
import { projectAgentEvent, TaskEventBuffer } from './events';

describe('projectAgentEvent', () => {
  it('projects assistant text, tools and lifecycle like pi_events.py', () => {
    expect(
      projectAgentEvent({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } as never }),
    ).toEqual({ type: 'assistant_text', text: 'a\nb' });
    expect(projectAgentEvent({ type: 'message_end', message: { role: 'user', content: 'x' } as never })).toBeNull();
    expect(projectAgentEvent({ type: 'tool_execution_start', toolCallId: '1', toolName: 'register_character', args: { name: 'Hero' } })).toEqual({
      type: 'tool_start',
      toolName: 'register_character',
      args: '{"name":"Hero"}',
    });
    const end = projectAgentEvent({ type: 'tool_execution_end', toolCallId: '1', toolName: 't', result: { content: [{ type: 'text', text: 'x'.repeat(700) }] }, isError: false });
    expect(end?.type).toBe('tool_end');
    expect((end as unknown as { size: number }).size).toBeGreaterThan(600);
    expect((end as unknown as { result: string }).result.endsWith('…[+truncated]')).toBe(true);
    expect(projectAgentEvent({ type: 'agent_end', messages: [] })).toEqual({ type: 'agent_end' });
    expect(projectAgentEvent({ type: 'message_update' } as never)).toBeNull();
  });
});

describe('TaskEventBuffer', () => {
  it('numbers records, replays from seq and streams new ones', () => {
    const buffer = new TaskEventBuffer();
    buffer.append({ type: 'task_start' });
    buffer.append({ type: 'agent_start' });
    const seen: number[] = [];
    const unsubscribe = buffer.subscribe((record) => seen.push(record.seq), 1);
    buffer.append({ type: 'agent_end' });
    unsubscribe();
    buffer.append({ type: 'task_state', state: 'done' });
    expect(seen).toEqual([2, 3]);
    expect(buffer.since(3).map((r) => r.event.type)).toEqual(['task_state']);
    expect(buffer.lastSeq).toBe(4);
  });
});
