/** App settings document (BYOK endpoints, Gemini key, image defaults, UI prefs). */
import type { AppSettings, DefaultTextModel, TextEndpoint, TextModelDef, ThinkingLevel } from '../types';
import { getSetting, putSetting, wipeDatabase } from '../store/db';
import { wipeAllBlobs } from '../store/blobs';
import { releaseAllUrls } from '../store/objectUrls';
import { notifyChange } from '../store/changes';
import { newUlid } from './ids';
import { ServiceError } from './errors';
import { DEFAULT_ASPECT_RATIO, DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_SIZE } from '../providers/gemini';

const SETTINGS_KEY = 'app';

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  endpoints: [],
  defaultTextModel: null,
  thinkingLevel: 'off',
  geminiApiKey: '',
  imageDefaults: { model: DEFAULT_IMAGE_MODEL, aspectRatio: DEFAULT_ASPECT_RATIO, imageSize: DEFAULT_IMAGE_SIZE },
  storageMode: 'opfs',
  uiPrefs: {},
};

export interface EndpointPreset {
  id: string;
  name: string;
  baseUrl: string;
  keyRequired: boolean;
  note: string;
}

/** Prefilled base URLs for common OpenAI-completions compatible servers. */
export const ENDPOINT_PRESETS: EndpointPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyRequired: true, note: 'Requires an OpenAI API key.' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyRequired: true, note: 'Requires an OpenRouter API key.' },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', keyRequired: false, note: 'Enable CORS in LM Studio server settings.' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', keyRequired: false, note: 'Start Ollama with OLLAMA_ORIGINS set to this site.' },
  { id: 'llamacpp', name: 'llama.cpp', baseUrl: 'http://localhost:8080/v1', keyRequired: false, note: 'Run llama-server with --cors or a matching origin.' },
];

let cache: AppSettings | null = null;

function withDefaults(stored: Partial<AppSettings> | undefined): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    imageDefaults: { ...DEFAULT_SETTINGS.imageDefaults, ...(stored?.imageDefaults ?? {}) },
    endpoints: (stored?.endpoints ?? []).map((endpoint) => ({ ...endpoint, models: endpoint.models ?? [] })),
    uiPrefs: { ...(stored?.uiPrefs ?? {}) },
  };
}

export async function readSettings(): Promise<AppSettings> {
  if (cache) return cache;
  cache = withDefaults(await getSetting<Partial<AppSettings>>(SETTINGS_KEY));
  return cache;
}

export async function writeSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = withDefaults({ ...(await readSettings()), ...patch });
  await putSetting(SETTINGS_KEY, next);
  cache = next;
  notifyChange('settings', null);
  return next;
}

export function resetSettingsCacheForTests(): void {
  cache = null;
}

export function geminiKeyConfigured(settings: AppSettings): boolean {
  return settings.geminiApiKey.trim().length > 0;
}

export async function setGeminiApiKey(apiKey: string, validate?: (key: string) => Promise<void>): Promise<AppSettings> {
  const key = apiKey.trim();
  if (!key) throw new ServiceError('API key is empty', { code: 'invalid' });
  if (validate) await validate(key);
  return writeSettings({ geminiApiKey: key });
}

export function newEndpoint(preset?: EndpointPreset): TextEndpoint {
  return {
    id: newUlid(),
    name: preset?.name ?? 'Custom endpoint',
    baseUrl: preset?.baseUrl ?? '',
    apiKey: '',
    models: [],
  };
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export async function upsertEndpoint(endpoint: TextEndpoint): Promise<AppSettings> {
  const settings = await readSettings();
  const normalized = { ...endpoint, baseUrl: normalizeBaseUrl(endpoint.baseUrl) };
  if (!normalized.baseUrl) throw new ServiceError('Endpoint base URL is required', { code: 'invalid' });
  const endpoints = settings.endpoints.some((e) => e.id === normalized.id)
    ? settings.endpoints.map((e) => (e.id === normalized.id ? normalized : e))
    : [...settings.endpoints, normalized];
  return writeSettings({ endpoints });
}

export async function removeEndpoint(endpointId: string): Promise<AppSettings> {
  const settings = await readSettings();
  const endpoints = settings.endpoints.filter((e) => e.id !== endpointId);
  const defaultTextModel = settings.defaultTextModel?.endpointId === endpointId ? null : settings.defaultTextModel;
  return writeSettings({ endpoints, defaultTextModel });
}

export async function setDefaultTextModel(selection: DefaultTextModel | null): Promise<AppSettings> {
  return writeSettings({ defaultTextModel: selection });
}

export async function setThinkingLevel(level: ThinkingLevel): Promise<AppSettings> {
  return writeSettings({ thinkingLevel: level });
}

export interface ResolvedTextModel {
  endpoint: TextEndpoint;
  model: TextModelDef;
}

export function resolveDefaultTextModel(settings: AppSettings): ResolvedTextModel | null {
  const selection = settings.defaultTextModel;
  if (!selection) return null;
  const endpoint = settings.endpoints.find((e) => e.id === selection.endpointId);
  const model = endpoint?.models.find((m) => m.id === selection.modelId);
  return endpoint && model ? { endpoint, model } : null;
}

/** GET {baseUrl}/models on an OpenAI-compatible server. Returns model defs
 *  with a conservative default context window the user can edit. */
export async function fetchEndpointModels(endpoint: TextEndpoint, fetchImpl: typeof fetch = fetch): Promise<TextModelDef[]> {
  const baseUrl = normalizeBaseUrl(endpoint.baseUrl);
  const headers: Record<string, string> = {};
  if (endpoint.apiKey.trim()) headers.Authorization = `Bearer ${endpoint.apiKey.trim()}`;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/models`, { headers });
  } catch (error) {
    throw new ServiceError(
      `Could not reach ${baseUrl}. If this is a local server, enable CORS for this site.`,
      { code: 'provider', cause: error },
    );
  }
  if (!response.ok) {
    throw new ServiceError(`${baseUrl}/models returned ${response.status}`, { code: 'provider' });
  }
  const body = (await response.json()) as { data?: Array<{ id?: string; context_length?: number; context_window?: number }> };
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows
    .filter((row) => typeof row.id === 'string' && row.id)
    .map((row) => {
      const existing = endpoint.models.find((m) => m.id === row.id);
      const contextWindow = row.context_length ?? row.context_window ?? existing?.contextWindow ?? 128000;
      return existing ? { ...existing, contextWindow } : { id: row.id as string, name: row.id as string, reasoning: false, contextWindow };
    });
}

/** Delete every document and blob (settings included). */
export async function wipeAllLocalData(): Promise<void> {
  releaseAllUrls();
  await wipeDatabase();
  await wipeAllBlobs();
  cache = null;
  notifyChange('*', null);
}
