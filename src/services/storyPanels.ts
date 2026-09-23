/** Story panel chunking and page layout (ported from api/story_panels.py).
 *  The document lives in the `storyPanels` store; reset backups go to OPFS
 *  next to where panels.json used to live. */
import type {
  ConceptNodeResponse,
  StoryPanel,
  StoryPanelBookmarkCreatePayload,
  StoryPanelCaption,
  StoryPanelCaptionTail,
  StoryPanelCreatePayload,
  StoryPanelDocument,
  StoryPanelImageCrop,
  StoryPanelImagePrompt,
  StoryPanelPage,
  StoryPanelPageSettings,
  StoryPanelPatchPayload,
  StoryPanelRect,
  StoryPanelTextStyle,
} from '../types';
import { getProjectDoc, putProjectDoc } from '../store/db';
import { deleteBlob, listDir, writeBlob } from '../store/blobs';
import { notifyChange } from '../store/changes';
import { LAYOUT_GRID_COLUMNS, LAYOUT_PAGE_ROWS } from '../storyPanels/printLayout';
import { TAG_COLOR_RE, TAG_RE, cloneJson, slugify, utcNow } from './common';
import { conflict, invalid, isServiceError, notFound } from './errors';
import { requireProject } from './projects';
import * as adaptation from './adaptation';
import { nodeTags, readStoredCanvas } from './canvas';
import { createImageGroupNode, nextCanvasPosition } from './canvasNodes';
import { listProjectTags, normalizeTagId } from './tags';

export const DEFAULT_AUTO_PLACE_W = LAYOUT_GRID_COLUMNS / 3;
export const DEFAULT_AUTO_PLACE_H = LAYOUT_PAGE_ROWS / 3;

const SPREAD_COLUMNS = 2 * LAYOUT_GRID_COLUMNS;
const EPSILON = 1e-9;
const PAGE_KINDS: ReadonlySet<string> = new Set(['cover', 'inside-cover', 'story', 'inside-back-cover', 'back-cover']);
const FONT_FAMILIES: ReadonlySet<string> = new Set(['serif', 'sans', 'mono', 'comic']);
const ALIGNS: ReadonlySet<string> = new Set(['left', 'center', 'right']);
const SPEECH_KINDS: ReadonlySet<string> = new Set(['dialogue', 'narration']);
const BACKGROUNDS: ReadonlySet<string> = new Set(['transparent', 'white']);
const SOURCE_KINDS: ReadonlySet<string> = new Set(['panel', 'bookmark']);
const PANEL_KINDS: ReadonlySet<string> = new Set(['image', 'text']);
const BACKUP_PREFIX = 'panels.json.bak-';
const BACKUPS_TO_KEEP = 3;

// Agent output that leaked conversational framing instead of plain prose.
export const CHAT_WRAPPER_RE = /^(Sure|Here is|Here's|I wrote|Done\.|```|Apologies|I'm sorry)/m;

type Raw = Record<string, unknown>;

// --- runtime validation (the pydantic validators from api/models.py) ---------------

function asRecord(value: unknown, label: string): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(`${label} must be an object`);
  return value as Raw;
}

function optionalString(raw: Raw, key: string, fallback: string, label: string, maxLength?: number): string {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw invalid(`${label}.${key} must be a string`);
  if (maxLength !== undefined && value.length > maxLength) throw invalid(`${label}.${key} must be at most ${maxLength} characters`);
  return value;
}

function requiredId(raw: Raw, key: string, label: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || !TAG_RE.test(value)) throw invalid(`${label}.${key} must be a slug: ${String(value)}`);
  return value;
}

function optionalId(raw: Raw, key: string, label: string): string | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !TAG_RE.test(value)) throw invalid(`${label}.${key} must be a slug: ${String(value)}`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(`${label} must be a number`);
  return value;
}

function boundedNumber(raw: Raw, key: string, fallback: number | undefined, label: string, min: number, max?: number): number {
  const value = raw[key];
  if (value === undefined || value === null) {
    if (fallback === undefined) throw invalid(`${label}.${key} is required`);
    return fallback;
  }
  const number = finiteNumber(value, `${label}.${key}`);
  if (number < min) throw invalid(`${label}.${key} must be at least ${min}`);
  if (max !== undefined && number > max) throw invalid(`${label}.${key} must be at most ${max}`);
  return number;
}

function boundedInt(raw: Raw, key: string, fallback: number | undefined, label: string, min: number, max?: number): number {
  const number = boundedNumber(raw, key, fallback, label, min, max);
  if (!Number.isInteger(number)) throw invalid(`${label}.${key} must be an integer`);
  return number;
}

function optionalInt(raw: Raw, key: string, label: string, min: number): number | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  return boundedInt(raw, key, undefined, label, min);
}

function optionalBool(raw: Raw, key: string, fallback: boolean, label: string): boolean {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw invalid(`${label}.${key} must be a boolean`);
  return value;
}

function enumValue<T extends string>(raw: Raw, key: string, allowed: ReadonlySet<string>, fallback: T, label: string): T {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !allowed.has(value)) throw invalid(`${label}.${key} must be one of ${[...allowed].join(', ')}: ${String(value)}`);
  return value as T;
}

function colorValue(raw: Raw, key: string, fallback: string, label: string): string {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !TAG_COLOR_RE.test(value)) throw invalid(`${label}.${key} must be a hex colour`);
  return value;
}

