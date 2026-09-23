/** pi-ai Model + stream function for a user-configured OpenAI-completions endpoint (BYOK). */
import type { Model, OpenAICompletionsCompat, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { TextEndpoint, TextModelDef } from '../types';
import { normalizeBaseUrl } from '../services/settings';

export const DEFAULT_MAX_TOKENS = 8192;

/** Build the pi-ai model descriptor. The reported context window is used
 *  as-is: pi subtracts its own safety margin and the book-fits check must
 *  see the real number. */
export function buildModel(endpoint: TextEndpoint, def: TextModelDef): Model<'openai-completions'> {
  const thinkingLevelMap: ThinkingLevelMap | undefined = def.reasoning
    ? { off: 'none', ...((def.thinkingLevelMap ?? {}) as ThinkingLevelMap) }
    : (def.thinkingLevelMap as ThinkingLevelMap | null | undefined) ?? undefined;
  return {
    id: def.id,
    name: def.name || def.id,
    api: 'openai-completions',
    provider: 'custom',
    baseUrl: normalizeBaseUrl(endpoint.baseUrl),
    reasoning: def.reasoning,
    thinkingLevelMap,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: def.contextWindow,
    maxTokens: def.maxTokens ?? DEFAULT_MAX_TOKENS,
    compat: (def.compat ?? undefined) as OpenAICompletionsCompat | undefined,
  };
}

/** Stream function that injects the endpoint's key on every request. */
export function makeStreamFn(endpoint: TextEndpoint): StreamFn {
  const apiKey = endpoint.apiKey.trim() || undefined;
  return (model, context, options) =>
    streamSimple(model as Model<'openai-completions'>, context, { ...(options ?? {}), apiKey });
}
