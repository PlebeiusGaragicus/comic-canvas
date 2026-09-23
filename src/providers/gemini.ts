/** Gemini image generation + refinement chat (ported from api/gemini.py).
 *  Runs in the browser with the user's own API key (BYOK). */
import { GoogleGenAI, type GenerateContentConfig, type GenerateContentResponse, type ThinkingLevel as GeminiThinkingLevel } from '@google/genai';
import { ServiceError } from '../services/errors';
import { base64ToBytes, bytesToBase64 } from '../shared/base64';

export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';
export const DEFAULT_ASPECT_RATIO = '16:9';
export const DEFAULT_IMAGE_SIZE = '1K';

/** Per-model allowed aspect ratios / sizes (from api/models.py). */
export const MODEL_CAPABILITIES: Record<string, { aspectRatios: string[]; imageSizes: string[] }> = {
  'gemini-2.5-flash-image': {
    aspectRatios: ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    imageSizes: ['1K', '2K', '4K'],
  },
  'gemini-3.1-flash-image': {
    aspectRatios: ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
    imageSizes: ['512', '1K', '2K', '4K'],
  },
  'gemini-3.1-flash-lite-image': {
    aspectRatios: ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    imageSizes: ['1K'],
  },
  'gemini-3-pro-image': {
    aspectRatios: ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    imageSizes: ['1K', '2K', '4K'],
  },
};

export function validateModelCapabilities(model: string | null | undefined, aspectRatio?: string | null, imageSize?: string | null): void {
  if (!model) return;
  const capabilities = MODEL_CAPABILITIES[model];
  if (!capabilities) throw new ServiceError(`Unsupported model: ${model}`, { code: 'unsupported' });
  if (aspectRatio && !capabilities.aspectRatios.includes(aspectRatio)) {
    throw new ServiceError(`Unsupported aspect ratio ${aspectRatio} for model ${model}`, { code: 'unsupported' });
  }
  if (imageSize && !capabilities.imageSizes.includes(imageSize)) {
    throw new ServiceError(`Unsupported image size ${imageSize} for model ${model}`, { code: 'unsupported' });
  }
}

/** Max reference/input images per Gemini image-generation prompt for the given model. */
export function referenceImageLimit(model: string): number {
  const normalized = model.trim().toLowerCase();
  if (normalized.includes('2.5-flash-image') || normalized.includes('2-5-flash-image')) return 3;
  if (normalized.includes('3-pro-image')) return 11;
  return 14;
}

export type GenerationFailureCategory = 'safety' | 'blocked' | 'empty' | 'provider';

export class ImageGenerationError extends ServiceError {
  readonly category: GenerationFailureCategory;
  constructor(message: string, category: GenerationFailureCategory = 'provider', cause?: unknown) {
    super(message, { code: category === 'provider' ? 'provider' : 'invalid', cause });
    this.name = 'ImageGenerationError';
    this.category = category;
  }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** JSON-safe copy of an SDK response/part (drops functions, encodes bytes). */
export function safeJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return `<bytes:${value.byteLength}>`;
  }
  if (Array.isArray(value)) return value.map(safeJson);
  if (typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith('_') || typeof item === 'function' || item === undefined) continue;
      out[key] = safeJson(item);
    }
    return out;
  }
  return String(value);
}

/** Replace large payloads (inline image data, thought signatures) with size markers. */
export function stripProviderPayloads(value: Json): Json {
  if (Array.isArray(value)) return value.map(stripProviderPayloads);
  if (value && typeof value === 'object') {
    const cleaned: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      if ((normalized === 'thought_signature' || normalized === 'thoughtsignature') && typeof item === 'string') {
        cleaned[key] = `<thought-signature:${item.length} chars>`;
      } else if ((normalized === 'data' || normalized === 'inline_data' || normalized === 'inlinedata') && typeof item === 'string') {
        cleaned[key] = `<inline-image-data:${item.length} chars>`;
      } else {
        cleaned[key] = stripProviderPayloads(item);
      }
    }
    return cleaned;
  }
  return value;
}

export interface ProviderResponseCapture {
  imageFile: string;
  response: Json;
}

export function serializeResponseMetadata(response: unknown, imageFile: string): ProviderResponseCapture {
  return { imageFile, response: stripProviderPayloads(safeJson(response)) };
}

type LoosePart = Record<string, unknown>;

function partValue<T = unknown>(part: LoosePart | null | undefined, snake: string, camel: string): T | undefined {
  if (!part) return undefined;
  if (snake in part) return part[snake] as T;
  if (camel in part) return part[camel] as T;
  return undefined;
}

function enumLabel(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value).trim();
  if (text.includes('.')) text = text.slice(text.lastIndexOf('.') + 1);
  return text.replace(/_/g, ' ').trim().toLowerCase();
}

function firstCandidate(response: LoosePart): LoosePart | null {
  const candidates = response.candidates;
  return Array.isArray(candidates) && candidates.length > 0 ? (candidates[0] as LoosePart) : null;
}