function stringList(raw: Raw, key: string, label: string): string[] {
  const value = raw[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw invalid(`${label}.${key} must be a list of strings`);
  return [...(value as string[])];
}

export function validateRect(value: unknown, label = 'rect'): StoryPanelRect {
  const raw = asRecord(value, label);
  const rect: StoryPanelRect = {
    x: boundedNumber(raw, 'x', undefined, label, 0, SPREAD_COLUMNS),
    y: boundedNumber(raw, 'y', undefined, label, 0),
    w: boundedNumber(raw, 'w', undefined, label, 0.25, SPREAD_COLUMNS),
    h: boundedNumber(raw, 'h', undefined, label, 0.25, 12),
  };
  if (rect.x + rect.w > SPREAD_COLUMNS) throw invalid('Panel layout must fit within the 24-column spread grid');
  if (rect.y + rect.h > LAYOUT_PAGE_ROWS) throw invalid('Panel layout must fit within the page height grid');
  return rect;
}

export function validatePage(value: unknown): StoryPanelPage {
  const raw = asRecord(value, 'page');
  return {
    id: requiredId(raw, 'id', 'page'),
    order: boundedInt(raw, 'order', undefined, 'page', 0),
    title: optionalString(raw, 'title', '', 'page', 120),
    pageKind: enumValue(raw, 'pageKind', PAGE_KINDS, 'story', 'page'),
  };
}

export function defaultTextStyle(): StoryPanelTextStyle {
  return { fontFamily: 'serif', fontSize: 8, align: 'left', speechKind: 'dialogue', background: 'white', color: '#111827', outlineColor: '#ffffff' };
}

export function validateTextStyle(value: unknown, label = 'textStyle'): StoryPanelTextStyle {
  if (value === undefined || value === null) return defaultTextStyle();
  const raw = asRecord(value, label);
  return {
    fontFamily: enumValue(raw, 'fontFamily', FONT_FAMILIES, 'serif', label),
    fontSize: boundedInt(raw, 'fontSize', 8, label, 6, 48),
    align: enumValue(raw, 'align', ALIGNS, 'left', label),
    speechKind: enumValue(raw, 'speechKind', SPEECH_KINDS, 'dialogue', label),
    background: enumValue(raw, 'background', BACKGROUNDS, 'white', label),
    color: colorValue(raw, 'color', '#111827', label),
    outlineColor: colorValue(raw, 'outlineColor', '#ffffff', label),
  };
}

function validateImageCrop(value: unknown): StoryPanelImageCrop | null {
  if (value === undefined || value === null) return null;
  const raw = asRecord(value, 'imageCrop');
  return {
    focalX: boundedNumber(raw, 'focalX', 0.5, 'imageCrop', 0, 1),
    focalY: boundedNumber(raw, 'focalY', 0.5, 'imageCrop', 0, 1),
    scale: boundedNumber(raw, 'scale', 1, 'imageCrop', 1, 4),
  };
}

function validateTail(value: unknown): StoryPanelCaptionTail | null {
  if (value === undefined || value === null) return null;
  const raw = asRecord(value, 'tail');
  return {
    x: boundedNumber(raw, 'x', undefined, 'tail', 0, SPREAD_COLUMNS),
    y: boundedNumber(raw, 'y', undefined, 'tail', 0, LAYOUT_PAGE_ROWS),
  };
}

export function validateCaption(value: unknown): StoryPanelCaption {
  const raw = asRecord(value, 'caption');
  return {
    id: requiredId(raw, 'id', 'caption'),
    visibleText: optionalString(raw, 'visibleText', '', 'caption'),
    richText: optionalString(raw, 'richText', '', 'caption'),
    textStyle: validateTextStyle(raw.textStyle, 'caption.textStyle'),
    rect: validateRect(raw.rect, 'caption.rect'),
    tail: validateTail(raw.tail),
    layer: boundedInt(raw, 'layer', 0, 'caption', 0),
  };
}

function validateImagePrompt(value: unknown): StoryPanelImagePrompt {
  const raw = asRecord(value, 'imagePrompt');
  return { id: requiredId(raw, 'id', 'imagePrompt'), text: optionalString(raw, 'text', '', 'imagePrompt') };
}

function validateOffsets(start: number | null, end: number | null, label: string): void {
  if ((start === null) !== (end === null)) throw invalid(`${label} book offsets must be set together`);
  if (start !== null && end !== null && end <= start) throw invalid(`${label} endOffset must be greater than startOffset`);
}

export function defaultRect(): StoryPanelRect {
  return { x: 0, y: 0, w: DEFAULT_AUTO_PLACE_W, h: DEFAULT_AUTO_PLACE_H };
}

/** `StoryPanel.model_validate`: fill defaults and apply the panel-level rules. */
export function validatePanel(value: unknown): StoryPanel {
  const raw = asRecord(value, 'panel');
  const panel: StoryPanel = {
    id: requiredId(raw, 'id', 'panel'),
    order: boundedInt(raw, 'order', undefined, 'panel', 0),
    title: optionalString(raw, 'title', '', 'panel', 120),
    sourceKind: enumValue(raw, 'sourceKind', SOURCE_KINDS, 'panel', 'panel'),
    startOffset: optionalInt(raw, 'startOffset', 'panel', 0),
    endOffset: optionalInt(raw, 'endOffset', 'panel', 0),
    selectedText: optionalString(raw, 'selectedText', '', 'panel'),
    storyText: optionalString(raw, 'storyText', '', 'panel'),
    visibleText: optionalString(raw, 'visibleText', '', 'panel'),
    richText: optionalString(raw, 'richText', '', 'panel'),
    textStyle: validateTextStyle(raw.textStyle, 'panel.textStyle'),
    pageId: raw.pageId === undefined || raw.pageId === null ? null : optionalString(raw, 'pageId', '', 'panel'),
    panelKind: enumValue(raw, 'panelKind', PANEL_KINDS, 'image', 'panel'),
    spansSpread: optionalBool(raw, 'spansSpread', false, 'panel'),
    rect: raw.rect === undefined || raw.rect === null ? defaultRect() : validateRect(raw.rect, 'panel.rect'),
    layer: boundedInt(raw, 'layer', 0, 'panel', 0),
    parentPanelId: optionalId(raw, 'parentPanelId', 'panel'),
    assetIds: stringList(raw, 'assetIds', 'panel'),
    activeAssetId: raw.activeAssetId === undefined || raw.activeAssetId === null ? null : optionalString(raw, 'activeAssetId', '', 'panel'),
    aspectRatio: raw.aspectRatio === undefined || raw.aspectRatio === null ? null : optionalString(raw, 'aspectRatio', '', 'panel'),
    aspectRatioLocked: optionalBool(raw, 'aspectRatioLocked', false, 'panel'),
    imageCrop: validateImageCrop(raw.imageCrop),
    captions: Array.isArray(raw.captions) ? raw.captions.map(validateCaption) : [],
    imagePrompts: Array.isArray(raw.imagePrompts) ? raw.imagePrompts.map(validateImagePrompt) : [],
    characterSlugs: stringList(raw, 'characterSlugs', 'panel'),
    locationSlug: raw.locationSlug === undefined || raw.locationSlug === null ? null : optionalString(raw, 'locationSlug', '', 'panel'),
    finalized: optionalBool(raw, 'finalized', false, 'panel'),
  };
  if (raw.captions !== undefined && raw.captions !== null && !Array.isArray(raw.captions)) throw invalid('panel.captions must be a list');
  if (raw.imagePrompts !== undefined && raw.imagePrompts !== null && !Array.isArray(raw.imagePrompts)) throw invalid('panel.imagePrompts must be a list');
  validateOffsets(panel.startOffset, panel.endOffset, 'Panel');
  if (panel.sourceKind === 'bookmark') {
    if (panel.startOffset === null || panel.endOffset === null) throw invalid('Bookmark items must have book offsets');
    if (panel.parentPanelId !== null) throw invalid('Bookmark items must not have parentPanelId');
    if (panel.pageId !== null) throw invalid('Bookmark items must not be placed on the layout');
  } else if (panel.parentPanelId !== null) {
    throw invalid('Captions must be stored on their parent panel');
  }
  if (panel.activeAssetId != null && !panel.assetIds.includes(panel.activeAssetId)) {
    throw invalid('activeAssetId must be attached to the panel');
  }
  if (!panel.spansSpread) {
    if (panel.rect.x + panel.rect.w > LAYOUT_GRID_COLUMNS + EPSILON) throw invalid('Panel layout must fit within the 12-column page grid');
    for (const caption of panel.captions) {
      if (caption.rect.x + caption.rect.w > LAYOUT_GRID_COLUMNS + EPSILON) throw invalid('Caption layout must fit within the 12-column page grid');
    }
  }
  return panel;
}

function validatePageSettings(value: unknown): StoryPanelPageSettings {
  if (value === undefined || value === null) return { width: 2, height: 3 };
  const raw = asRecord(value, 'pageSettings');
  return { width: boundedInt(raw, 'width', 2, 'pageSettings', 1, 100), height: boundedInt(raw, 'height', 3, 'pageSettings', 1, 100) };
}

function duplicate(ids: string[]): string | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

function storyRanges(document: StoryPanelDocument): Array<[number, number, string]> {
  const ranges: Array<[number, number, string]> = [];
  for (const panel of document.panels) {
    if (panel.sourceKind === 'panel' && panel.startOffset !== null && panel.endOffset !== null) {
      ranges.push([panel.startOffset, panel.endOffset, panel.id]);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));
}

/** Book-linked panel ranges must not overlap. */
export function validateStoryOverlaps(document: StoryPanelDocument): void {
  const ranges = storyRanges(document);
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (previous[1] > current[0]) throw invalid(`Panel text ranges overlap: ${previous[2]} and ${current[2]}`);
  }
}

