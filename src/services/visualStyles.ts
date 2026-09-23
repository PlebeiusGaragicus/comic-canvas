/** Reusable visual style snippets appended to image prompts (ported from api/visual_styles.py). */
import type { AdaptationStatus, VisualStyleCreatePayload, VisualStyleDefinition, VisualStylePatchPayload } from '../types';
import { getProjectDoc, putProjectDoc } from '../store/db';
import { notifyChange } from '../store/changes';
import { slugify } from './common';
import { notFound } from './errors';

export const STYLE_TEMPLATE = 'Style:\nColor palette:\nRealism:\nLighting:\n';

export const DEFAULT_VISUAL_STYLE_PROMPT =
  'Style: Textured, hand-drawn crayon illustration featuring bold, expressive, and coarse strokes ' +
  'that create a deliberate "rough" or unpolished sketchbook aesthetic.\n' +
  'Color palette: Highly saturated, vibrant primary and secondary colors with heavy layering of pigments.\n' +
  'Realism: Stylized/Non-realistic; uses simplified shapes, exaggerated character features, and prominent medium texture over anatomical precision.\n' +
  'Lighting: Flat to moderate, achieved through coarse cross-hatching and visible colored strokes rather than smooth gradients.\n';

export function defaultVisualStyles(): VisualStyleDefinition[] {
  return [{ id: 'crayons', name: 'crayons', prompt: DEFAULT_VISUAL_STYLE_PROMPT, default: true }];
}

export async function readVisualStyles(slug: string): Promise<VisualStyleDefinition[]> {
  const stored = await getProjectDoc<unknown>('visualStyles', slug);
  return Array.isArray(stored) ? (stored as VisualStyleDefinition[]) : [];
}

export async function hasVisualStylesDocument(slug: string): Promise<boolean> {
  return (await getProjectDoc<unknown>('visualStyles', slug)) !== undefined;
}

export async function writeVisualStyles(slug: string, styles: VisualStyleDefinition[]): Promise<void> {
  await putProjectDoc('visualStyles', slug, styles.map((style) => ({ ...style, default: Boolean(style.default) })));
  notifyChange('visualStyles', slug);
}

export function resolveDefaultVisualStyleId(styles: VisualStyleDefinition[]): string | null {
  const marked = styles.filter((style) => style.default).map((style) => style.id);
  if (marked.length === 1) return marked[0];
  return styles.length > 0 ? styles[0].id : null;
}

function markDefault(styles: VisualStyleDefinition[], styleId: string): VisualStyleDefinition[] {
  return styles.map((style) => ({ id: style.id, name: style.name, prompt: style.prompt, default: style.id === styleId }));
}

export function uniqueStyleId(styles: VisualStyleDefinition[], name: string): string {
  const existing = new Set(styles.map((style) => style.id));
  const candidate = slugify(name, 'style');
  if (!existing.has(candidate)) return candidate;
  let index = 2;
  while (existing.has(`${candidate}-${index}`)) index += 1;
  return `${candidate}-${index}`;
}

export async function visualStylePrompt(slug: string, styleId: string): Promise<string> {
  const { ensureAdaptation } = await import('./adaptation');
  await ensureAdaptation(slug);
  const style = (await readVisualStyles(slug)).find((item) => item.id === styleId);
  if (!style) throw notFound(`Visual style not found: ${styleId}`);
  return style.prompt;
}

async function statusAfter(slug: string): Promise<AdaptationStatus> {
  const { status } = await import('./adaptation');
  return status(slug);
}

export async function createVisualStyle(slug: string, payload: VisualStyleCreatePayload): Promise<AdaptationStatus> {
  const { ensureAdaptation } = await import('./adaptation');
  await ensureAdaptation(slug);
  const styles = await readVisualStyles(slug);
  const styleId = uniqueStyleId(styles, payload.name);
  const prompt = payload.prompt ?? STYLE_TEMPLATE;
  styles.push({ id: styleId, name: payload.name.trim(), prompt: prompt.replace(/\s+$/, '') + '\n', default: styles.length === 0 });
  await writeVisualStyles(slug, styles);
  return statusAfter(slug);
}

export async function updateVisualStyle(slug: string, styleId: string, payload: VisualStylePatchPayload): Promise<AdaptationStatus> {
  const { ensureAdaptation } = await import('./adaptation');
  await ensureAdaptation(slug);
  let styles = await readVisualStyles(slug);
  const index = styles.findIndex((style) => style.id === styleId);
  if (index < 0) throw notFound(`Visual style not found: ${styleId}`);
  const current = styles[index];
  const name = payload.name !== undefined ? payload.name.trim() : current.name;
  const prompt = payload.prompt !== undefined ? payload.prompt : current.prompt;
  styles[index] = { id: styleId, name, prompt: prompt.replace(/\s+$/, '') + '\n', default: current.default };
  if (payload.default === true) styles = markDefault(styles, styleId);
  await writeVisualStyles(slug, styles);
  return statusAfter(slug);
}

export async function deleteVisualStyle(slug: string, styleId: string): Promise<AdaptationStatus> {
  const { ensureAdaptation } = await import('./adaptation');
  await ensureAdaptation(slug);
  const styles = await readVisualStyles(slug);
  const removed = styles.find((style) => style.id === styleId);
  if (!removed) throw notFound(`Visual style not found: ${styleId}`);
  let next = styles.filter((style) => style.id !== styleId);
  if (removed.default && next.length > 0) next = markDefault(next, next[0].id);
  await writeVisualStyles(slug, next);
  return statusAfter(slug);
}
