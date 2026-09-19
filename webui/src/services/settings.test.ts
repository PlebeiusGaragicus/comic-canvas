import { beforeEach, describe, expect, it } from 'vitest';
import { fetchEndpointModels, newEndpoint, readSettings, removeEndpoint, resetSettingsCacheForTests, resolveDefaultTextModel, setDefaultTextModel, setGeminiApiKey, upsertEndpoint, wipeAllLocalData, writeSettings } from './settings';

beforeEach(() => resetSettingsCacheForTests());

describe('settings', () => {
  it('reads defaults and persists patches', async () => {
    const initial = await readSettings();
    expect(initial.imageDefaults.model).toBe('gemini-3.1-flash-image');
    await writeSettings({ thinkingLevel: 'high' });
    resetSettingsCacheForTests();
    expect((await readSettings()).thinkingLevel).toBe('high');
  });

  it('manages endpoints and the default model', async () => {
    const endpoint = { ...newEndpoint(), name: 'Local', baseUrl: 'http://localhost:1234/v1/' };
    await upsertEndpoint(endpoint);
    await upsertEndpoint({ ...endpoint, models: [{ id: 'm1', name: 'M1', reasoning: false, contextWindow: 32000 }] });
    await setDefaultTextModel({ endpointId: endpoint.id, modelId: 'm1' });
    const settings = await readSettings();
    expect(settings.endpoints[0].baseUrl).toBe('http://localhost:1234/v1');
    expect(resolveDefaultTextModel(settings)?.model.id).toBe('m1');
    const after = await removeEndpoint(endpoint.id);
    expect(after.endpoints).toEqual([]);
    expect(after.defaultTextModel).toBeNull();
  });

  it('validates the gemini key before saving', async () => {
    await expect(setGeminiApiKey('   ')).rejects.toThrow(/empty/);
    await expect(setGeminiApiKey('bad', async () => { throw new Error('rejected'); })).rejects.toThrow(/rejected/);
    expect((await setGeminiApiKey('good', async () => undefined)).geminiApiKey).toBe('good');
  });

  it('fetches endpoint models with a bearer header', async () => {
    const endpoint = { ...newEndpoint(), baseUrl: 'http://x/v1', apiKey: 'k', models: [{ id: 'a', name: 'A', reasoning: true, contextWindow: 8000 }] };
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: (init?.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify({ data: [{ id: 'a', context_length: 200000 }, { id: 'b' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const models = await fetchEndpointModels(endpoint, fetchImpl);
    expect(seen[0]).toEqual({ url: 'http://x/v1/models', auth: 'Bearer k' });
    expect(models).toEqual([
      { id: 'a', name: 'A', reasoning: true, contextWindow: 200000 },
      { id: 'b', name: 'b', reasoning: false, contextWindow: 128000 },
    ]);
  });

  it('wipes everything', async () => {
    await writeSettings({ geminiApiKey: 'x' });
    await wipeAllLocalData();
    expect((await readSettings()).geminiApiKey).toBe('');
  });
});