/** `StoryPanelDocument.model_validate`: fill defaults, then the document-level rules. */
export function validateDocument(value: unknown): StoryPanelDocument {
  const raw = asRecord(value, 'document');
  if (raw.pages !== undefined && raw.pages !== null && !Array.isArray(raw.pages)) throw invalid('document.pages must be a list');
  if (raw.panels !== undefined && raw.panels !== null && !Array.isArray(raw.panels)) throw invalid('document.panels must be a list');
  const document: StoryPanelDocument = {
    version: 1,
    bookSource: optionalString(raw, 'bookSource', 'adaptation/book.txt', 'document'),
    pageSettings: validatePageSettings(raw.pageSettings),
    pages: Array.isArray(raw.pages) ? raw.pages.map(validatePage) : [],
    panels: Array.isArray(raw.panels) ? raw.panels.map(validatePanel) : [],
  };
  if (duplicate(document.pages.map((page) => page.id)) !== null) throw invalid('Duplicate page ids');
  const panelIds = document.panels.map((panel) => panel.id);
  if (duplicate(panelIds) !== null) throw invalid('Duplicate panel ids');
  const captionIds = document.panels.flatMap((panel) => panel.captions.map((caption) => caption.id));
  if (duplicate(captionIds) !== null) throw invalid('Duplicate caption ids');
  const panelIdSet = new Set(panelIds);
  const overlap = captionIds.filter((id) => panelIdSet.has(id)).sort();
  if (overlap.length) throw invalid(`Caption id duplicates panel id: ${overlap[0]}`);
  const pageIds = new Set(document.pages.map((page) => page.id));
  for (const panel of document.panels) {
    if (panel.pageId !== null && !pageIds.has(panel.pageId)) throw invalid(`Panel references unknown page: ${panel.pageId}`);
  }
  validateStoryOverlaps(document);
  return document;
}

// --- documents ----------------------------------------------------------------------

function storyPanelsBlobDir(slug: string): string {
  return `projects/${slug}/story-panels`;
}

function fixedPage(id: string, order: number, title: string, pageKind: StoryPanelPage['pageKind']): StoryPanelPage {
  return { id, order, title, pageKind };
}

export function defaultStoryPages(): StoryPanelPage[] {
  return [1, 2, 3, 4].map((index) => ({ id: `page-${String(index).padStart(3, '0')}`, order: index + 1, title: `Page ${index}`, pageKind: 'story' as const }));
}

export function defaultPage(): StoryPanelPage {
  return defaultStoryPages()[0];
}