/** (category, user-facing message) when no image was produced. */
export function describeGenerationFailure(response: unknown): { category: GenerationFailureCategory; message: string } {
  const loose = (safeJson(response) ?? {}) as LoosePart;
  const promptFeedback = partValue<LoosePart>(loose, 'prompt_feedback', 'promptFeedback');
  const blockReason = partValue(promptFeedback, 'block_reason', 'blockReason');
  const blockMessage = partValue(promptFeedback, 'block_reason_message', 'blockReasonMessage');
  if (blockReason) {
    const reasonLabel = enumLabel(blockReason);
    let detail = reasonLabel ? ` Reason: ${reasonLabel}.` : '';
    if (typeof blockMessage === 'string' && blockMessage.trim()) detail = ` ${blockMessage.trim()}`;
    return {
      category: 'safety',
      message:
        'Image generation was blocked by Gemini content safety filters.' +
        ' Soften explicit violence, gore, sexual content, or other restricted details in the prompt, then try again.' +
        detail,
    };
  }
  const candidate = firstCandidate(loose);
  const finishLabel = enumLabel(partValue(candidate, 'finish_reason', 'finishReason'));
  if (finishLabel && ['safety', 'block', 'prohibit', 'recitation'].some((token) => finishLabel.includes(token))) {
    return {
      category: 'safety',
      message: `Image generation was blocked by Gemini safety filters. Try a less explicit or restrictive prompt. Finish reason: ${finishLabel}.`,
    };
  }
  return {
    category: 'empty',
    message:
      'Gemini returned no image for this prompt. The model may have refused the request, ' +
      'encountered a content limit, or failed to produce image output. Try rephrasing the prompt ' +
      'or reducing reference-image complexity.',
  };
}

export function responseParts(response: unknown): LoosePart[] {
  const loose = (response ?? {}) as LoosePart;
  const candidate = firstCandidate(loose);
  const content = candidate?.content as LoosePart | undefined;
  const parts = (content?.parts ?? loose.parts) as unknown;
  return Array.isArray(parts) ? (parts as LoosePart[]) : [];
}

export interface ChatImagePart {
  data: Uint8Array;
  mimeType: string;
  thoughtSignature: string | null;
}

export interface ChatTurnResult {
  /** The model's `Content` for history, with image parts re-embedded as base64 `inlineData`. */
  modelContent: { role: string; parts: Json[] };
  text: string;
  images: ChatImagePart[];
  providerResponse: Json;
}

function inlineDataBytes(inlineData: unknown): { data: Uint8Array | null; mimeType: string } {
  if (!inlineData || typeof inlineData !== 'object') return { data: null, mimeType: 'image/png' };
  const loose = inlineData as LoosePart;
  const mimeType = (partValue<string>(loose, 'mime_type', 'mimeType') as string | undefined) || 'image/png';
  const data = loose.data;
  if (typeof data === 'string') {
    try {
      return { data: base64ToBytes(data), mimeType };
    } catch {
      return { data: null, mimeType };
    }
  }
  if (data instanceof Uint8Array) return { data, mimeType };
  return { data: null, mimeType };
}

function imageBytesFromPart(part: LoosePart): { data: Uint8Array | null; mimeType: string } {
  return inlineDataBytes(partValue(part, 'inline_data', 'inlineData'));
}

/** History copy of a part: image bytes re-embedded as base64 under the SDK's camelCase key. */
function modelHistoryPart(part: LoosePart): Json {
  const historyPart = safeJson(part);
  if (!historyPart || typeof historyPart !== 'object' || Array.isArray(historyPart)) return { text: String(historyPart) };
  const { data, mimeType } = imageBytesFromPart(part);
  if (!data || !mimeType.startsWith('image/')) return historyPart;
  const key = 'inline_data' in historyPart ? 'inline_data' : 'inlineData';
  const existing = historyPart[key];
  const inline = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  return { ...historyPart, [key]: { ...inline, mimeType, data: bytesToBase64(data) } };
}

export function chatTurnResultFromResponse(response: unknown): ChatTurnResult {
  const parts = responseParts(response);
  const loose = (response ?? {}) as LoosePart;
  const candidate = firstCandidate(loose);
  const role = ((candidate?.content as LoosePart | undefined)?.role as string | undefined) ?? 'model';
  const textParts: string[] = [];
  const images: ChatImagePart[] = [];
  for (const part of parts) {
    const text = part.text;
    if (typeof text === 'string') textParts.push(text);
    const { data, mimeType } = imageBytesFromPart(part);
    if (data && mimeType.startsWith('image/')) {
      const signature = partValue(part, 'thought_signature', 'thoughtSignature');
      images.push({ data, mimeType, thoughtSignature: typeof signature === 'string' ? signature : null });
    }
  }
  return {
    modelContent: { role, parts: parts.map(modelHistoryPart) },
    text: textParts.join('\n').trim(),
    images,
    providerResponse: stripProviderPayloads(safeJson(response)),
  };
}

