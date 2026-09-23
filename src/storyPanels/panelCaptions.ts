import type { StoryPanel, StoryPanelDocument, StoryPanelRect } from '../types';
import { LAYOUT_PAGE_ROWS } from './printLayout';
import { captionAsPanel, isCaption } from './panelModel';

export const CAPTION_GRID_SNAP = 12;
const CAPTION_GRID_COLUMNS = 12;
const CAPTION_MIN_WIDTH = 0.5;
const CAPTION_MIN_HEIGHT = 0.25;

export function sortCaptionPanels(panels: StoryPanel[]) {
  return [...panels].sort((first, second) => first.order - second.order || first.rect.y - second.rect.y || first.id.localeCompare(second.id));
}

export function captionPanelsFor(document: StoryPanelDocument, parentPanelId: string) {
  const parent = document.panels.find((panel) => panel.id === parentPanelId);
  if (!parent) return [];
  return sortCaptionPanels((parent.captions ?? []).map((caption) => captionAsPanel(parent, caption)));
}

function roundCaptionStep(value: number) {
  return Math.round(value * CAPTION_GRID_SNAP) / CAPTION_GRID_SNAP;
}

export function clampCaptionRect(rect: StoryPanelRect, columns: number = CAPTION_GRID_COLUMNS): StoryPanelRect {
  const w = Math.min(columns, Math.max(CAPTION_MIN_WIDTH, roundCaptionStep(rect.w)));
  let h = Math.max(CAPTION_MIN_HEIGHT, roundCaptionStep(rect.h));
  h = Math.min(h, LAYOUT_PAGE_ROWS);
  const x = Math.min(columns - w, Math.max(0, roundCaptionStep(rect.x)));
  let y = Math.max(0, roundCaptionStep(rect.y));
  y = Math.min(y, LAYOUT_PAGE_ROWS - h);
  return { x, y, w, h };
}

export function defaultCaptionRect(parent: StoryPanel, captions: StoryPanel[], columns: number = CAPTION_GRID_COLUMNS): StoryPanelRect {
  const gap = 1 / CAPTION_GRID_SNAP;
  const bottom = captions.length
    ? Math.max(...captions.map((caption) => caption.rect.y + caption.rect.h))
    : parent.rect.y + parent.rect.h;
  return clampCaptionRect({
    x: parent.rect.x,
    y: bottom + gap,
    w: parent.rect.w,
    h: 0.5,
  }, columns);
}

export function captionLabel(index: number) {
  return `Caption ${index + 1}`;
}

export function parentPanelFor(document: StoryPanelDocument, panel: StoryPanel) {
  if (!panel.parentPanelId) return null;
  return document.panels.find((candidate) => candidate.id === panel.parentPanelId) ?? null;
}

export function imageInfoHostFor(document: StoryPanelDocument, panel: StoryPanel | null) {
  if (!panel) return null;
  if (isCaption(panel)) {
    const linkedParent = parentPanelFor(document, panel);
    return linkedParent;
  }
  if (panel.panelKind === 'image') return panel;
  return null;
}

export function panelKindHostFor(document: StoryPanelDocument, panel: StoryPanel | null) {
  if (!panel) return null;
  if (isCaption(panel)) {
    return imageInfoHostFor(document, panel);
  }
  return panel;
}

export function removePanelAndCaptionChildren(document: StoryPanelDocument, panelId: string) {
  return document.panels.filter((panel) => panel.id !== panelId);
}

export function captionSnapScaleFor(panel: Pick<StoryPanel, 'sourceKind' | 'parentPanelId'>) {
  return panel.sourceKind === 'panel' && panel.parentPanelId ? CAPTION_GRID_SNAP : null;
}