function sortPages<T extends StoryPanelPage>(pages: T[]): T[] {
  return [...pages].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function storyPagesSorted(document: StoryPanelDocument): StoryPanelPage[] {
  return sortPages(document.pages.filter((page) => page.pageKind === 'story'));
}

function storyPageIds(document: StoryPanelDocument): Set<string> {
  return new Set(document.pages.filter((page) => page.pageKind === 'story').map((page) => page.id));
}

/** Fixed page frame: cover, inside front cover, the story pages, inside back
 *  cover, back cover; `order` renumbered in that sequence. */
export function normalizeDocument(document: StoryPanelDocument): StoryPanelDocument {
  const existingById = new Map(document.pages.map((page) => [page.id, page]));
  let storyPages = storyPagesSorted(document);
  if (!storyPages.length) storyPages = defaultStoryPages();
  const fixedFront = [fixedPage('cover', 0, 'Front Cover', 'cover'), fixedPage('inside-front-cover', 1, 'Inside Front Cover', 'inside-cover')];
  const fixedBack = [fixedPage('inside-back-cover', 0, 'Inside Back Cover', 'inside-back-cover'), fixedPage('back-cover', 0, 'Back Cover', 'back-cover')];
  const ordered: StoryPanelPage[] = [];
  for (const fixed of [...fixedFront, ...storyPages, ...fixedBack]) {
    const existing = existingById.get(fixed.id);
    if (existing && fixed.pageKind !== 'story') {
      ordered.push({ ...existing, title: fixed.title, pageKind: fixed.pageKind });
    } else {
      ordered.push(existing ?? fixed);
    }
  }
  document.pages = ordered.map((page, index) => ({ ...page, order: index }));
  return document;
}

/** Seed the Title / Copyright / About text blocks on empty fixed pages. */
export function ensureDefaultFixedPagePanels(document: StoryPanelDocument): void {
  const defaults: Array<{ pageId: string; title: string; visibleText: string; rect: StoryPanelRect }> = [
    { pageId: 'cover', title: 'Title', visibleText: 'Title goes here', rect: { x: 1.5, y: 1.25, w: 9, h: 1.25 } },
    { pageId: 'inside-front-cover', title: 'Copyright', visibleText: 'Copyright information goes here.', rect: { x: 1, y: 1, w: 10, h: 2 } },
    { pageId: 'inside-back-cover', title: 'About', visibleText: 'About this comic, acknowledgements, or bonus notes go here.', rect: { x: 1, y: 1, w: 10, h: 2 } },
  ];
  const existingPages = new Set(document.pages.map((page) => page.id));
  const occupiedPages = new Set(document.panels.filter((panel) => panel.pageId !== null).map((panel) => panel.pageId));
  let nextOrder = maxOrder(document.panels) + 1;
  for (const entry of defaults) {
    if (!existingPages.has(entry.pageId) || occupiedPages.has(entry.pageId)) continue;
    document.panels.push(
      validatePanel({
        id: nextPanelId(document),
        order: nextOrder,
        title: entry.title,
        sourceKind: 'panel',
        visibleText: entry.visibleText,
        pageId: entry.pageId,
        panelKind: 'text',
        rect: entry.rect,
        layer: 0,
      }),
    );
    nextOrder += 1;
  }
}

function maxOrder(items: Array<{ order: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.order), -1);
}

export function emptyDocument(): StoryPanelDocument {
  const document = normalizeDocument({ version: 1, bookSource: 'adaptation/book.txt', pageSettings: { width: 2, height: 3 }, pages: defaultStoryPages(), panels: [] });
  ensureDefaultFixedPagePanels(document);
  return document;
}

export function readBook(slug: string): Promise<string> {
  return adaptation.readBook(slug);
}

export function optionalBookText(slug: string): Promise<string | null> {
  return adaptation.optionalBookText(slug);
}

/** Re-slice every book-linked panel's `selectedText` from the book (and
 *  `storyText` for story panels); mismatches and out-of-range offsets are invalid. */
export async function validateAgainstBook(slug: string, document: StoryPanelDocument): Promise<StoryPanelDocument> {
  const book = await optionalBookText(slug);
  if (book === null) return document;
  for (const panel of document.panels) {
    if (panel.startOffset === null || panel.endOffset === null) continue;
    if (panel.endOffset > book.length) throw invalid(`Panel range exceeds book length: ${panel.id}`);
    const selected = book.slice(panel.startOffset, panel.endOffset);
    if (panel.selectedText && panel.selectedText !== selected) throw invalid(`Panel selectedText does not match book range: ${panel.id}`);
    panel.selectedText = selected;
    if (panel.sourceKind === 'panel') panel.storyText = selected;
  }
  return document;
}

async function readRawDocument(slug: string): Promise<unknown | undefined> {
  await requireProject(slug);
  return getProjectDoc<unknown>('storyPanels', slug);
}

export async function readDocument(slug: string): Promise<StoryPanelDocument> {
  const raw = await readRawDocument(slug);
  if (raw === undefined) return emptyDocument();
  return validateAgainstBook(slug, normalizeDocument(validateDocument(raw)));
}

async function writeDocument(slug: string, document: StoryPanelDocument): Promise<StoryPanelDocument> {
  await putProjectDoc('storyPanels', slug, cloneJson(document));
  notifyChange('storyPanels', slug);
  return document;
}

export async function saveDocument(slug: string, document: StoryPanelDocument): Promise<StoryPanelDocument> {
  await requireProject(slug);
  return writeDocument(slug, await validateAgainstBook(slug, normalizeDocument(validateDocument(document))));
}

// --- ids and pages ------------------------------------------------------------------

function pad3(index: number): string {
  return String(index).padStart(3, '0');
}

/** `panel-NNN`, counting captions as taken ids too. */
export function nextPanelId(document: StoryPanelDocument): string {
  const existing = new Set(document.panels.map((panel) => panel.id));
  for (const panel of document.panels) for (const caption of panel.captions) existing.add(caption.id);
  let index = existing.size + 1;
  for (;;) {
    const candidate = `panel-${pad3(index)}`;
    if (!existing.has(candidate)) return candidate;
    index += 1;
  }
}