/** Normalise a persisted/legacy part to the SDK's camelCase field names. */
export function toSdkPart(part: LoosePart): LoosePart {
  const out: LoosePart = {};
  for (const [key, value] of Object.entries(part)) {
    if (key === 'inline_data' || key === 'inlineData') {
      const inline = (value ?? {}) as LoosePart;
      const normalized: LoosePart = {};
      for (const [k, v] of Object.entries(inline)) {
        if (k === 'mime_type') normalized.mimeType = v;
        else if (k === 'data_ref') normalized.dataRef = v;
        else normalized[k] = v;
      }
      out.inlineData = normalized;
    } else if (key === 'thought_signature') {
      out.thoughtSignature = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface ReferenceImage {
  data: Uint8Array;
  mimeType: string;
}

export interface GenerateImageParams {
  prompt: string;
  referenceImages: ReferenceImage[];
  seed: number;
  model: string;
  aspectRatio: string;
  imageSize: string;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  data: Uint8Array;
  mimeType: string;
  /** Stripped provider response (no image bytes). */
  providerResponse: Json;
}

export interface SendChatTurnParams {
  history: Array<Record<string, unknown>>;
  messageParts: LoosePart[];
  model: string;
  aspectRatio: string;
  imageSize: string;
  thinkingLevel?: string | null;
  includeThoughts?: boolean;
  signal?: AbortSignal;
}

export interface ImageProvider {
  readonly name: 'google-genai';
  generateImage(params: GenerateImageParams): Promise<GeneratedImage>;
  sendChatTurn(params: SendChatTurnParams): Promise<ChatTurnResult>;
  /** Cheap authenticated round-trip; throws ServiceError when the key is rejected. */
  validateKey(apiKey: string): Promise<void>;
}

function providerError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new ServiceError('You are offline. Image generation needs a network connection.', { code: 'offline', cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ServiceError(`Gemini request failed: ${message}`, { code: 'provider', cause: error });
}

function requireKey(apiKey: string | null | undefined): string {
  const key = (apiKey ?? '').trim();
  if (!key) {
    throw new ServiceError('No Gemini API key configured. Add one in Settings to generate images.', { code: 'invalid' });
  }
  return key;
}

export function geminiProvider(getApiKey: () => string | null | undefined): ImageProvider {
  return {
    name: 'google-genai',
    async generateImage(params) {
      const ai = new GoogleGenAI({ apiKey: requireKey(getApiKey()) });
      const parts: LoosePart[] = [{ text: params.prompt }];
      for (const image of params.referenceImages) {
        parts.push({ inlineData: { mimeType: image.mimeType, data: bytesToBase64(image.data) } });
      }
      const config: GenerateContentConfig = {
        responseModalities: ['IMAGE'],
        seed: params.seed,
        imageConfig: { aspectRatio: params.aspectRatio, imageSize: params.imageSize },
        abortSignal: params.signal,
      };
      let response: GenerateContentResponse;
      try {
        response = await ai.models.generateContent({ model: params.model, contents: [{ role: 'user', parts }], config });
      } catch (error) {
        throw providerError(error);
      }
      for (const part of responseParts(response)) {
        const { data, mimeType } = imageBytesFromPart(part);
        if (data && mimeType.startsWith('image/')) {
          return { data, mimeType, providerResponse: stripProviderPayloads(safeJson(response)) };
        }
      }
      const failure = describeGenerationFailure(response);
      throw new ImageGenerationError(failure.message, failure.category);
    },
    async sendChatTurn(params) {
      const ai = new GoogleGenAI({ apiKey: requireKey(getApiKey()) });
      const contents = [
        ...params.history.map((content) => ({
          ...content,
          parts: (Array.isArray(content.parts) ? (content.parts as LoosePart[]) : []).map(toSdkPart),
        })),
        { role: 'user', parts: params.messageParts.map(toSdkPart) },
      ];
      const config: GenerateContentConfig = {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: params.aspectRatio, imageSize: params.imageSize },
        abortSignal: params.signal,
      };
      if (params.thinkingLevel || params.includeThoughts) {
        config.thinkingConfig = {
          ...(params.thinkingLevel ? { thinkingLevel: params.thinkingLevel as GeminiThinkingLevel } : {}),
          includeThoughts: Boolean(params.includeThoughts),
        };
      }
      try {
        const response = await ai.models.generateContent({ model: params.model, contents, config });
        return chatTurnResultFromResponse(response);
      } catch (error) {
        throw providerError(error);
      }
    },
    async validateKey(apiKey) {
      const key = requireKey(apiKey);
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        await ai.models.list({ config: { pageSize: 1 } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ServiceError(`Gemini rejected the key: ${message}`, { code: 'provider', cause: error });
      }
    },
  };
}
