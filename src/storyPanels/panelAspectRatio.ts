import { modelCapabilities } from '../canvas/shared';
import type { StoryPanel, StoryPanelRect } from '../types';
import { LAYOUT_GRID_COLUMNS, LAYOUT_PAGE_ROWS, PRINT_PAGE_HEIGHT, PRINT_PAGE_WIDTH } from './printLayout';

export { LAYOUT_GRID_COLUMNS, LAYOUT_PAGE_ROWS };
export const PAGE_LAYOUT_ASPECT = PRINT_PAGE_WIDTH / PRINT_PAGE_HEIGHT;

/** Coarse grid for saved layout (0.25 steps). */
export const PANEL_COMMIT_SNAP_SCALE = 4;
/** Fine grid during locked-aspect drag (0.0625 steps). */
export const PANEL_DRAG_SNAP_SCALE = 16;

export const GEMINI_IMAGE_ASPECT_RATIOS = Array.from(
  new Set(Object.values(modelCapabilities).flatMap((capabilities) => capabilities.aspectRatios)),
).sort((first, second) => parseAspectRatio(first) - parseAspectRatio(second));

export function parseAspectRatio(value: string): number {
  const trimmed = value.trim();
  if (trimmed.includes(':')) {
    const [width, height] = trimmed.split(':').map((part) => Number(part));
    if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
      throw new Error(`Invalid aspect ratio: ${value}`);
    }
    return width / height;
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid aspect ratio: ${value}`);
  }
  return numeric;
}

export function formatAspectRatioFromPixels(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const reducedWidth = Math.max(1, Math.round(width));
  const reducedHeight = Math.max(1, Math.round(height));
  const divisor = gcd(reducedWidth, reducedHeight);
  return `${reducedWidth / divisor}:${reducedHeight / divisor}`;
}

export function nearestGeminiAspectRatio(ratio: number): string {
  return GEMINI_IMAGE_ASPECT_RATIOS.reduce((best, candidate) => (
    Math.abs(parseAspectRatio(candidate) - ratio) < Math.abs(parseAspectRatio(best) - ratio)
      ? candidate
      : best
  ));
}

export function panelVisualAspectRatio(rect: StoryPanelRect, pageRows: number): number {
  const rows = Math.max(1, pageRows);
  return (rect.w * rows * PAGE_LAYOUT_ASPECT) / (rect.h * LAYOUT_GRID_COLUMNS);
}

function pageAspectFactor(pageRows: number): number {
  const rows = Math.max(1, pageRows);
  return (rows * PAGE_LAYOUT_ASPECT) / LAYOUT_GRID_COLUMNS;
}

function heightForWidth(width: number, pageRows: number, targetAspect: number): number {
  return (width * pageAspectFactor(pageRows)) / targetAspect;
}

function widthForHeight(height: number, pageRows: number, targetAspect: number): number {
  return (height * targetAspect) / pageAspectFactor(pageRows);
}

function aspectRatioError(rect: StoryPanelRect, pageRows: number, targetAspect: number): number {
  return Math.abs(panelVisualAspectRatio(rect, pageRows) - targetAspect);
}

function largestAspectRectInBounds(
  rect: StoryPanelRect,
  pageRows: number,
  targetAspect: number,
  columns: number,
): StoryPanelRect {
  const rows = Math.max(1, pageRows);
  const maxWidth = columns - rect.x;
  const maxHeight = rows - rect.y;
  let width = maxWidth;
  let height = heightForWidth(width, pageRows, targetAspect);
  if (height > maxHeight) {
    height = maxHeight;
    width = widthForHeight(height, pageRows, targetAspect);
  }
  return { ...rect, w: width, h: height };
}

export function snapRectToAspectRatio(
  rect: StoryPanelRect,
  pageRows: number,
  targetAspect: number,
  panelKind: StoryPanel['panelKind'],
  clampRect: (rect: StoryPanelRect, panelKind: StoryPanel['panelKind']) => StoryPanelRect,
  columns: number = LAYOUT_GRID_COLUMNS,
): StoryPanelRect {
  const candidates = [
    clampRect({ ...rect, h: heightForWidth(rect.w, pageRows, targetAspect) }, panelKind),
    clampRect({ ...rect, w: widthForHeight(rect.h, pageRows, targetAspect) }, panelKind),
    clampRect(largestAspectRectInBounds(rect, pageRows, targetAspect, columns), panelKind),
  ];
  return candidates.reduce((best, candidate) => (
    aspectRatioError(candidate, pageRows, targetAspect) < aspectRatioError(best, pageRows, targetAspect)
      ? candidate
      : best
  ));
}

function roundGrid(value: number, snapScale: number): number {
  return Math.round(value * snapScale) / snapScale;
}

function fitAspectDimensions(
  proposedWidth: number,
  pageRows: number,
  targetAspect: number,
  limits: { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number },
): { w: number; h: number } {
  const pf = pageAspectFactor(pageRows);
  const hFromW = (width: number) => (width * pf) / targetAspect;
  const wFromH = (height: number) => (height * targetAspect) / pf;

  const widthMin = Math.max(limits.minWidth, wFromH(limits.minHeight));
  const widthMax = Math.min(limits.maxWidth, wFromH(limits.maxHeight));
  let width = proposedWidth;
  if (widthMin <= widthMax) {
    width = Math.min(widthMax, Math.max(widthMin, width));
  } else {
    width = widthMax;
  }
  return { w: width, h: hFromW(width) };
}

export function draggedSizeFromPointer(
  anchor: StoryPanelRect,
  corner: 'nw' | 'ne' | 'sw' | 'se',
  pointer: { clientX: number; clientY: number },
  pageBounds: { left: number; top: number },
  columnWidthPx: number,
  rowHeightPx: number,
): { w: number; h: number } {
  const gridX = (pointer.clientX - pageBounds.left) / columnWidthPx;
  const gridY = (pointer.clientY - pageBounds.top) / rowHeightPx;
  const right = anchor.x + anchor.w;
  const bottom = anchor.y + anchor.h;
  if (corner === 'se') {
    return { w: gridX - anchor.x, h: gridY - anchor.y };
  }
  if (corner === 'nw') {
    return { w: right - gridX, h: bottom - gridY };
  }
  if (corner === 'ne') {
    return { w: gridX - anchor.x, h: bottom - gridY };
  }
  return { w: right - gridX, h: gridY - anchor.y };
}

/** Project free-drag corner onto the aspect line in grid space (h = w * pf / T). */
export function proposedWidthFromDraggedCorner(
  anchor: StoryPanelRect,
  corner: 'nw' | 'ne' | 'sw' | 'se',
  pointer: { clientX: number; clientY: number },
  pageBounds: { left: number; top: number },
  columnWidthPx: number,
  rowHeightPx: number,
  pageRows: number,
  targetAspect: number,
): number {
  const dragged = draggedSizeFromPointer(
    anchor,
    corner,
    pointer,
    pageBounds,
    columnWidthPx,
    rowHeightPx,
  );
  const slope = pageAspectFactor(pageRows) / targetAspect;
  const width = (Math.max(0, dragged.w) + Math.max(0, dragged.h) * slope) / (1 + slope * slope);
  return width;
}

function cornerLimits(
  anchor: StoryPanelRect,
  corner: 'nw' | 'ne' | 'sw' | 'se',
  pageRows: number,
  columns: number = LAYOUT_GRID_COLUMNS,
): { maxWidth: number; maxHeight: number } {
  const rows = Math.max(1, pageRows);
  const right = anchor.x + anchor.w;
  const bottom = anchor.y + anchor.h;
  if (corner === 'se') {
    return { maxWidth: columns - anchor.x, maxHeight: rows - anchor.y };
  }
  if (corner === 'nw') {
    return { maxWidth: right, maxHeight: bottom };
  }
  if (corner === 'ne') {
    return { maxWidth: columns - anchor.x, maxHeight: bottom };
  }
  return { maxWidth: right, maxHeight: rows - anchor.y };
}

export function snapWidthOnlyAspectRect(
  anchor: StoryPanelRect,
  corner: 'nw' | 'ne' | 'sw' | 'se',
  width: number,
  pageRows: number,
  targetAspect: number,
  snapScale: number,
): StoryPanelRect {
  const w = roundGrid(width, snapScale);
  const h = heightForWidth(w, pageRows, targetAspect);
  const right = anchor.x + anchor.w;
  const bottom = anchor.y + anchor.h;
  if (corner === 'se') {
    return { x: anchor.x, y: anchor.y, w, h };
  }
  if (corner === 'nw') {
    return { x: right - w, y: bottom - h, w, h };
  }
  if (corner === 'ne') {
    return { x: anchor.x, y: bottom - h, w, h };
  }
  return { x: right - w, y: anchor.y, w, h };
}

export function snapNearestAspectRect(
  rect: StoryPanelRect,
  anchor: StoryPanelRect,
  corner: 'nw' | 'ne' | 'sw' | 'se',
  pageRows: number,
  targetAspect: number,
  snapScale: number,
  limits?: { minWidth: number; minHeight: number },
  columns: number = LAYOUT_GRID_COLUMNS,
): StoryPanelRect {
  const { maxWidth, maxHeight } = cornerLimits(anchor, corner, pageRows, columns);
  const minWidth = limits?.minWidth ?? 0.25;
  const minHeight = limits?.minHeight ?? 0.25;
  const step = 1 / snapScale;
  let best = snapWidthOnlyAspectRect(anchor, corner, rect.w, pageRows, targetAspect, snapScale);
  let bestScore = Infinity;
  for (let offset = -2; offset <= 2; offset += 1) {
    const candidateWidth = roundGrid(rect.w + offset * step, snapScale);
    const { w: fittedWidth } = fitAspectDimensions(
      candidateWidth,
      pageRows,
      targetAspect,
      { minWidth, minHeight, maxWidth, maxHeight },
    );
    const candidate = snapWidthOnlyAspectRect(
      anchor,
      corner,
      fittedWidth,
      pageRows,
      targetAspect,
      snapScale,
    );
    const aspectErr = aspectRatioError(candidate, pageRows, targetAspect);
    const distance = Math.abs(candidate.w - rect.w) + Math.abs(candidate.h - rect.h);
    const score = aspectErr * 1000 + distance;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export type AspectResizeBounds = {
  minWidth: number;
  minHeight: number;
  snapScale: number;
};

export type LockedAspectPointerInput = {
  anchor: StoryPanelRect;
  corner: 'nw' | 'ne' | 'sw' | 'se';
  pointer: { clientX: number; clientY: number };
  pageBounds: { left: number; top: number };
  columnWidthPx: number;
  rowHeightPx: number;
  pageRows: number;
  targetAspect: number;
  bounds: AspectResizeBounds;
  columns?: number;
};

export function lockedAspectRectFromPointer(input: LockedAspectPointerInput): StoryPanelRect {
  const {
    anchor,
    corner,
    pointer,
    pageBounds,
    columnWidthPx,
    rowHeightPx,
    pageRows,
    targetAspect,
    bounds,
    columns = LAYOUT_GRID_COLUMNS,
  } = input;
  const proposedWidth = proposedWidthFromDraggedCorner(
    anchor,
    corner,
    pointer,
    pageBounds,
    columnWidthPx,
    rowHeightPx,
    pageRows,
    targetAspect,
  );
  const { maxWidth, maxHeight } = cornerLimits(anchor, corner, pageRows, columns);
  const { w } = fitAspectDimensions(
    proposedWidth,
    pageRows,
    targetAspect,
    {
      minWidth: bounds.minWidth,
      minHeight: bounds.minHeight,
      maxWidth,
      maxHeight,
    },
  );
  return snapWidthOnlyAspectRect(anchor, corner, w, pageRows, targetAspect, bounds.snapScale);
}

export function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Failed to load image dimensions'));
    image.src = url;
  });
}