export function nextImagePromptId(prompts: StoryPanelImagePrompt[]): string {
  const existing = new Set(prompts.map((prompt) => prompt.id));
  let index = prompts.length + 1;
  while (existing.has(`prompt-${pad3(index)}`)) index += 1;
  return `prompt-${pad3(index)}`;
}

function nextPage(document: StoryPanelDocument): StoryPanelPage {
  const story = storyPagesSorted(document);
  if (story.length) return story[0];
  const page = defaultPage();
  document.pages.push(page);
  return page;
}

function appendStoryPage(document: StoryPanelDocument): StoryPanelPage {
  const existing = new Set(document.pages.map((page) => page.id));
  let index = storyPagesSorted(document).length + 1;
  while (existing.has(`page-${pad3(index)}`)) index += 1;
  const page: StoryPanelPage = { id: `page-${pad3(index)}`, order: maxOrder(document.pages) + 1, title: `Page ${index}`, pageKind: 'story' };
  document.pages.push(page);
  return page;
}

function nextStoryPage(document: StoryPanelDocument, pageId: string): StoryPanelPage {
  const story = storyPagesSorted(document);
  const index = story.findIndex((page) => page.id === pageId);
  if (index >= 0 && index + 1 < story.length) return story[index + 1];
  return appendStoryPage(document);
}

// --- auto placement -----------------------------------------------------------------

function clampPanelRect(rect: StoryPanelRect): StoryPanelRect {
  const h = Math.min(rect.h, LAYOUT_PAGE_ROWS);
  const y = Math.min(rect.y, LAYOUT_PAGE_ROWS - h);
  return { x: rect.x, y: Math.max(0, y), w: rect.w, h };
}

function slotFits(x: number, y: number, w: number, h: number): boolean {
  return x + w <= LAYOUT_GRID_COLUMNS + EPSILON && y + h <= LAYOUT_PAGE_ROWS + EPSILON;
}

function panelsOnPage(document: StoryPanelDocument, pageId: string): StoryPanel[] {
  return document.panels.filter((panel) => panel.pageId === pageId && panel.layer === 0);
}

function candidateSlotXY(document: StoryPanelDocument, pageId: string, anchor: StoryPanel, w: number, h: number): [number, number] {
  const nextX = anchor.rect.x + anchor.rect.w;
  const nextY = anchor.rect.y;
  if (slotFits(nextX, nextY, w, h)) return [nextX, nextY];
  const sameRow = panelsOnPage(document, pageId).filter((panel) => panel.rect.y === anchor.rect.y);
  const rowBottom = Math.max(...(sameRow.length ? sameRow : [anchor]).map((panel) => panel.rect.y + panel.rect.h));
  return [0, rowBottom];
}

export interface AutoPlaceSlotOptions {
  pageId: string;
  after?: StoryPanel | null;
  w?: number;
  h?: number;
}

/** Next free slot after `after` on `pageId`, overflowing onto the next (or a new) story page. */
export function autoPlaceSlot(document: StoryPanelDocument, options: AutoPlaceSlotOptions): [string, StoryPanelRect] {
  const w = options.w ?? DEFAULT_AUTO_PLACE_W;
  const h = options.h ?? DEFAULT_AUTO_PLACE_H;
  let [x, y] = options.after ? candidateSlotXY(document, options.pageId, options.after, w, h) : [0, 0];
  let currentPageId = options.pageId;
  while (!slotFits(x, y, w, h)) {
    currentPageId = nextStoryPage(document, currentPageId).id;
    x = 0;
    y = 0;
  }
  return [currentPageId, clampPanelRect({ x, y, w, h })];
}

function defaultPlacement(document: StoryPanelDocument, pageId: string): [string, StoryPanelRect] {
  const onPage = panelsOnPage(document, pageId);
  if (!onPage.length) return autoPlaceSlot(document, { pageId });
  const ordered = [...onPage].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  return autoPlaceSlot(document, { pageId, after: ordered[ordered.length - 1] });
}

function isTopLevelStoryPanel(panel: StoryPanel): boolean {
  return panel.sourceKind === 'panel' && (panel.parentPanelId ?? null) === null;
}

/** Place a book-linked panel next to its nearest placed neighbour in book order. */
export function storyOrderPlacement(document: StoryPanelDocument, startOffset: number): [string, StoryPanelRect] {
  const ordered = document.panels
    .filter((panel) => isTopLevelStoryPanel(panel) && panel.startOffset !== null && panel.endOffset !== null && panel.pageId !== null)
    .sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0) || (a.endOffset ?? 0) - (b.endOffset ?? 0) || a.order - b.order);
  const previous = [...ordered].reverse().find((panel) => (panel.startOffset ?? 0) <= startOffset) ?? null;
  const next = ordered.find((panel) => (panel.startOffset ?? 0) > startOffset) ?? null;
  const anchor = previous ?? next;
  if (!anchor || anchor.pageId === null) return autoPlaceSlot(document, { pageId: nextPage(document).id });
  return autoPlaceSlot(document, { pageId: anchor.pageId, after: anchor });
}

function placeAfterPanel(document: StoryPanelDocument, anchor: StoryPanel): [string, StoryPanelRect] {
  if (anchor.pageId === null) return autoPlaceSlot(document, { pageId: nextPage(document).id });
  return autoPlaceSlot(document, { pageId: anchor.pageId, after: anchor });
}

/** Place a draft panel after `insertAfterPanelId` (when placed on a story page) or after the last placed story-page panel. */
export function draftOrderPlacement(document: StoryPanelDocument, insertAfterPanelId: string | null | undefined): [string, StoryPanelRect] {
  const storyIds = storyPageIds(document);
  if (insertAfterPanelId) {
    const anchor = document.panels.find((panel) => panel.id === insertAfterPanelId);
    if (anchor && isTopLevelStoryPanel(anchor) && anchor.pageId !== null && storyIds.has(anchor.pageId)) {
      return placeAfterPanel(document, anchor);
    }
  }
  const placed = document.panels
    .filter((panel) => isTopLevelStoryPanel(panel) && panel.pageId !== null && storyIds.has(panel.pageId))
    .sort((a, b) => a.order - b.order);
  if (placed.length) return placeAfterPanel(document, placed[placed.length - 1]);
  return autoPlaceSlot(document, { pageId: nextPage(document).id });
}

