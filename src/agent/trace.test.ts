import { describe, expect, it } from 'vitest';
import { projectTrace } from './trace';

describe('projectTrace', () => {
  it('folds tool-only assistant messages, attaches results, and summarises seeded context', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'book '.repeat(1000) }], timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'Book loaded.' }], model: 'seed', timestamp: 2 },
      { role: 'user', content: [{ type: 'text', text: 'Find characters' }], timestamp: 3 },
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'toolCall', id: 'c1', name: 'register_character', arguments: { name: 'Hero' } }],
        model: 'm',
        provider: 'custom',
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
        stopReason: 'toolUse',
        timestamp: 4,
      },
      { role: 'toolResult', toolCallId: 'c1', toolName: 'register_character', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 5 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'c2', name: 'register_character', arguments: { name: 'Villain' } }], model: 'm', timestamp: 6 },
      { role: 'toolResult', toolCallId: 'c2', toolName: 'register_character', content: [{ type: 'text', text: 'bad' }], isError: true, timestamp: 7 },
      { role: 'assistant', content: [{ type: 'text', text: 'Registered 2 characters.' }], model: 'm', timestamp: 8 },
    ];
    const doc = projectTrace({ version: 1, taskId: 't1', projectSlug: 'p', steps: [{ name: 'discover characters', model: 'm', messages, seededMessages: 2 }] });
    expect(doc.steps.map((s) => s.kind)).toEqual(['seed', 'user', 'assistant', 'assistant']);
    const assistant = doc.steps[2];
    if (assistant.kind !== 'assistant') throw new Error('expected assistant');
    expect(assistant.thinking).toEqual(['hmm']);
    expect(assistant.toolCalls.map((t) => [t.name, t.result, t.isError])).toEqual([
      ['register_character', 'ok', false],
      ['register_character', 'bad', true],
    ]);
    expect(assistant.usage?.input).toBe(10);
    expect(doc.stats).toEqual({ messageCount: 3, toolCount: 2, userCount: 1, assistantCount: 2 });
  });

  it('adds step banners for multi-step tasks and handles empty traces', () => {
    expect(projectTrace(null).steps).toEqual([]);
    const doc = projectTrace({
      version: 1,
      taskId: 't',
      projectSlug: 'p',
      steps: [
        { name: 'a', model: null, messages: [{ role: 'user', content: 'x', timestamp: 1 }] },
        { name: 'b', model: null, messages: [{ role: 'assistant', content: [], errorMessage: 'boom', timestamp: 2 }] },
      ],
    });
    expect(doc.steps.map((s) => s.kind)).toEqual(['step', 'user', 'step', 'assistant']);
    expect((doc.steps[3] as { text: string }).text).toBe('Error: boom');
  });
});
