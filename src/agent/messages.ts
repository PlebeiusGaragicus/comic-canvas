/** pi-agent-core has no message builders; these are the two we need. */
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai';

export function userMessage(text: string): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() };
}

/** A synthetic assistant reply used to seed context (e.g. "Book loaded."). */
export function assistantMessage(text: string, modelId = 'seed'): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'custom',
    model: modelId,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}