/** Order slot after `afterPanelId` (shifting later panels) or at the end. */
export function orderForInsertAfter(document: StoryPanelDocument, afterPanelId: string | null | undefined): number {
  if (afterPanelId === null || afterPanelId === undefined) return maxOrder(document.panels) + 1;
  const after = document.panels.find((panel) => panel.id === afterPanelId);
  if (!after) throw notFound(`Panel not found: ${afterPanelId}`);
  const insertOrder = after.order + 1;
  for (const panel of document.panels) {
    if (panel.order >= insertOrder) panel.order += 1;
  }
  return insertOrder;
}

// --- panel CRUD ---------------------------------------------------------------------

function requirePanelIndex(document: StoryPanelDocument, panelId: string): number {
  const index = document.panels.findIndex((panel) => panel.id === panelId);
  if (index < 0) throw notFound(`Panel not found: ${panelId}`);
  return index;
}

function requirePage(document: StoryPanelDocument, pageId: string): StoryPanelPage {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw invalid(`Unknown page: ${pageId}`);
  return page;
}

function optionalPayloadId(value: string | null | undefined, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (!TAG_RE.test(value)) throw invalid(`${label} must be a slug: ${value}`);
  return value;
}

export async function createPanel(slug: string, payload: StoryPanelCreatePayload): Promise<StoryPanelDocument> {
  const startOffset = payload.startOffset ?? null;
  const endOffset = payload.endOffset ?? null;
  validateOffsets(startOffset, endOffset, 'Panel');
  if (startOffset !== null && startOffset < 0) throw invalid('Panel startOffset must be at least 0');
  const title = (payload.title ?? '').trim();
  if (title.length > 120) throw invalid('Panel title must be at most 120 characters');
  const insertAfterPanelId = optionalPayloadId(payload.insertAfterPanelId, 'insertAfterPanelId');
  const layer = payload.layer ?? 0;
  if (!Number.isInteger(layer) || layer < 0) throw invalid('Panel layer must be a non-negative integer');
  const imagePrompts = (payload.imagePrompts ?? []).map(validateImagePrompt);

  const document = await readDocument(slug);
  const hasBookOffsets = startOffset !== null && endOffset !== null;
  let pageId = optionalPayloadId(payload.pageId, 'pageId');
  let rect = payload.rect ? validateRect(payload.rect) : null;
  if (payload.autoPlace ?? true) {
    const [inferredPageId, inferredRect] = hasBookOffsets ? storyOrderPlacement(document, startOffset) : draftOrderPlacement(document, insertAfterPanelId);
    pageId = pageId ?? inferredPageId;
    requirePage(document, pageId);
    if (rect) {
      // explicit rect wins
    } else if (pageId === inferredPageId) {
      rect = inferredRect;
    } else {
      [pageId, rect] = defaultPlacement(document, pageId);
    }
  } else if (pageId !== null) {
    requirePage(document, pageId);
    if (!rect) [pageId, rect] = defaultPlacement(document, pageId);
  } else {
    rect = rect ?? defaultRect();
  }

  let selected = (payload.selectedText ?? '').trim();
  let storyText = (payload.storyText ?? '').trim();
  const visibleText = (payload.visibleText ?? '').trim();
  if (hasBookOffsets) {
    const book = await readBook(slug);
    if (endOffset > book.length) throw invalid('Panel range exceeds book length');
    selected = book.slice(startOffset, endOffset);
    if (payload.selectedText && payload.selectedText !== selected) throw invalid('Panel selectedText does not match book range');
    storyText = selected;
  } else if (selected && !storyText) {
    storyText = selected;
  }
  const order = orderForInsertAfter(document, insertAfterPanelId);
  document.panels.push(
    validatePanel({
      id: nextPanelId(document),
      order,
      title,
      sourceKind: 'panel',
      startOffset,
      endOffset,
      selectedText: selected,
      storyText,
      visibleText,
      imagePrompts,
      pageId,
      panelKind: payload.panelKind ?? 'image',
      rect,
      layer,
    }),
  );
  if (hasBookOffsets) validateStoryOverlaps(document);
  return saveDocument(slug, document);
}

export async function createBookmark(slug: string, payload: StoryPanelBookmarkCreatePayload): Promise<StoryPanelDocument> {
  if (!Number.isInteger(payload.startOffset) || payload.startOffset < 0) throw invalid('Bookmark startOffset must be a non-negative integer');
  if (!Number.isInteger(payload.endOffset) || payload.endOffset <= payload.startOffset) throw invalid('Bookmark endOffset must be greater than startOffset');
  if ((payload.title ?? '').length > 120) throw invalid('Bookmark title must be at most 120 characters');
  const insertAfterPanelId = optionalPayloadId(payload.insertAfterPanelId, 'insertAfterPanelId');
  const document = await readDocument(slug);
  const book = await optionalBookText(slug);
  if (book === null) throw notFound('Book not found');
  if (payload.endOffset > book.length) throw invalid('Bookmark range exceeds book length');
  const selected = book.slice(payload.startOffset, payload.endOffset);
  if (payload.selectedText && payload.selectedText !== selected) throw invalid('Bookmark selectedText does not match book range');
  const title = (payload.title ?? '').trim() || selected.replace(/\n/g, ' ').trim().slice(0, 120);
  const order = orderForInsertAfter(document, insertAfterPanelId);
  document.panels.push(
    validatePanel({
      id: nextPanelId(document),
      order,
      sourceKind: 'bookmark',
      startOffset: payload.startOffset,
      endOffset: payload.endOffset,
      selectedText: selected,
      title,
      pageId: null,
      panelKind: 'text',
      rect: defaultRect(),
      layer: 0,
    }),
  );
  return saveDocument(slug, document);
}

export async function patchPanel(slug: string, panelId: string, patch: StoryPanelPatchPayload): Promise<StoryPanelDocument> {
  const document = await readDocument(slug);
  const index = requirePanelIndex(document, panelId);
  const current = document.panels[index];
  const updates: Raw = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) updates[key] = value;
  }
  if ('characterSlugs' in updates || 'locationSlug' in updates) {
    await validatePanelEntities(slug, updates.characterSlugs as string[] | null | undefined, updates.locationSlug as string | null | undefined);
  }
  if ('pageId' in updates) {
    const pageId = updates.pageId;
    if (pageId !== null && (typeof pageId !== 'string' || !document.pages.some((page) => page.id === pageId))) {
      throw invalid(`Unknown page: ${String(pageId)}`);
    }
  }
  const next = validatePanel({ ...current, ...updates });
  document.panels[index] = next;
  if (next.sourceKind === 'panel' && next.startOffset !== null && next.endOffset !== null) validateStoryOverlaps(document);
  return saveDocument(slug, document);
}

export async function autoPlacePanel(slug: string, panelId: string): Promise<StoryPanelDocument> {
  const document = await readDocument(slug);
  const index = requirePanelIndex(document, panelId);
  const panel = document.panels[index];
  if (!isTopLevelStoryPanel(panel)) throw invalid('Only top-level panels can be auto-placed on the layout');
  if (panel.pageId !== null) throw invalid('Panel is already placed on the layout');
  const ordered = document.panels.filter(isTopLevelStoryPanel).sort((a, b) => a.order - b.order);
  const position = ordered.findIndex((candidate) => candidate.id === panelId);
  const insertAfterId = position > 0 ? ordered[position - 1].id : null;
  const [pageId, rect] = draftOrderPlacement(document, insertAfterId);
  document.panels[index] = { ...panel, pageId, rect };
  if (panel.startOffset !== null && panel.endOffset !== null) validateStoryOverlaps(document);
  return saveDocument(slug, document);
}

export async function deletePanel(slug: string, panelId: string): Promise<StoryPanelDocument> {
  const document = await readDocument(slug);
  const next = document.panels.filter((panel) => panel.id !== panelId);
  if (next.length === document.panels.length) throw notFound(`Panel not found: ${panelId}`);
  document.panels = next;
  return saveDocument(slug, document);
}

export async function addPage(slug: string, title = ''): Promise<StoryPanelDocument> {
  const document = await readDocument(slug);
  const existing = new Set(document.pages.map((page) => page.id));
  let index = existing.size + 1;
  let pageId = title ? slugify(title, 'panel') : `page-${pad3(index)}`;
  while (existing.has(pageId)) {
    index += 1;
    pageId = `page-${pad3(index)}`;
  }
  document.pages.push({ id: pageId, order: maxOrder(document.pages) + 1, title: title || `Page ${index}`, pageKind: 'story' });
  return saveDocument(slug, document);
}

// --- image prompts and entities -----------------------------------------------------

function validateImagePromptText(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) throw invalid('Image prompt text must not be empty');
  if (CHAT_WRAPPER_RE.test(cleaned)) throw invalid('Image prompt text must be plain prose without chat wrapper phrases');
  return cleaned;
}

/** Entity slugs must exist in the adaptation records (variant flat keys such as `hero-young` count). */
export async function validatePanelEntities(slug: string, characterSlugs: string[] | null | undefined, locationSlug: string | null | undefined): Promise<void> {
  if (!characterSlugs?.length && !locationSlug) return;
  const metadata = await adaptation.readMetadata(slug);
  const validCharacters = adaptation.entityFlatKeys(metadata.characters);
  const unknownCharacters = (characterSlugs ?? []).filter((item) => !validCharacters.has(item));
  if (unknownCharacters.length) {
    const known = [...validCharacters].sort().join(', ') || '(none extracted yet)';
    throw invalid(`Unknown character slugs: ${unknownCharacters.join(', ')}. Known characters: ${known}`);
  }
  const validLocations = adaptation.entityFlatKeys(metadata.locations);
  if (locationSlug && !validLocations.has(locationSlug)) {
    const known = [...validLocations].sort().join(', ') || '(none extracted yet)';
    throw invalid(`Unknown location slug: ${locationSlug}. Known locations: ${known}`);
  }
}

export interface ImagePromptEntityOptions {
  characterSlugs?: string[] | null;
  locationSlug?: string | null;
}

/** Append a validated image prompt; returns the new prompt id. Entity slugs
 *  (agent delivery) are validated and written onto the panel. */
export async function appendImagePrompt(slug: string, panelId: string, text: string, options: ImagePromptEntityOptions = {}): Promise<string> {
  const cleaned = validateImagePromptText(text);
  await validatePanelEntities(slug, options.characterSlugs, options.locationSlug);
  const document = await readDocument(slug);
  const index = requirePanelIndex(document, panelId);
  const panel = document.panels[index];
  const promptId = nextImagePromptId(panel.imagePrompts);
  const next: StoryPanel = { ...panel, imagePrompts: [...panel.imagePrompts, { id: promptId, text: cleaned }] };
  if (options.characterSlugs !== undefined && options.characterSlugs !== null) next.characterSlugs = [...new Set(options.characterSlugs)];
  if (options.locationSlug !== undefined && options.locationSlug !== null) next.locationSlug = options.locationSlug;
  document.panels[index] = next;
  await saveDocument(slug, document);
  return promptId;
}

/** Replace one existing image prompt's text in place. */
export async function replaceImagePrompt(slug: string, panelId: string, promptId: string, text: string): Promise<void> {
  const cleaned = validateImagePromptText(text);
  const document = await readDocument(slug);
  const index = requirePanelIndex(document, panelId);
  const panel = document.panels[index];
  if (!panel.imagePrompts.some((prompt) => prompt.id === promptId)) throw notFound(`Image prompt not found: ${promptId}`);
  document.panels[index] = {
    ...panel,
    imagePrompts: panel.imagePrompts.map((prompt) => (prompt.id === promptId ? { ...prompt, text: cleaned } : prompt)),
  };
  await saveDocument(slug, document);
}

/** Create a canvas image-group node for one panel image prompt. The node's
 *  refs are the canonical assets of the panel's tagged entities; refuses
 *  (`conflict`) when a tagged entity has no reference asset yet. */
export async function draftPanelToCanvas(slug: string, panelId: string, promptId: string): Promise<ConceptNodeResponse> {
  const document = await readDocument(slug);
  const panel = document.panels[requirePanelIndex(document, panelId)];
  const prompt = panel.imagePrompts.find((item) => item.id === promptId);
  if (!prompt) throw notFound(`Image prompt not found: ${promptId}`);
  if (!prompt.text.trim()) throw conflict('Image prompt is empty');

  await adaptation.status(slug); // refresh entity links and canonical tag pointers
  const entityTags = new Map((await listProjectTags(slug)).filter((tag) => tag.entityKind != null).map((tag) => [tag.id, tag]));
  const refs: string[] = [];
  const missing: string[] = [];
  const resolve = (entitySlug: string, label: string) => {
    const assetId = entityTags.get(normalizeTagId(entitySlug))?.canonicalAssetId ?? null;
    if (assetId === null) missing.push(`${label} ${entitySlug}`);
    else if (!refs.includes(assetId)) refs.push(assetId);
  };
  for (const characterSlug of panel.characterSlugs) resolve(characterSlug, 'character');
  if (panel.locationSlug) resolve(panel.locationSlug, 'location');
  if (missing.length) throw conflict(`Missing reference images — generate them first: ${missing.join(', ')}`);

  const canvas = await readStoredCanvas(slug);
  const { x, y } = nextCanvasPosition(canvas);
  const tags = ['comic-adaptation', 'story-panel', panelId, ...panel.characterSlugs];
  if (panel.locationSlug) tags.push(panel.locationSlug);
  const { nodeId, canvas: saved } = await createImageGroupNode(slug, {
    displayName: panel.title.trim() || `Panel ${panelId}`,
    tags: nodeTags(...tags),
    prompt: prompt.text,
    refs,
    params: {},
    x,
    y,
    origin: { kind: 'panel', id: panelId },
  });
  return { nodeId, canvas: saved };
}

/** Attach generated assets to the panel (newest becomes active, crop reset). Tolerates a deleted panel. */
export async function attachAssetsToPanel(slug: string, panelId: string, assetIds: string[]): Promise<void> {
  if (!assetIds.length) return;
  const document = await readDocument(slug);
  const index = document.panels.findIndex((panel) => panel.id === panelId);
  if (index < 0) return;
  const panel = document.panels[index];
  document.panels[index] = { ...panel, assetIds: [...new Set([...panel.assetIds, ...assetIds])], activeAssetId: assetIds[0], imageCrop: null };
  await saveDocument(slug, document);
}

// --- resets -------------------------------------------------------------------------

/** Parse the stored document without book cross-checks; null when it no longer validates. */
async function readDocumentLenient(slug: string): Promise<StoryPanelDocument | null> {
  const raw = await readRawDocument(slug);
  if (raw === undefined) return emptyDocument();
  try {
    return normalizeDocument(validateDocument(raw));
  } catch (error) {
    if (isServiceError(error, 'invalid')) return null;
    throw error;
  }
}

export function backupBlobPath(slug: string, stamp: string): string {
  return `${storyPanelsBlobDir(slug)}/${BACKUP_PREFIX}${stamp.replace(/:/g, '-')}`;
}

/** Copy the stored document aside before a destructive reset; keeps the newest three backups. */
async function backupDocument(slug: string): Promise<void> {
  const raw = await getProjectDoc<unknown>('storyPanels', slug);
  if (raw === undefined) return;
  await writeBlob(backupBlobPath(slug, utcNow()), JSON.stringify(raw, null, 2));
  const backups = (await listDir(storyPanelsBlobDir(slug)))
    .filter((entry) => entry.kind === 'file' && entry.name.startsWith(BACKUP_PREFIX))
    .map((entry) => entry.name)
    .sort();
  for (const name of backups.slice(0, Math.max(0, backups.length - BACKUPS_TO_KEEP))) {
    await deleteBlob(`${storyPanelsBlobDir(slug)}/${name}`);
  }
}

export async function listBackups(slug: string): Promise<string[]> {
  return (await listDir(storyPanelsBlobDir(slug)))
    .filter((entry) => entry.kind === 'file' && entry.name.startsWith(BACKUP_PREFIX))
    .map((entry) => entry.name)
    .sort();
}

/** Wipe chunks and layout (canvas, assets, tags and adaptation untouched); the old document is backed up. */
export async function resetChunks(slug: string): Promise<StoryPanelDocument> {
  await requireProject(slug);
  await backupDocument(slug);
  return writeDocument(slug, emptyDocument());
}

/** Drop page placement and layout-only state; keep story, draft and bookmark chunks.
 *  Falls back to `resetChunks` when the stored document no longer validates. */
export async function resetLayout(slug: string): Promise<StoryPanelDocument> {
  const document = await readDocumentLenient(slug);
  if (document === null) {
    console.warn(`story panels for ${slug} no longer validate; falling back to resetChunks`);
    return resetChunks(slug);
  }
  document.panels = document.panels
    .filter((panel) => panel.sourceKind === 'bookmark' || isTopLevelStoryPanel(panel))
    .map((panel) => (panel.sourceKind === 'bookmark' ? panel : { ...panel, pageId: null, rect: defaultRect(), layer: 0, finalized: false }));
  normalizeDocument(document);
  ensureDefaultFixedPagePanels(document);
  return saveDocument(slug, document);
}
