import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { isEditableShortcutTarget } from '../shared/dom';
import { Icon } from '../Icon';
import { useDismissOnOutsidePointerDown } from '../shared/popover';
import type { CSSProperties, ReactNode } from 'react';
import { nonArchivedVariants } from '../canvas/shared';
import type { Asset, CanvasDocument, StoryPanel, StoryPanelCaption, StoryPanelCaptionTail, StoryPanelDocument, StoryPanelImageCrop, StoryPanelRect, StoryPanelTextStyle, TagDefinition } from '../types';
import { speechTailGeometry } from './speechTail';
import { assetThumbnailUrl } from './panelImageAssets';
import {
  focalFromPanDelta,
  imageCropForPanel,
  isDefaultImageCrop,
  panelImageCropStyle,
} from './panelImageCrop';
import {
  formatAspectRatioFromPixels,
  GEMINI_IMAGE_ASPECT_RATIOS,
  LAYOUT_PAGE_ROWS,
  loadImageDimensions,
  lockedAspectRectFromPointer,
  PANEL_COMMIT_SNAP_SCALE,
  PANEL_DRAG_SNAP_SCALE,
  panelVisualAspectRatio,
  parseAspectRatio,
  snapNearestAspectRect,
  snapRectToAspectRatio,
} from './panelAspectRatio';
import {
  interiorSpreadPages,
  lastSpreadAnchorPageIndex,
  nextSpreadAnchorPageIndex,
  previousSpreadAnchorPageIndex,
  spreadAnchorPageIndexForPageId,
  spreadLeftPageIdByRightPageId,
  spreadRightPageIdByLeftPageId,
  spreadVisiblePages,
} from './spreadPageLayout';
import {
  fractionMatchesGridSpan,
  PAGE_SIZE_FRACTIONS,
  rectWithPageSizeFractions,
  type PageSizeFraction,
} from './panelPageSize';
import { PanelImagePicker } from './PanelImagePicker';
import {
  CAPTION_COLOR_PRESETS,
  captionPanelCssProperties,
  captionPanelClassName,
  captionSpeechKindFor,
  captionStyleForPanel,
  captionBackgroundForSpeech,
  defaultCaptionTextStyle,
  fitCaptionFontSize,
  fitCaptionHeightRows,
} from './captionPanelStyle';
import {
  captionLabel,
  captionPanelsFor,
  CAPTION_GRID_SNAP,
  clampCaptionRect,
  defaultCaptionRect,
  imageInfoHostFor,
  panelKindHostFor,
  parentPanelFor,
  removePanelAndCaptionChildren,
} from './panelCaptions';
import {
  readingChunkPanelForLayoutAction,
  removeStoryPanelFromLayout,
} from './panelPlacement';
import { captionAsPanel, isBookLinked, isCaption, isPanel, isUnplaced, layoutPanels, topLevelPanels } from './panelModel';
import { inferDocumentChangeLabel, type StoryPanelHistoryEntry } from './storyPanelHistory';
import { readLastLayoutPageId, writeLastLayoutPageId } from './lastLayoutPage';
import { readFilmstripCollapsed, writeFilmstripCollapsed } from './layoutUiPrefs';
import { panelEntriesForPage, panelLayoutColumns, panelPositionStyle } from './pagePanelLayout';
import { PageFilmstrip } from './PageFilmstrip';
import { sortedStoryPages, storyPageNumberById as mapStoryPageNumbers } from './pageNumbers';
import { HoverTooltip } from '../ui';
import {
  PRINT_HALF_WIDTH,
  PRINT_INNER_GUTTER,
  PRINT_OUTER_MARGIN,
  PRINT_PAGE_HEIGHT,
  PRINT_PAGE_WIDTH,
  PRINT_SHEET_ASPECT_RATIO,
  PRINT_SHEET_GRID_COLUMNS,
  PRINT_SHEET_GRID_ROWS,
  PRINT_SHEET_HEIGHT,
} from './printLayout';

import type { SinglePagePreviewMode } from './singlePagePreview';
import { loadAssetImageUrl } from '../shared/assetUrls';

export type StoryPanelLayoutMode = 'spread' | 'single' | 'all-pages';

const gridColumns = 12;
const minPanelWidth = 2;
/** One row ≈ one column in printable page pixels (portrait page). */
const minPanelHeight = 1;
const minTextPanelHeight = 0.5;
const minTextPanelWidth = 0.75;
const panelSnapScale = 4;
const comicPageAspectRatio = '5.5 / 8.5';
const defaultTextStyle: StoryPanelTextStyle = { fontFamily: 'serif', fontSize: 8, align: 'left' };
const textFontFamilies: Record<StoryPanelTextStyle['fontFamily'], string> = {
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  comic: '"Comic Sans MS", "Comic Sans", cursive',
};

function TrashIcon() {
  return (
    <svg className="story-panels-trash-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 4.5h10" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M6 4.5V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M5 4.5l.5 8a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9l.5-8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M7 7v4M9 7v4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function StyleIcon() {
  return (
    <svg className="story-panels-style-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M8 1.75l1.35 2.74 3.02.44-2.19 2.13.52 3.01L8 8.98 5.3 10.07l.52-3.01-2.19-2.13 3.02-.44L8 1.75z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M3.5 13.25h9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
type StoryPanelCssProperties = CSSProperties & Record<`--${string}`, string | number>;

type DragMode = 'move' | 'resize';
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type DragState = {
  panelId: string;
  pageId: string;
  mode: DragMode;
  corner?: ResizeCorner;
  startClientX: number;
  startClientY: number;
  startRect: StoryPanelRect;
  startSpansSpread: boolean;
  activated: boolean;
};

/** Pointer movement before a move/resize updates the panel layout. */
const PANEL_DRAG_ACTIVATION_PX = 6;

type PageContextMenu =
  | {
    kind: 'page';
    x: number;
    y: number;
    pageId: string;
    rect: StoryPanelRect;
  }
  | {
    kind: 'panel';
    x: number;
    y: number;
    panelId: string;
  };

type PlacementPickerTarget = {
  pageId: string;
  rect: StoryPanelRect;
};

type CropDragState = {
  panelId: string;
  startClientX: number;
  startClientY: number;
  startCrop: StoryPanelImageCrop;
  panelWidth: number;
  panelHeight: number;
};

function plainTextToRichText(value: string) {
  const doc = document.implementation.createHTMLDocument('');
  const container = doc.createElement('div');
  value.split(/\n/).forEach((line, index) => {
    if (index > 0) container.appendChild(doc.createElement('br'));
    container.appendChild(doc.createTextNode(line));
  });
  return container.innerHTML;
}

function sanitizeRichText(value: string) {
  const doc = document.implementation.createHTMLDocument('');
  const template = doc.createElement('template');
  template.innerHTML = value;
  const output = doc.createElement('div');
  const appendClean = (node: Node, parent: HTMLElement) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(doc.createTextNode(node.textContent ?? ''));
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tagName = node.tagName.toLowerCase();
    if (tagName === 'br') {
      parent.appendChild(doc.createElement('br'));
      return;
    }
    const mappedTag = tagName === 'b' || tagName === 'strong'
      ? 'strong'
      : tagName === 'i' || tagName === 'em'
        ? 'em'
        : tagName === 'u'
          ? 'u'
          : tagName === 'div' || tagName === 'p'
            ? 'div'
            : '';
    const nextParent = mappedTag ? doc.createElement(mappedTag) : parent;
    Array.from(node.childNodes).forEach((child) => appendClean(child, nextParent));
    if (mappedTag) parent.appendChild(nextParent);
  };
  Array.from(template.content.childNodes).forEach((node) => appendClean(node, output));
  return output.innerHTML.trim();
}

function richTextToPlainText(value: string) {
  const doc = document.implementation.createHTMLDocument('');
  const element = doc.createElement('div');
  element.innerHTML = sanitizeRichText(value);
  return element.textContent ?? '';
}

function richTextForPanel(panel: StoryPanel, draft: string | null = null) {
  if (draft !== null) return draft;
  if (panel.richText) return panel.richText;
  return plainTextToRichText(panel.visibleText || panel.selectedText);
}

function textStyleForPanel(panel: StoryPanel): StoryPanelTextStyle {
  return { ...defaultTextStyle, ...(panel.textStyle ?? {}) };
}

function textPanelCssProperties(
  panel: StoryPanel,
  styleOverride?: Partial<StoryPanelTextStyle>,
  mode: 'canvas' | 'editor' = 'canvas',
): StoryPanelCssProperties {
  const textStyle = { ...textStyleForPanel(panel), ...styleOverride };
  const base = {
    fontFamily: textFontFamilies[textStyle.fontFamily],
    textAlign: textStyle.align,
  };
  if (mode === 'editor') {
    return { ...base, fontSize: textStyle.fontSize };
  }
  return {
    ...base,
    '--story-text-panel-font-size': `${(textStyle.fontSize / 360) * 100}cqw`,
  };
}

function textStyleOverrideFromFontSizeInput(
  panel: StoryPanel,
  selectedPanelId: string | null,
  fontSizeInput: string | null,
): Partial<StoryPanelTextStyle> | undefined {
  if (panel.id !== selectedPanelId || fontSizeInput === null) return undefined;
  const parsed = Number(fontSizeInput);
  if (!Number.isFinite(parsed)) return undefined;
  return { fontSize: Math.min(48, Math.max(6, Math.trunc(parsed))) };
}

function panelCanvasTextStyle(
  panel: StoryPanel,
  selectedPanelId: string | null,
  fontSizeInput: string | null,
): StoryPanelCssProperties {
  const override = textStyleOverrideFromFontSizeInput(panel, selectedPanelId, fontSizeInput);
  const base = textPanelCssProperties(panel, override);
  if (!isCaption(panel)) return base;
  return { ...base, ...captionPanelCssProperties(panel) };
}

function storyOffset(panel: StoryPanel) {
  return panel.startOffset ?? Number.MAX_SAFE_INTEGER;
}

function sortedPages(document: StoryPanelDocument) {
  return [...document.pages].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}


function findPanelOrCaption(document: StoryPanelDocument, panelId: string | null) {
  if (!panelId) return null;
  const panel = document.panels.find((candidate) => candidate.id === panelId);
  if (panel) return panel;
  for (const parent of document.panels) {
    const caption = (parent.captions ?? []).find((candidate) => candidate.id === panelId);
    if (caption) return captionAsPanel(parent, caption);
  }
  return null;
}

function captionPatchFromPanelPatch(patch: Partial<StoryPanel>): Partial<StoryPanelCaption> {
  const captionPatch: Partial<StoryPanelCaption> = {};
  if (patch.visibleText !== undefined) captionPatch.visibleText = patch.visibleText;
  if (patch.richText !== undefined) captionPatch.richText = patch.richText;
  if (patch.textStyle !== undefined) captionPatch.textStyle = patch.textStyle;
  if (patch.rect !== undefined) captionPatch.rect = patch.rect;
  if (patch.tail !== undefined) captionPatch.tail = patch.tail;
  if (patch.layer !== undefined) captionPatch.layer = patch.layer;
  return captionPatch;
}

/** Default tail: tip a little above the bubble, pointing into the parent image. */
function defaultCaptionTail(rect: StoryPanelRect): StoryPanelCaptionTail {
  return { x: rect.x + rect.w / 2, y: Math.max(0, rect.y - 1.2) };
}

function updatePanelOrCaptionById(document: StoryPanelDocument, panelId: string, patch: Partial<StoryPanel>) {
  let didUpdate = false;
  const captionPatch = captionPatchFromPanelPatch(patch);
  const panels = document.panels.map((panel) => {
    if (panel.id === panelId) {
      didUpdate = true;
      return { ...panel, ...patch };
    }
    if (!(panel.captions ?? []).some((caption) => caption.id === panelId)) return panel;
    didUpdate = true;
    return {
      ...panel,
      captions: (panel.captions ?? []).map((caption) => (
        caption.id === panelId ? { ...caption, ...captionPatch } : caption
      )),
    };
  });
  return didUpdate ? { ...document, panels } : document;
}

function pageKindLabel(pageKind: StoryPanelDocument['pages'][number]['pageKind']) {
  if (pageKind === 'cover') return 'Front cover';
  if (pageKind === 'inside-cover') return 'Inside front cover';
  if (pageKind === 'inside-back-cover') return 'Inside back cover';
  if (pageKind === 'back-cover') return 'Back cover';
  return 'Story page';
}

function isStoryPage(page: StoryPanelDocument['pages'][number] | null | undefined) {
  return page?.pageKind === 'story';
}

function fixedPageShortLabel(page: StoryPanelDocument['pages'][number] | null | undefined) {
  if (!page) return '';
  if (page.pageKind === 'cover') return 'F';
  if (page.pageKind === 'inside-cover') return 'IFC';
  if (page.pageKind === 'inside-back-cover') return 'IBC';
  if (page.pageKind === 'back-cover') return 'B';
  return '';
}

function roundStep(value: number, scale: number) {
  return Math.round(value * scale) / scale;
}

/** Magnetic distance (in grid columns/rows) for edge-alignment snapping during moves. */
const EDGE_SNAP_DISTANCE = 0.3;

type SnapGuides = { pageIds: string[]; cols: number[]; rows: number[] };

/** Snap a moving rect's edges to nearby targets; returns the snapped rect and
 * the guide lines (in the rect's own column space) that matched. */
function snapRectToEdgeTargets(
  rect: StoryPanelRect,
  targetsX: number[],
  targetsY: number[],
): { rect: StoryPanelRect; cols: number[]; rows: number[] } {
  const best = (edges: number[], targets: number[]) => {
    let delta: number | null = null;
    let guide = 0;
    for (const target of targets) {
      for (const edge of edges) {
        const candidate = target - edge;
        if (Math.abs(candidate) < EDGE_SNAP_DISTANCE && (delta === null || Math.abs(candidate) < Math.abs(delta))) {
          delta = candidate;
          guide = target;
        }
      }
    }
    return { delta, guide };
  };
  const snapX = best([rect.x, rect.x + rect.w], targetsX);
  const snapY = best([rect.y, rect.y + rect.h], targetsY);
  return {
    rect: {
      ...rect,
      x: snapX.delta === null ? rect.x : rect.x + snapX.delta,
      y: snapY.delta === null ? rect.y : rect.y + snapY.delta,
    },
    cols: snapX.delta === null ? [] : [snapX.guide],
    rows: snapY.delta === null ? [] : [snapY.guide],
  };
}

function clampRect(rect: StoryPanelRect, panelKind: StoryPanel['panelKind'] = 'image', columns: number = gridColumns): StoryPanelRect {
  const minWidth = panelKind === 'text' ? minTextPanelWidth : minPanelWidth;
  const minHeight = panelKind === 'text' ? minTextPanelHeight : minPanelHeight;
  const w = Math.min(columns, Math.max(minWidth, roundStep(rect.w, panelSnapScale)));
  let h = Math.max(minHeight, roundStep(rect.h, panelSnapScale));
  h = Math.min(h, LAYOUT_PAGE_ROWS);
  const x = Math.min(columns - w, Math.max(0, roundStep(rect.x, panelSnapScale)));
  let y = Math.max(0, roundStep(rect.y, panelSnapScale));
  y = Math.min(y, LAYOUT_PAGE_ROWS - h);
  return { x, y, w, h };
}

function clampPanelRect(rect: StoryPanelRect, panel: Pick<StoryPanel, 'panelKind' | 'sourceKind' | 'parentPanelId' | 'spansSpread'>): StoryPanelRect {
  if (isCaption(panel as StoryPanel)) return clampCaptionRect(rect, panelLayoutColumns(panel));
  return clampRect(rect, panel.panelKind, panelLayoutColumns(panel));
}

function resizeRectFromCorner(rect: StoryPanelRect, corner: ResizeCorner, deltaColumns: number, deltaRows: number, panel: Pick<StoryPanel, 'panelKind' | 'sourceKind' | 'parentPanelId' | 'spansSpread'>): StoryPanelRect {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const caption = isCaption(panel as StoryPanel);
  const minWidth = caption ? 0.5 : panel.panelKind === 'text' ? minTextPanelWidth : minPanelWidth;
  const minHeight = caption ? 0.25 : panel.panelKind === 'text' ? minTextPanelHeight : minPanelHeight;
  let x = rect.x;
  let y = rect.y;
  let w = rect.w;
  let h = rect.h;
  if (corner.includes('w')) {
    x = Math.min(right - minWidth, Math.max(0, rect.x + deltaColumns));
    w = right - x;
  } else {
    w = rect.w + deltaColumns;
  }
  if (corner.includes('n')) {
    y = Math.min(bottom - minHeight, Math.max(0, rect.y + deltaRows));
    h = bottom - y;
  } else {
    h = rect.h + deltaRows;
  }
  return clampPanelRect({ x, y, w, h }, panel);
}

function nextPanelId(document: StoryPanelDocument) {
  const ids = new Set(document.panels.flatMap((panel) => [panel.id, ...(panel.captions ?? []).map((caption) => caption.id)]));
  let index = ids.size + 1;
  while (ids.has(`panel-${String(index).padStart(3, '0')}`)) index += 1;
  return `panel-${String(index).padStart(3, '0')}`;
}

function normalizePageOrder(pages: StoryPanelDocument['pages']) {
  return pages
    .map((page, index) => ({ ...page, order: index }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function PageLayoutEditor({
  document,
  selectedPanelId,
  layoutMode,
  singlePagePreviewMode,
  onTogglePrintPreview,
  onSelectPanel,
  onSaveDocument,
  isSaving,
  sidePanel,
  onLayoutModeChange,
  inspectorVisible,
  onInspectorVisibleChange,
  panelsTrayVisible,
  onPanelsTrayVisibleChange,
  unplacedPanels = [],
  onCreatePanelAt,
  onPlacePanelAt,
  assets,
  projectTags,
  canvas,
  projectSlug,
  navigateToPanelId,
  onNavigateToPanelComplete,
}: {
  document: StoryPanelDocument;
  selectedPanelId: string | null;
  layoutMode: StoryPanelLayoutMode;
  singlePagePreviewMode: SinglePagePreviewMode;
  onTogglePrintPreview: () => void;
  onSelectPanel: (panelId: string | null) => void;
  onSaveDocument: (document: StoryPanelDocument) => void;
  isSaving: boolean;
  sidePanel?: ReactNode;
  onLayoutModeChange: (layoutMode: StoryPanelLayoutMode) => void;
  inspectorVisible: boolean;
  onInspectorVisibleChange: (visible: boolean) => void;
  panelsTrayVisible: boolean;
  onPanelsTrayVisibleChange: (visible: boolean) => void;
  unplacedPanels?: StoryPanel[];
  onCreatePanelAt?: (payload: { pageId: string; rect: StoryPanelRect; panelKind: StoryPanel['panelKind'] }) => Promise<string | null>;
  onPlacePanelAt?: (payload: { panelId: string; pageId: string; rect: StoryPanelRect }) => Promise<void>;
  assets: Asset[];
  projectTags: TagDefinition[];
  canvas: CanvasDocument;
  projectSlug: string;
  navigateToPanelId?: string | null;
  onNavigateToPanelComplete?: () => void;
}) {
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousPageIndexRef = useRef(0);
  const previousLayoutModeRef = useRef<StoryPanelLayoutMode>(layoutMode);
  const richTextEditorRef = useRef<HTMLDivElement | null>(null);
  const visibleTextDraftRef = useRef<string | null>(null);
  const displayDocumentRef = useRef<StoryPanelDocument>(document);
  const draftDocumentRef = useRef<StoryPanelDocument | null>(null);
  const richTextEditingPanelIdRef = useRef<string | null>(null);
  const infoPanelBodyRef = useRef<HTMLDivElement | null>(null);
  const zoomDragPanelIdRef = useRef<string | null>(null);
  const persistPanelTextDraftRef = useRef<(panelId: string, draftHtml: string | null | undefined) => void>(() => {});
  const [draftDocument, setDraftDocument] = useState<StoryPanelDocument | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [cropDragState, setCropDragState] = useState<CropDragState | null>(null);
  const [cropModePanelId, setCropModePanelId] = useState<string | null>(null);
  const [pageMenu, setPageMenu] = useState<PageContextMenu | null>(null);
  const [pageMenuSubmenu, setPageMenuSubmenu] = useState<'create' | 'place' | null>(null);
  const [placementPickerTarget, setPlacementPickerTarget] = useState<PlacementPickerTarget | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(() => {
    const lastPageId = readLastLayoutPageId(projectSlug);
    if (!lastPageId) return 0;
    const initialPages = sortedPages(document);
    if (layoutMode === 'spread') {
      return spreadAnchorPageIndexForPageId(lastPageId, initialPages, interiorSpreadPages(initialPages));
    }
    const index = initialPages.findIndex((page) => page.id === lastPageId);
    return index >= 0 ? index : 0;
  });
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pendingPageDeleteId, setPendingPageDeleteId] = useState<string | null>(null);
  const [pendingPanelDeleteId, setPendingPanelDeleteId] = useState<string | null>(null);
  const [pendingCaptionDeleteId, setPendingCaptionDeleteId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<StoryPanelHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<StoryPanelHistoryEntry[]>([]);
  const [visibleTextDraft, setVisibleTextDraft] = useState<string | null>(null);
  const [fontSizeInput, setFontSizeInput] = useState<string | null>(null);
  const [flashingPanelId, setFlashingPanelId] = useState<string | null>(null);
  const [pickerPanelId, setPickerPanelId] = useState<string | null>(null);
  const [captionStylePopoverId, setCaptionStylePopoverId] = useState<string | null>(null);
  const [captionFontSizeDraft, setCaptionFontSizeDraft] = useState<{ captionId: string; value: string } | null>(null);
  const [isSnappingAspect, setIsSnappingAspect] = useState(false);
  const [captionTextDrafts, setCaptionTextDrafts] = useState<Record<string, string>>({});
  const [addPanelMenuOpen, setAddPanelMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [snapGuides, setSnapGuides] = useState<SnapGuides | null>(null);
  const [filmstripCollapsed, setFilmstripCollapsedState] = useState(readFilmstripCollapsed);
  const setFilmstripCollapsed = (collapsed: boolean) => {
    writeFilmstripCollapsed(collapsed);
    setFilmstripCollapsedState(collapsed);
  };
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const displayDocument = draftDocument ?? document;
  displayDocumentRef.current = displayDocument;
  draftDocumentRef.current = draftDocument;
  visibleTextDraftRef.current = visibleTextDraft;
  const pages = sortedPages(displayDocument);
  const clampedPageIndex = Math.min(Math.max(currentPageIndex, 0), Math.max(0, pages.length - 1));
  const coverPage = pages.find((page) => page.pageKind === 'cover') ?? null;
  const backCoverPage = pages.find((page) => page.pageKind === 'back-cover') ?? null;
  const spreadPages = interiorSpreadPages(pages);
  const spreadRightIdByLeftId = spreadRightPageIdByLeftPageId(pages);
  const spreadLeftIdByRightId = spreadLeftPageIdByRightPageId(pages);
  const lastSpreadStartIndex = lastSpreadAnchorPageIndex(pages, spreadPages);
  const isSinglePageMode = layoutMode !== 'spread';
  const hasSinglePageSidePanel = layoutMode === 'single';
  const usesLayoutPreview = layoutMode === 'single' || layoutMode === 'spread';
  const showsSelectedPanelInfo = inspectorVisible && (layoutMode === 'single' || layoutMode === 'spread');
  const singlePagePreviewAspect = singlePagePreviewMode === 'print'
    ? `${PRINT_HALF_WIDTH} / ${PRINT_SHEET_HEIGHT}`
    : `${PRINT_PAGE_WIDTH} / ${PRINT_PAGE_HEIGHT}`;
  const singlePagePreviewWidthRatio = singlePagePreviewMode === 'print'
    ? PRINT_HALF_WIDTH / PRINT_SHEET_HEIGHT
    : PRINT_PAGE_WIDTH / PRINT_PAGE_HEIGHT;
  const pageLayoutStyle: StoryPanelCssProperties | undefined = hasSinglePageSidePanel
    ? {
      '--story-single-page-preview-aspect': singlePagePreviewAspect,
      '--story-single-page-width-ratio': singlePagePreviewWidthRatio,
    }
    : undefined;
  const visiblePages = pages.length === 0 ? [] : layoutMode === 'all-pages'
    ? pages
    : isSinglePageMode
    ? pages.slice(clampedPageIndex, clampedPageIndex + 1)
    : spreadVisiblePages(clampedPageIndex, pages, coverPage, backCoverPage);
  const selectedPanel = findPanelOrCaption(displayDocument, selectedPanelId);
  const placeablePanels = topLevelPanels(unplacedPanels);
  const selectedChunkPanel = panelsTrayVisible
    && selectedPanel
    && isPanel(selectedPanel)
    && selectedPanel.parentPanelId == null
    && isUnplaced(selectedPanel)
    ? selectedPanel
    : null;
  const quickPlacePanels = selectedChunkPanel ? [selectedChunkPanel] : unplacedPanels.slice(0, 3);
  const visiblePageIds = new Set(
    visiblePages.flatMap((page) => (page ? [page.id] : [])),
  );
  const panelIsVisible = (panel: StoryPanel) => {
    if (!panel.pageId) return false;
    if (visiblePageIds.has(panel.pageId)) return true;
    const rightPageId = panel.spansSpread ? spreadRightIdByLeftId.get(panel.pageId) : undefined;
    return rightPageId !== undefined && visiblePageIds.has(rightPageId);
  };
  const visibleSelectedPanel = selectedPanel && panelIsVisible(selectedPanel) ? selectedPanel : null;
  const panelKindHost = panelKindHostFor(displayDocument, visibleSelectedPanel);
  const imageInfoHost = imageInfoHostFor(displayDocument, visibleSelectedPanel);
  const captionHostPanel = imageInfoHost;
  const childCaptions = captionHostPanel ? captionPanelsFor(displayDocument, captionHostPanel.id) : [];
  const infoStoryPanel = imageInfoHost ?? visibleSelectedPanel ?? null;
  const selectedPage = selectedPageId ? pages.find((page) => page.id === selectedPageId) ?? null : null;
  const selectedPageCanChangeOrder = isStoryPage(selectedPage);
  const storyPages = sortedStoryPages(pages);
  const storyPageNumberById = mapStoryPageNumbers(pages);
  const currentStoryPageNumbers = visiblePages
    .filter((page): page is StoryPanelDocument['pages'][number] => page !== null && page.pageKind === 'story')
    .map((page) => storyPageNumberById.get(page.id))
    .filter((pageNumber): pageNumber is number => typeof pageNumber === 'number');
  const currentPageLabel = layoutMode === 'spread' && clampedPageIndex === 0 && coverPage && backCoverPage
    ? 'F/B'
    : currentStoryPageNumbers.length > 1
      ? `${currentStoryPageNumbers[0]}-${currentStoryPageNumbers[currentStoryPageNumbers.length - 1]}`
      : currentStoryPageNumbers[0]?.toString() ?? fixedPageShortLabel(visiblePages.find(Boolean));
  const selectedStoryPageIndex = selectedPageId ? storyPages.findIndex((page) => page.id === selectedPageId) : -1;
  const pendingPageDelete = pendingPageDeleteId ? pages.find((page) => page.id === pendingPageDeleteId) ?? null : null;
  const pendingPageDeletePanelCount = pendingPageDeleteId
    ? displayDocument.panels.filter((panel) => panel.pageId === pendingPageDeleteId).length
    : 0;
  const pendingPanelDelete = pendingPanelDeleteId
    ? findPanelOrCaption(displayDocument, pendingPanelDeleteId)
    : null;
  const pendingCaptionDelete = pendingCaptionDeleteId
    ? findPanelOrCaption(displayDocument, pendingCaptionDeleteId)
    : null;
  const storyPanelNumberById = new Map(
    topLevelPanels(displayDocument.panels)
      .sort((a, b) => storyOffset(a) - storyOffset(b) || a.order - b.order)
      .map((panel, index) => [panel.id, index + 1]),
  );
  const persistPanelTextDraft = (panelId: string, draftHtml: string | null | undefined) => {
    if (draftHtml == null) return;
    const doc = displayDocumentRef.current;
    const panel = doc.panels.find((candidate) => candidate.id === panelId);
    if (!panel || panel.panelKind !== 'text') return;
    const nextRichText = sanitizeRichText(draftHtml);
    const currentRichText = panel.richText || plainTextToRichText(panel.visibleText || panel.selectedText);
    if (nextRichText === currentRichText) return;
    const nextDocument = {
      ...doc,
      panels: doc.panels.map((candidate) => (
        candidate.id === panelId
          ? { ...candidate, richText: nextRichText, visibleText: richTextToPlainText(nextRichText) }
          : candidate
      )),
    };
    setDraftDocument(nextDocument);
    setUndoStack((current) => [...current, { document: doc, label: 'Edit text' }]);
    setRedoStack([]);
    onSaveDocument(nextDocument);
  };
  persistPanelTextDraftRef.current = persistPanelTextDraft;
  const pageMenuRef = useRef<HTMLDivElement | null>(null);
  const closePageMenu = useCallback(() => {
    setPageMenu(null);
    setPageMenuSubmenu(null);
  }, []);
  useDismissOnOutsidePointerDown(Boolean(pageMenu), [pageMenuRef], closePageMenu);
  useEffect(() => {
    setCaptionStylePopoverId(null);
    setCaptionFontSizeDraft(null);
  }, [selectedPanelId]);
  useEffect(() => {
    if (cropModePanelId && selectedPanelId !== cropModePanelId) {
      setCropModePanelId(null);
    }
  }, [selectedPanelId, cropModePanelId]);
  useLayoutEffect(() => {
    if (layoutMode !== 'single' && layoutMode !== 'spread') return;
    if (!visibleSelectedPanel || !isCaption(visibleSelectedPanel)) return;
    infoPanelBodyRef.current?.scrollTo({ top: 0 });
  }, [layoutMode, visibleSelectedPanel?.id, visibleSelectedPanel?.parentPanelId]);
  const addPanelMenuRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsidePointerDown(addPanelMenuOpen, [addPanelMenuRef], useCallback(() => setAddPanelMenuOpen(false), []));
  const captionStyleWrapRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsidePointerDown(Boolean(captionStylePopoverId), [captionStyleWrapRef], useCallback(() => setCaptionStylePopoverId(null), []));
  useEffect(() => {
    if (!captionStylePopoverId) setCaptionFontSizeDraft(null);
  }, [captionStylePopoverId]);
  useLayoutEffect(() => {
    const previousPanelId = richTextEditingPanelIdRef.current;
    const activePanelId = showsSelectedPanelInfo && visibleSelectedPanel?.panelKind === 'text' && !isCaption(visibleSelectedPanel)
      ? visibleSelectedPanel.id
      : null;

    if (previousPanelId && previousPanelId !== activePanelId) {
      persistPanelTextDraft(
        previousPanelId,
        visibleTextDraftRef.current ?? richTextEditorRef.current?.innerHTML,
      );
    }

    if (!showsSelectedPanelInfo || !visibleSelectedPanel || visibleSelectedPanel.panelKind !== 'text' || isCaption(visibleSelectedPanel)) {
      if (!visibleSelectedPanel || visibleSelectedPanel.panelKind !== 'text' || isCaption(visibleSelectedPanel)) {
    setVisibleTextDraft(null);
      }
      richTextEditingPanelIdRef.current = activePanelId;
      return;
    }
    const nextDraft = richTextForPanel(visibleSelectedPanel);
    setVisibleTextDraft(nextDraft);
    richTextEditingPanelIdRef.current = activePanelId;
    const editor = richTextEditorRef.current;
    if (!editor || window.document.activeElement === editor) return;
    const nextHtml = sanitizeRichText(nextDraft);
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
  }, [
    layoutMode,
    visibleSelectedPanel?.id,
    visibleSelectedPanel?.panelKind,
    visibleSelectedPanel?.richText,
    visibleSelectedPanel?.visibleText,
  ]);
  useEffect(() => {
    if (!showsSelectedPanelInfo || !visibleSelectedPanel || visibleSelectedPanel.panelKind !== 'text') return;
    if (visibleTextDraft === null) return;
    const panelId = visibleSelectedPanel.id;
    const timer = window.setTimeout(() => {
      persistPanelTextDraftRef.current(
        panelId,
        visibleTextDraftRef.current ?? richTextEditorRef.current?.innerHTML,
      );
    }, 600);
    return () => window.clearTimeout(timer);
  }, [visibleTextDraft, showsSelectedPanelInfo, visibleSelectedPanel?.id, visibleSelectedPanel?.panelKind]);
  useEffect(() => {
    return () => {
      const panelId = richTextEditingPanelIdRef.current;
      if (!panelId) return;
      persistPanelTextDraftRef.current(
        panelId,
        visibleTextDraftRef.current ?? richTextEditorRef.current?.innerHTML,
      );
    };
  }, []);
  useEffect(() => {
    setFontSizeInput(null);
  }, [selectedPanel?.id]);
  useEffect(() => {
    if (dragState || isSaving) return;
    setDraftDocument(null);
  }, [document, dragState, isSaving]);
  useEffect(() => {
    if (selectedPageId && pages.some((page) => page.id === selectedPageId)) return;
    setSelectedPageId(pages[clampedPageIndex]?.id ?? pages[0]?.id ?? null);
  }, [clampedPageIndex, pages, selectedPageId]);
  const currentPageIdForRecall = pages[clampedPageIndex]?.id ?? null;
  useEffect(() => {
    if (currentPageIdForRecall) writeLastLayoutPageId(projectSlug, currentPageIdForRecall);
  }, [projectSlug, currentPageIdForRecall]);
  useEffect(() => {
    if (layoutMode !== 'single' || !selectedPanel || !selectedPanel.pageId) {
      previousPageIndexRef.current = clampedPageIndex;
      return;
    }
    if (previousPageIndexRef.current === clampedPageIndex) return;
    previousPageIndexRef.current = clampedPageIndex;
    const currentPage = pages[clampedPageIndex];
    if (!currentPage || currentPage.id !== selectedPanel.pageId) {
      onSelectPanel(null);
    }
  }, [clampedPageIndex, layoutMode, onSelectPanel, pages, selectedPanel?.id, selectedPanel?.pageId]);
  useEffect(() => {
    if (!selectedPanel || layoutMode === 'all-pages') return;
    const pageIndex = pages.findIndex((page) => page.id === selectedPanel.pageId);
    if (pageIndex >= 0 && selectedPanel.pageId) {
      setCurrentPageIndex(
        layoutMode === 'spread'
          ? spreadAnchorPageIndexForPageId(selectedPanel.pageId, pages, spreadPages)
          : pageIndex,
      );
    }
    setFlashingPanelId(null);
    const start = window.setTimeout(() => setFlashingPanelId(selectedPanel.id), 0);
    const stop = window.setTimeout(() => setFlashingPanelId((current) => (current === selectedPanel.id ? null : current)), 1400);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
    };
  }, [layoutMode, selectedPanel?.id, selectedPanel?.pageId]);
  useEffect(() => {
    if (!navigateToPanelId) return;
    const panel = findPanelOrCaption(displayDocument, navigateToPanelId);
    if (!panel) {
      onNavigateToPanelComplete?.();
      return;
    }
    const pageIndex = pages.findIndex((page) => page.id === panel.pageId);
    if (pageIndex >= 0 && panel.pageId) {
      setCurrentPageIndex(
        layoutMode === 'spread'
          ? spreadAnchorPageIndexForPageId(panel.pageId, pages, spreadPages)
          : pageIndex,
      );
    }
    setFlashingPanelId(null);
    const start = window.setTimeout(() => setFlashingPanelId(panel.id), 0);
    const stop = window.setTimeout(() => setFlashingPanelId((current) => (current === panel.id ? null : current)), 1400);
    onNavigateToPanelComplete?.();
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
    };
  }, [displayDocument.panels, layoutMode, navigateToPanelId, onNavigateToPanelComplete, pages]);
  useEffect(() => {
    if (layoutMode !== 'spread') {
      previousLayoutModeRef.current = layoutMode;
      return;
    }
    if (previousLayoutModeRef.current === 'spread') return;
    previousLayoutModeRef.current = layoutMode;
    const page = pages[clampedPageIndex];
    if (!page) return;
    const anchorIndex = spreadAnchorPageIndexForPageId(page.id, pages, spreadPages);
    if (anchorIndex !== clampedPageIndex) {
      setCurrentPageIndex(anchorIndex);
    }
  }, [layoutMode, pages, clampedPageIndex, spreadPages]);
  const createPageDocument = (afterPageId?: string, count = 1) => {
    const insertionIndex = afterPageId ? pages.findIndex((page) => page.id === afterPageId) + 1 : displayDocument.pages.length;
    const ids = new Set(displayDocument.pages.map((page) => page.id));
    let nextPageIndex = displayDocument.pages.length + 1;
    const storyPageCount = pages.filter((candidate) => candidate.pageKind === 'story').length;
    const newPages = Array.from({ length: count }, (_, offset): StoryPanelDocument['pages'][number] => {
      while (ids.has(`page-${String(nextPageIndex).padStart(3, '0')}`)) nextPageIndex += 1;
      const id = `page-${String(nextPageIndex).padStart(3, '0')}`;
      ids.add(id);
      nextPageIndex += 1;
      return {
        id,
        order: insertionIndex + offset,
        title: `Page ${storyPageCount + offset + 1}`,
        pageKind: 'story',
      };
    });
    const nextPages = [...pages];
    nextPages.splice(insertionIndex < 0 ? pages.length : insertionIndex, 0, ...newPages);
    return {
      ...displayDocument,
      pages: nextPages.map((candidate, index) => ({ ...candidate, order: index })),
    };
  };
  const pushHistory = (beforeDocument: StoryPanelDocument, label: string) => {
    setUndoStack((current) => [...current, { document: beforeDocument, label }]);
    setRedoStack([]);
  };
  /** Drag commits pass the pre-drag document explicitly — displayDocument is
   * the draft (post-drag) by the time the pointer is released. */
  const commitDocument = (nextDocument: StoryPanelDocument, label?: string, beforeDocument: StoryPanelDocument = displayDocument) => {
    pushHistory(beforeDocument, label ?? inferDocumentChangeLabel(beforeDocument, nextDocument));
    onSaveDocument(nextDocument);
  };
  const undo = () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, { document, label: entry.label }]);
    onSaveDocument(entry.document);
  };
  const redo = () => {
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, { document, label: entry.label }]);
    onSaveDocument(entry.document);
  };
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      if (isEditableShortcutTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) {
        redoRef.current();
      } else {
        undoRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  const pagesToReachNextStorySignature = () => {
    const remainder = storyPages.length % 4;
    return remainder === 0 ? 4 : 4 - remainder;
  };
  const nextSpreadPageIndex = layoutMode === 'spread'
    ? nextSpreadAnchorPageIndex(clampedPageIndex, pages, spreadPages)
    : null;
  const nextSinglePageIndex = clampedPageIndex + 1;
  const lastExistingPageIndex = layoutMode === 'spread' ? lastSpreadStartIndex : pages.length - 1;
  const canGoNextExistingPage = layoutMode === 'spread'
    ? nextSpreadPageIndex !== null
    : nextSinglePageIndex <= lastExistingPageIndex;
  const goNextExistingPage = () => {
    if (layoutMode === 'spread') {
      if (nextSpreadPageIndex !== null) setCurrentPageIndex(nextSpreadPageIndex);
      return;
    }
    if (nextSinglePageIndex <= lastExistingPageIndex) setCurrentPageIndex(nextSinglePageIndex);
  };
  const goNext = goNextExistingPage;
  const addPagesToNextStorySignature = () => {
    const lastStoryPage = storyPages[storyPages.length - 1];
    const newPageIndex = pages.length;
    const nextDocument = lastStoryPage
      ? createPageDocument(lastStoryPage.id, pagesToReachNextStorySignature())
      : createPageDocument(undefined, pagesToReachNextStorySignature());
    const insertedPageIndex = sortedPages(nextDocument).findIndex((page) => !pages.some((existingPage) => existingPage.id === page.id));
    commitDocument(nextDocument, pagesToReachNextStorySignature() > 1 ? 'Add pages' : 'Add page');
    const nextPages = sortedPages(nextDocument);
    const insertedPage = insertedPageIndex >= 0 ? nextPages[insertedPageIndex] : nextPages[newPageIndex] ?? null;
    const rawIndex = insertedPage ? nextPages.findIndex((page) => page.id === insertedPage.id) : newPageIndex;
    setCurrentPageIndex(
      layoutMode === 'spread' && insertedPage
        ? spreadAnchorPageIndexForPageId(insertedPage.id, nextPages, interiorSpreadPages(nextPages))
        : rawIndex,
    );
  };
  const selectedPageIndex = selectedPageId ? pages.findIndex((page) => page.id === selectedPageId) : -1;
  const addPageAfterSelected = () => {
    const anchorId = selectedPageCanChangeOrder ? selectedPageId : null;
    if (!anchorId) return;
    const nextDocument = createPageDocument(anchorId);
    const anchorIndex = sortedPages(nextDocument).findIndex((page) => page.id === anchorId);
    const insertedPage = sortedPages(nextDocument)[Math.max(0, anchorIndex + 1)];
    commitDocument(nextDocument, 'Add page');
    setSelectedPageId(insertedPage?.id ?? null);
  };
  const requestDeleteSelectedPage = () => {
    if (!selectedPageId || !selectedPageCanChangeOrder || storyPages.length <= 1) return;
    setPendingPageDeleteId(selectedPageId);
  };
  useEffect(() => {
    if (layoutMode !== 'all-pages') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) return;
      if (event.key.toLowerCase() !== 'd') return;
      event.preventDefault();
      requestDeleteSelectedPage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layoutMode, selectedPageId, selectedPageCanChangeOrder, storyPages.length]);
  useEffect(() => {
    if (layoutMode !== 'spread' && layoutMode !== 'single') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) return;
      if (event.key.toLowerCase() !== 'd') return;
      if (!visibleSelectedPanel || isSaving || pendingPanelDeleteId) return;
      event.preventDefault();
      requestDeleteSelectedPanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSaving, layoutMode, pendingPanelDeleteId, visibleSelectedPanel?.id]);
  const confirmDeleteSelectedPage = () => {
    const pageId = pendingPageDeleteId;
    const page = pages.find((candidate) => candidate.id === pageId);
    if (!pageId || !isStoryPage(page) || storyPages.length <= 1) return;
    const pageIndex = pages.findIndex((page) => page.id === pageId);
    const nextPages = normalizePageOrder(pages.filter((page) => page.id !== pageId));
    const nextIndex = Math.min(Math.max(0, pageIndex), nextPages.length - 1);
    commitDocument({
      ...displayDocument,
      pages: nextPages,
      panels: displayDocument.panels.filter((panel) => panel.pageId !== pageId),
    }, 'Delete page');
    setPendingPageDeleteId(null);
    setSelectedPageId(nextPages[nextIndex]?.id ?? null);
    setCurrentPageIndex(nextIndex);
  };
  const moveSelectedPage = (direction: -1 | 1) => {
    if (!selectedPageId || !selectedPageCanChangeOrder || selectedStoryPageIndex < 0) return;
    const targetStoryPage = storyPages[selectedStoryPageIndex + direction];
    if (!targetStoryPage) return;
    const targetIndex = pages.findIndex((page) => page.id === targetStoryPage.id);
    if (selectedPageIndex < 0 || targetIndex < 0) return;
    const nextPages = [...pages];
    const [page] = nextPages.splice(selectedPageIndex, 1);
    nextPages.splice(targetIndex, 0, page);
    commitDocument({ ...displayDocument, pages: nextPages.map((candidate, index) => ({ ...candidate, order: index })) }, 'Reorder pages');
    setCurrentPageIndex(targetIndex);
  };
  const goPrevious = () => {
    if (isSinglePageMode) {
      setCurrentPageIndex((index) => Math.max(0, index - 1));
      return;
    }
    setCurrentPageIndex(previousSpreadAnchorPageIndex(clampedPageIndex, pages, spreadPages));
  };
  const jumpToPageId = (pageId: string) => {
    if (layoutMode === 'spread') {
      setCurrentPageIndex(spreadAnchorPageIndexForPageId(pageId, pages, spreadPages));
    } else {
      const pageIndex = pages.findIndex((page) => page.id === pageId);
      if (pageIndex >= 0) setCurrentPageIndex(pageIndex);
    }
    setSelectedPageId(pageId);
  };
  const movePageToTarget = (pageId: string, targetPageId: string) => {
    const from = pages.findIndex((page) => page.id === pageId);
    const to = pages.findIndex((page) => page.id === targetPageId);
    if (from < 0 || to < 0 || from === to) return;
    const nextPages = [...pages];
    const [page] = nextPages.splice(from, 1);
    nextPages.splice(to, 0, page);
    commitDocument({ ...displayDocument, pages: nextPages.map((candidate, index) => ({ ...candidate, order: index })) }, 'Reorder pages');
    setCurrentPageIndex(to);
  };
  const addPageAfterId = (pageId: string) => {
    const nextDocument = createPageDocument(pageId);
    const nextPages = sortedPages(nextDocument);
    const anchorIndex = nextPages.findIndex((page) => page.id === pageId);
    const insertedPage = nextPages[Math.max(0, anchorIndex + 1)] ?? null;
    commitDocument(nextDocument, 'Add page');
    if (insertedPage) {
      setSelectedPageId(insertedPage.id);
      setCurrentPageIndex(
        layoutMode === 'spread'
          ? spreadAnchorPageIndexForPageId(insertedPage.id, nextPages, interiorSpreadPages(nextPages))
          : anchorIndex + 1,
      );
    }
  };
  /** Page that receives a toolbar-created panel: the selected page when visible, else the first visible page. */
  const addPanelTargetPageId = (): string | null => {
    const candidates = visiblePages.filter((page): page is StoryPanelDocument['pages'][number] => Boolean(page));
    const selectedVisible = candidates.find((page) => page.id === selectedPageId);
    return (selectedVisible ?? candidates[0])?.id ?? null;
  };
  const addPanelToCurrentPage = (panelKind: StoryPanel['panelKind']) => {
    setAddPanelMenuOpen(false);
    const pageId = addPanelTargetPageId();
    if (!pageId || !onCreatePanelAt) return;
    const pagePanels = layoutPanels(displayDocument).filter((panel) => panel.pageId === pageId && !isCaption(panel));
    const bottom = pagePanels.reduce((max, panel) => Math.max(max, panel.rect.y + panel.rect.h), 0);
    const height = panelKind === 'text' ? 1.5 : 4;
    const y = Math.min(bottom, LAYOUT_PAGE_ROWS - height);
    void createPanelAt(pageId, { x: 0, y, w: panelKind === 'text' ? 5 : 8, h: height }, panelKind);
  };
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) return;
      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen((open) => !open);
      } else if (event.key === 'Escape') {
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  useEffect(() => {
    if (layoutMode === 'all-pages') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrevious();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNextExistingPage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layoutMode, clampedPageIndex, pages.length, isSaving]);
  const placePanelAt = async (panelId: string, pageId: string, rect: StoryPanelRect) => {
    const panel = displayDocument.panels.find((candidate) => candidate.id === panelId);
    if (!panel || !onPlacePanelAt) return;
    await onPlacePanelAt({
      panelId,
      pageId,
      rect: clampRect({ ...panel.rect, x: rect.x, y: rect.y }, panel.panelKind),
    });
    onSelectPanel(panelId);
    setPageMenu(null);
  };
  const createPanelAt = async (pageId: string, rect: StoryPanelRect, panelKind: StoryPanel['panelKind']) => {
    if (!onCreatePanelAt) return;
    const nextPanelId = await onCreatePanelAt({
      pageId,
      rect: clampRect({ ...rect, w: panelKind === 'text' ? 5 : 8, h: panelKind === 'text' ? 1.5 : 4 }, panelKind),
      panelKind,
    });
    if (nextPanelId) onSelectPanel(nextPanelId);
    setPageMenu(null);
  };
  const placePanelFromPicker = async (panelId: string) => {
    if (!placementPickerTarget) return;
    await placePanelAt(panelId, placementPickerTarget.pageId, placementPickerTarget.rect);
    setPlacementPickerTarget(null);
  };
  const updateSelectedPanel = (patch: Partial<StoryPanel>) => {
    if (!selectedPanel) return;
    const nextDocument = updatePanelOrCaptionById(displayDocument, selectedPanel.id, patch);
    setDraftDocument(nextDocument);
    commitDocument(nextDocument);
  };
  const updatePanelById = (panelId: string, patch: Partial<StoryPanel>) => {
    const nextDocument = updatePanelOrCaptionById(displayDocument, panelId, patch);
    setDraftDocument(nextDocument);
    commitDocument(nextDocument);
  };
  const updateCaptionStyle = (captionId: string, patch: Partial<StoryPanelTextStyle>) => {
    const caption = findPanelOrCaption(displayDocument, captionId);
    if (!caption) return;
    updatePanelById(captionId, { textStyle: { ...captionStyleForPanel(caption), ...patch } });
  };
  const setCaptionSpeechKind = (captionId: string, speechKind: 'dialogue' | 'narration') => {
    const caption = findPanelOrCaption(displayDocument, captionId);
    if (!caption) return;
    const current = captionStyleForPanel(caption);
    updatePanelById(captionId, {
      textStyle: {
        ...current,
        speechKind,
        background: captionBackgroundForSpeech(speechKind),
      },
      ...(speechKind === 'dialogue' && !caption.tail ? { tail: defaultCaptionTail(caption.rect) } : {}),
    });
  };
  const shrinkCaptionToFit = (captionId: string) => {
    const caption = findPanelOrCaption(displayDocument, captionId);
    if (!caption?.pageId) return;
    const grid = pageRefs.current[caption.pageId];
    if (!grid) return;
    const pageRows = LAYOUT_PAGE_ROWS;
    const text = captionTextDrafts[captionId] ?? caption.visibleText;
    const nextHeight = fitCaptionHeightRows(caption, text, grid, pageRows, CAPTION_GRID_SNAP);
    updatePanelById(captionId, { rect: clampCaptionRect({ ...caption.rect, h: nextHeight }, panelLayoutColumns(caption)) });
  };
  const adjustCaptionTextSizeToFit = (captionId: string) => {
    const caption = findPanelOrCaption(displayDocument, captionId);
    if (!caption?.pageId) return;
    const grid = pageRefs.current[caption.pageId];
    if (!grid) return;
    const text = captionTextDrafts[captionId] ?? caption.visibleText;
    const nextSize = fitCaptionFontSize(caption, text, grid, LAYOUT_PAGE_ROWS);
    updateCaptionStyle(captionId, { fontSize: nextSize });
    setCaptionFontSizeDraft(null);
  };
  const commitCaptionFontSizeInput = (captionId: string) => {
    if (captionFontSizeDraft?.captionId !== captionId) return;
    const caption = findPanelOrCaption(displayDocument, captionId);
    if (!caption) {
      setCaptionFontSizeDraft(null);
      return;
    }
    const parsed = Number(captionFontSizeDraft.value);
    const currentSize = captionStyleForPanel(caption).fontSize;
    const nextSize = Number.isFinite(parsed)
      ? Math.min(48, Math.max(6, Math.trunc(parsed)))
      : currentSize;
    setCaptionFontSizeDraft(null);
    if (nextSize !== currentSize) {
      updateCaptionStyle(captionId, { fontSize: nextSize });
    }
  };
  const panelLabelFor = (panel: StoryPanel) => {
    if (panel.title.trim()) return panel.title.trim();
    if (isCaption(panel)) {
      const parent = parentPanelFor(displayDocument, panel);
      const captions = parent ? captionPanelsFor(displayDocument, parent.id) : [];
      const index = captions.findIndex((caption) => caption.id === panel.id);
      const parentLabel = parent ? `Panel ${storyPanelNumberById.get(parent.id) ?? ''}` : 'image';
      return `${captionLabel(Math.max(0, index))} for ${parentLabel}`;
    }
    if (panel.sourceKind === 'bookmark') return 'Bookmark';
    return `Panel ${storyPanelNumberById.get(panel.id) ?? ''}`;
  };
  const sidebarPanelPreview = (panel: StoryPanel) => (panel.storyText || panel.selectedText || panel.visibleText)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  const addCaptionPanel = (parent: StoryPanel) => {
    const captions = captionPanelsFor(displayDocument, parent.id);
    const rect = defaultCaptionRect(parent, captions, panelLayoutColumns(parent));
    const nextCaption: StoryPanelCaption = {
      id: nextPanelId(displayDocument),
      visibleText: '',
      richText: plainTextToRichText(''),
      textStyle: { ...defaultCaptionTextStyle },
      rect,
      tail: defaultCaptionTail(rect),
      layer: parent.layer + 1 + captions.length,
    };
    commitDocument({
      ...displayDocument,
      panels: displayDocument.panels.map((panel) => (
        panel.id === parent.id ? { ...panel, captions: [...(panel.captions ?? []), nextCaption] } : panel
      )),
    });
    onSelectPanel(nextCaption.id);
  };
  const removeCaptionPanel = (captionId: string) => {
    const caption = findPanelOrCaption(displayDocument, captionId);
    const parentId = caption?.parentPanelId ?? null;
    const nextDocument = {
      ...displayDocument,
      panels: displayDocument.panels.map((panel) => ({
        ...panel,
        captions: (panel.captions ?? []).filter((candidate) => candidate.id !== captionId),
      })),
    };
    commitDocument(nextDocument);
    setCaptionTextDrafts((current) => {
      const next = { ...current };
      delete next[captionId];
      return next;
    });
    if (selectedPanelId === captionId && parentId) {
      onSelectPanel(parentId);
    }
  };
  const confirmDeleteCaption = () => {
    const captionId = pendingCaptionDeleteId;
    if (!captionId) return;
    removeCaptionPanel(captionId);
    setPendingCaptionDeleteId(null);
  };
  const commitCaptionTextDraft = (captionId: string) => {
    const draft = captionTextDrafts[captionId];
    if (draft === undefined) return;
    const caption = findPanelOrCaption(displayDocument, captionId);
    if (!caption || !isCaption(caption)) return;
    const nextRichText = plainTextToRichText(draft);
    if (caption.visibleText === draft && (caption.richText || plainTextToRichText(caption.visibleText)) === nextRichText) {
      setCaptionTextDrafts((current) => {
        const next = { ...current };
        delete next[captionId];
        return next;
      });
      return;
    }
    updatePanelById(captionId, { visibleText: draft, richText: nextRichText });
    setCaptionTextDrafts((current) => {
      const next = { ...current };
      delete next[captionId];
      return next;
    });
  };
  const assignPanelImage = (panelId: string, assetId: string) => {
    const panel = displayDocument.panels.find((candidate) => candidate.id === panelId);
    if (!panel) return;
    const nextIds = panel.assetIds.includes(assetId) ? panel.assetIds : [...panel.assetIds, assetId];
    updatePanelById(panelId, { assetIds: nextIds, activeAssetId: assetId, imageCrop: null });
    setCropModePanelId((current) => (current === panelId ? null : current));
  };
  const clearPanelImage = (panelId: string) => {
    updatePanelById(panelId, { assetIds: [], activeAssetId: null, imageCrop: null });
    setCropModePanelId((current) => (current === panelId ? null : current));
  };
  const setPanelActiveAsset = (panelId: string, assetId: string) => {
    updatePanelById(panelId, { activeAssetId: assetId });
  };
  const updatePanelImageCrop = (panelId: string, patch: Partial<StoryPanelImageCrop>) => {
    const panel = displayDocument.panels.find((candidate) => candidate.id === panelId);
    if (!panel) return;
    updatePanelById(panelId, { imageCrop: { ...imageCropForPanel(panel), ...patch } });
  };
  const resetPanelImageCrop = (panelId: string) => {
    updatePanelById(panelId, { imageCrop: null });
  };
  const applyZoomDraft = (panelId: string, scalePercent: number) => {
    const scale = scalePercent / 100;
    setDraftDocument((current) => {
      const doc = current ?? displayDocumentRef.current;
      const nextDocument = {
        ...doc,
        panels: doc.panels.map((panel) => (
          panel.id === panelId
            ? { ...panel, imageCrop: { ...imageCropForPanel(panel), scale } }
            : panel
        )),
      };
      draftDocumentRef.current = nextDocument;
      return nextDocument;
    });
  };
  const beginZoomAdjust = (event: React.PointerEvent, panelId: string) => {
    event.stopPropagation();
    zoomDragPanelIdRef.current = panelId;
    draftDocumentRef.current = displayDocumentRef.current;
    setDraftDocument(displayDocumentRef.current);
  };
  const endZoomAdjust = (panelId: string, scalePercent: number) => {
    if (zoomDragPanelIdRef.current !== panelId) return;
    const scale = scalePercent / 100;
    const doc = draftDocumentRef.current ?? displayDocumentRef.current;
    const nextDocument = {
      ...doc,
      panels: doc.panels.map((panel) => (
        panel.id === panelId
          ? { ...panel, imageCrop: { ...imageCropForPanel(panel), scale } }
          : panel
      )),
    };
    zoomDragPanelIdRef.current = null;
    draftDocumentRef.current = null;
    setDraftDocument(null);
    commitDocument(nextDocument, 'Zoom image', document);
  };
  const cancelZoomAdjust = () => {
    zoomDragPanelIdRef.current = null;
    draftDocumentRef.current = null;
    setDraftDocument(null);
  };
  const snapPanelToAspectRatio = (panel: StoryPanel, aspectRatio: string) => {
    if (!panel.pageId) return;
    const pageRows = LAYOUT_PAGE_ROWS;
    const columns = panelLayoutColumns(panel);
    const nextRect = snapRectToAspectRatio(
      panel.rect,
      pageRows,
      parseAspectRatio(aspectRatio),
      panel.panelKind,
      (rect, panelKind) => clampRect(rect, panelKind, columns),
      columns,
    );
    updatePanelById(panel.id, { rect: nextRect, aspectRatio });
  };
  const snapPanelToPageSizeFraction = (panel: StoryPanel, axis: 'width' | 'height', fraction: PageSizeFraction) => {
    if (!panel.pageId) return;
    const pageRows = LAYOUT_PAGE_ROWS;
    const sized = rectWithPageSizeFractions(panel.rect, {
      width: axis === 'width' ? fraction : undefined,
      height: axis === 'height' ? fraction : undefined,
    });
    const nextRect = clampPanelRect(sized, panel);
    const visualRatio = panelVisualAspectRatio(nextRect, pageRows);
    const nextAspectRatio = formatAspectRatioFromPixels(
      Math.round(visualRatio * 10000),
      10000,
    );
    updatePanelById(panel.id, {
      rect: nextRect,
      aspectRatio: nextAspectRatio,
      aspectRatioLocked: false,
    });
  };
  const snapSelectedPanelToImageRatio = async (panel: StoryPanel) => {
    if (!panel.activeAssetId) return;
    setIsSnappingAspect(true);
    try {
      const url = await loadAssetImageUrl(projectSlug, panel.activeAssetId);
      if (!url) return;
      const { width, height } = await loadImageDimensions(url);
      snapPanelToAspectRatio(panel, formatAspectRatioFromPixels(width, height));
    } finally {
      setIsSnappingAspect(false);
    }
  };
  const togglePanelAspectRatioLock = (panel: StoryPanel) => {
    if (panel.aspectRatioLocked) {
      updatePanelById(panel.id, { aspectRatioLocked: false });
      return;
    }
    if (!panel.pageId) return;
    const pageRows = LAYOUT_PAGE_ROWS;
    const visualRatio = panelVisualAspectRatio(panel.rect, pageRows);
    const currentRatio = formatAspectRatioFromPixels(
      Math.round(visualRatio * 10000),
      10000,
    );
    updatePanelById(panel.id, { aspectRatio: currentRatio, aspectRatioLocked: true });
  };
  const renderImagePanelBody = (panel: StoryPanel, cropModeActive = false) => {
    const activeAsset = panel.activeAssetId ? assetById.get(panel.activeAssetId) ?? null : null;
    const passage = (panel.storyText || panel.selectedText || panel.visibleText || '').replace(/\s+/g, ' ').trim();
    if (activeAsset) {
      const crop = imageCropForPanel(panel);
      if (cropModeActive) {
        return (
          <div
            className={`story-panels-page-panel-crop-layer ${cropDragState?.panelId === panel.id ? 'is-crop-dragging' : ''}`}
            onPointerDown={(event) => beginCropPan(event, panel)}
            onPointerMove={(event) => {
              if ((event.target as HTMLElement).closest('.story-panels-page-panel-crop-zoom')) return;
              continueCropPan(event);
            }}
            onPointerUp={endCropPan}
            onPointerCancel={endCropPan}
          >
            <img
              className="story-panels-page-panel-image"
              src={assetThumbnailUrl(projectSlug, activeAsset)}
              alt=""
              draggable={false}
              style={panelImageCropStyle(crop)}
            />
            <div className="story-panels-page-panel-crop-zoom">
              <input
                type="range"
                min={100}
                max={400}
                step={5}
                aria-label="Image zoom"
                disabled={isSaving}
                value={Math.round(crop.scale * 100)}
                onPointerDown={(event) => beginZoomAdjust(event, panel.id)}
                onInput={(event) => {
                  event.stopPropagation();
                  applyZoomDraft(panel.id, Number(event.currentTarget.value));
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  endZoomAdjust(panel.id, Number(event.currentTarget.value));
                }}
                onLostPointerCapture={(event) => {
                  if (zoomDragPanelIdRef.current === panel.id) {
                    endZoomAdjust(panel.id, Number(event.currentTarget.value));
                  }
                }}
                onPointerCancel={(event) => {
                  event.stopPropagation();
                  cancelZoomAdjust();
                }}
                onKeyUp={(event) => {
                  if (event.key === 'Enter') {
                    endZoomAdjust(panel.id, Number(event.currentTarget.value));
                  }
                }}
              />
              <button
                type="button"
                className="secondary"
                disabled={isSaving}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setCropModePanelId(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        );
      }
      return (
        <img
          className="story-panels-page-panel-image"
          src={assetThumbnailUrl(projectSlug, activeAsset)}
          alt=""
          draggable={false}
          style={panelImageCropStyle(crop)}
        />
      );
    }
    return (
      <>
        {isPanel(panel) && !isCaption(panel) && (
          <strong>Panel {storyPanelNumberById.get(panel.id) ?? ''}</strong>
        )}
        <span>{passage.slice(0, 120)}</span>
      </>
    );
  };
  const updateSelectedPanelTextStyle = (patch: Partial<StoryPanelTextStyle>) => {
    if (!selectedPanel) return;
    updateSelectedPanel({ textStyle: { ...textStyleForPanel(selectedPanel), ...patch } });
  };
  const commitFontSizeInput = () => {
    if (!selectedPanel) return;
    if (fontSizeInput === null) return;
    const parsed = Number(fontSizeInput);
    const nextSize = Number.isFinite(parsed)
      ? Math.min(48, Math.max(6, Math.trunc(parsed)))
      : textStyleForPanel(selectedPanel).fontSize;
    setFontSizeInput(null);
    if (nextSize !== textStyleForPanel(selectedPanel).fontSize) {
      updateSelectedPanelTextStyle({ fontSize: nextSize });
    }
  };
  const layoutReadingChunkPanel = readingChunkPanelForLayoutAction(displayDocument, visibleSelectedPanel);
  const requestDeleteSelectedPanel = () => {
    if (!visibleSelectedPanel || isSaving) return;
    const chunkPanel = readingChunkPanelForLayoutAction(displayDocument, visibleSelectedPanel);
    setPendingPanelDeleteId((chunkPanel ?? visibleSelectedPanel).id);
  };
  const confirmRemoveSelectedPanel = () => {
    const panelId = pendingPanelDeleteId;
    if (!panelId) return;
    const panel = findPanelOrCaption(displayDocument, panelId);
    if (!panel) return;
    if (isCaption(panel)) {
      removeCaptionPanel(panelId);
      setPendingPanelDeleteId(null);
      return;
    }
    if (isPanel(panel) && !isCaption(panel)) {
      commitDocument(removeStoryPanelFromLayout(displayDocument, panelId));
    } else {
      commitDocument({
        ...displayDocument,
        panels: panel.panelKind === 'image'
          ? removePanelAndCaptionChildren(displayDocument, panelId)
          : displayDocument.panels.filter((candidate) => candidate.id !== panelId),
      });
    }
    setPendingPanelDeleteId(null);
    onSelectPanel(null);
  };
  const selectedPanelRemoveLabel = layoutReadingChunkPanel ? 'Remove from layout' : 'Delete';
  const commitCustomTextDraft = () => {
    if (!selectedPanel) return;
    persistPanelTextDraft(selectedPanel.id, richTextEditorRef.current?.innerHTML ?? visibleTextDraft);
  };
  const pageIdFromPointer = (clientX: number, clientY: number) => {
    for (const [pageId, element] of Object.entries(pageRefs.current)) {
      if (!element) continue;
      const bounds = element.getBoundingClientRect();
      if (clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom) {
        return pageId;
      }
    }
    return null;
  };
  /** The spread pair a top-level panel drag operates in, when the current view
   * shows both pages of a spread. Inside the pair, drags use a unified
   * 24-column space so panels can straddle the seam. */
  const spreadDragPairFor = (draggedPanel: StoryPanel, pageId: string) => {
    if (layoutMode !== 'spread' || isCaption(draggedPanel)) return null;
    const leftId = spreadRightIdByLeftId.has(pageId) ? pageId : spreadLeftIdByRightId.get(pageId) ?? null;
    if (!leftId) return null;
    const rightId = spreadRightIdByLeftId.get(leftId);
    if (!rightId) return null;
    return { leftId, rightId };
  };
  /** Edge-snap targets (in the drag's column space) from the other panels on the involved pages. */
  const edgeSnapTargets = (
    state: DragState,
    pageIds: string[],
    columns: number,
    toUnifiedX: (panel: StoryPanel) => number,
  ) => {
    const targetsX = new Set<number>([0, columns / 2, columns]);
    const targetsY = new Set<number>([0, LAYOUT_PAGE_ROWS / 2, LAYOUT_PAGE_ROWS]);
    for (const panel of layoutPanels(displayDocument)) {
      if (panel.id === state.panelId || !panel.pageId || !pageIds.includes(panel.pageId)) continue;
      const x = toUnifiedX(panel);
      targetsX.add(x);
      targetsX.add(x + panel.rect.w);
      targetsY.add(panel.rect.y);
      targetsY.add(panel.rect.y + panel.rect.h);
    }
    return { targetsX: [...targetsX], targetsY: [...targetsY] };
  };
  const updatePanelDuringDrag = (event: React.PointerEvent, state: DragState) => {
    const draggedPanel = findPanelOrCaption(displayDocument, state.panelId);
    if (!draggedPanel) return;
    const dragPair = spreadDragPairFor(draggedPanel, state.pageId);
    // Spanning panels stay anchored to the spread's left page; both page grids
    // share column metrics, so any mounted grid of the spread works for math.
    const spanning = Boolean(draggedPanel.spansSpread);
    const targetPageId = isCaption(draggedPanel) || spanning || dragPair
      ? state.pageId
      : pageIdFromPointer(event.clientX, event.clientY) ?? state.pageId;
    const spreadPartnerId = spanning || dragPair
      ? dragPair?.rightId ?? spreadRightIdByLeftId.get(state.pageId)
      : undefined;
    const pageElement = pageRefs.current[targetPageId]
      ?? pageRefs.current[state.pageId]
      ?? (spreadPartnerId ? pageRefs.current[spreadPartnerId] : null);
    if (!pageElement) return;
    const bounds = pageElement.getBoundingClientRect();
    const columnWidth = bounds.width / gridColumns;
    const rowHeight = Math.max(22, bounds.height / LAYOUT_PAGE_ROWS);
    // When only the spread's right page grid is mounted, its origin sits 12
    // columns into the spanning panel's unified coordinate space.
    const gridOriginColumns = spanning && pageElement !== pageRefs.current[state.pageId] ? gridColumns : 0;
    const gridOriginLeft = bounds.left - gridOriginColumns * columnWidth;
    const snapScale = draggedPanel && isCaption(draggedPanel) ? CAPTION_GRID_SNAP : panelSnapScale;
    const deltaColumns = targetPageId === state.pageId ? roundStep((event.clientX - state.startClientX) / columnWidth, snapScale) : roundStep((event.clientX - bounds.left) / columnWidth, snapScale) - state.startRect.x;
    const deltaRows = targetPageId === state.pageId ? roundStep((event.clientY - state.startClientY) / rowHeight, snapScale) : roundStep((event.clientY - bounds.top) / rowHeight, snapScale) - state.startRect.y;
    const pageRows = LAYOUT_PAGE_ROWS;

    if (dragPair) {
      // Unified spread drag: work in 24 columns, then derive page + span state
      // from where the rect lands (auto span / unspan across the seam).
      const spanColumns = gridColumns * 2;
      const startOffset = state.startSpansSpread || state.pageId === dragPair.leftId ? 0 : gridColumns;
      const unifiedStart = { ...state.startRect, x: state.startRect.x + startOffset };
      const leftElement = pageRefs.current[dragPair.leftId];
      const leftBounds = leftElement?.getBoundingClientRect() ?? bounds;
      let unifiedRect: StoryPanelRect;
      let guides: SnapGuides | null = null;
      if (state.mode === 'resize') {
        if (draggedPanel.aspectRatioLocked && draggedPanel.aspectRatio) {
          const minWidth = draggedPanel.panelKind === 'text' ? minTextPanelWidth : minPanelWidth;
          const minHeight = draggedPanel.panelKind === 'text' ? minTextPanelHeight : minPanelHeight;
          unifiedRect = lockedAspectRectFromPointer({
            anchor: unifiedStart,
            corner: state.corner ?? 'se',
            pointer: { clientX: event.clientX, clientY: event.clientY },
            pageBounds: { left: leftBounds.left, top: leftBounds.top },
            columnWidthPx: columnWidth,
            rowHeightPx: rowHeight,
            pageRows,
            targetAspect: parseAspectRatio(draggedPanel.aspectRatio),
            bounds: { minWidth, minHeight, snapScale: PANEL_DRAG_SNAP_SCALE },
            columns: spanColumns,
          });
        } else {
          unifiedRect = resizeRectFromCorner(
            unifiedStart,
            state.corner ?? 'se',
            deltaColumns,
            deltaRows,
            { ...draggedPanel, spansSpread: true },
          );
        }
      } else {
        const moved = { ...unifiedStart, x: unifiedStart.x + deltaColumns, y: unifiedStart.y + deltaRows };
        const { targetsX, targetsY } = edgeSnapTargets(
          state,
          [dragPair.leftId, dragPair.rightId],
          spanColumns,
          (panel) => (panel.spansSpread || panel.pageId === dragPair.leftId ? panel.rect.x : panel.rect.x + gridColumns),
        );
        const snapped = snapRectToEdgeTargets(moved, targetsX, targetsY);
        unifiedRect = clampRect(snapped.rect, draggedPanel.panelKind, spanColumns);
        guides = { pageIds: [dragPair.leftId, dragPair.rightId], cols: snapped.cols, rows: snapped.rows };
      }
      const epsilon = 1e-6;
      const nextPatch: Partial<StoryPanel> = unifiedRect.x + unifiedRect.w <= gridColumns + epsilon
        ? { pageId: dragPair.leftId, spansSpread: false, rect: unifiedRect }
        : unifiedRect.x >= gridColumns - epsilon
          ? { pageId: dragPair.rightId, spansSpread: false, rect: { ...unifiedRect, x: unifiedRect.x - gridColumns } }
          : { pageId: dragPair.leftId, spansSpread: true, rect: unifiedRect };
      // Unspanning drops captions back into the 12-column page space. Compute
      // from the pre-drag document so repeated move events stay idempotent.
      if (state.startSpansSpread && !nextPatch.spansSpread) {
        const originalPanel = document.panels.find((candidate) => candidate.id === state.panelId);
        if (originalPanel?.captions?.length) {
          const movesRight = nextPatch.pageId === dragPair.rightId;
          nextPatch.captions = originalPanel.captions.map((caption) => {
            const shift = movesRight && caption.rect.x + caption.rect.w / 2 >= gridColumns ? gridColumns : 0;
            const tailShift = movesRight && (caption.tail?.x ?? 0) >= gridColumns ? gridColumns : 0;
            return {
              ...caption,
              rect: clampCaptionRect({ ...caption.rect, x: caption.rect.x - shift }),
              tail: caption.tail
                ? {
                  x: Math.min(gridColumns, Math.max(0, caption.tail.x - tailShift)),
                  y: caption.tail.y,
                }
                : caption.tail,
            };
          });
        }
      }
      setSnapGuides(guides);
      setDraftDocument(updatePanelOrCaptionById(displayDocument, state.panelId, nextPatch));
      return;
    }

    let nextPatch: Partial<StoryPanel>;
      if (state.mode === 'resize') {
        if (draggedPanel.aspectRatioLocked && draggedPanel.aspectRatio) {
          const caption = isCaption(draggedPanel);
          const minWidth = caption ? 0.5 : draggedPanel.panelKind === 'text' ? minTextPanelWidth : minPanelWidth;
          const minHeight = caption ? 0.25 : draggedPanel.panelKind === 'text' ? minTextPanelHeight : minPanelHeight;
          const rect = lockedAspectRectFromPointer({
            anchor: state.startRect,
            corner: state.corner ?? 'se',
            pointer: { clientX: event.clientX, clientY: event.clientY },
            pageBounds: { left: gridOriginLeft, top: bounds.top },
            columnWidthPx: columnWidth,
            rowHeightPx: rowHeight,
            pageRows,
            targetAspect: parseAspectRatio(draggedPanel.aspectRatio),
            bounds: { minWidth, minHeight, snapScale: PANEL_DRAG_SNAP_SCALE },
            columns: panelLayoutColumns(draggedPanel),
          });
          nextPatch = { rect };
        } else {
          nextPatch = {
            rect: resizeRectFromCorner(state.startRect, state.corner ?? 'se', deltaColumns, deltaRows, draggedPanel),
          };
        }
      } else {
        const moved = {
          ...state.startRect,
          x: state.startRect.x + deltaColumns,
          y: state.startRect.y + deltaRows,
        };
        let snappedRect = moved;
        if (!isCaption(draggedPanel) && targetPageId === state.pageId) {
          const { targetsX, targetsY } = edgeSnapTargets(
            state,
            [state.pageId],
            panelLayoutColumns(draggedPanel),
            (panel) => panel.rect.x,
          );
          const snapped = snapRectToEdgeTargets(moved, targetsX, targetsY);
          snappedRect = snapped.rect;
          setSnapGuides({ pageIds: [state.pageId], cols: snapped.cols, rows: snapped.rows });
        }
        nextPatch = {
          ...(isCaption(draggedPanel) ? {} : { pageId: targetPageId }),
          rect: clampPanelRect(snappedRect, draggedPanel),
        };
      }
    setDraftDocument(updatePanelOrCaptionById(displayDocument, state.panelId, nextPatch));
  };
  const beginDrag = (event: React.PointerEvent, panel: StoryPanel, mode: DragMode, corner?: ResizeCorner) => {
    if (isSaving || !panel.pageId) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === 'move' && selectedPanelId !== panel.id) {
      onSelectPanel(panel.id);
      return;
    }
    onSelectPanel(panel.id);
    const activated = mode === 'resize';
    const state: DragState = {
      panelId: panel.id,
      pageId: panel.pageId,
      mode,
      corner,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: panel.rect,
      startSpansSpread: Boolean(panel.spansSpread),
      activated,
    };
    setSnapGuides(null);
    setDragState(state);
    if (activated) {
      setDraftDocument(displayDocument);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const continueDrag = (event: React.PointerEvent) => {
    if (!dragState) return;
    let activeState = dragState;
    if (!activeState.activated) {
      const deltaX = event.clientX - activeState.startClientX;
      const deltaY = event.clientY - activeState.startClientY;
      if (Math.hypot(deltaX, deltaY) < PANEL_DRAG_ACTIVATION_PX) return;
      activeState = { ...activeState, activated: true };
      setDragState(activeState);
      setDraftDocument(displayDocument);
    }
    updatePanelDuringDrag(event, activeState);
  };
  const endDrag = () => {
    if (!dragState) return;
    setSnapGuides(null);
    if (!dragState.activated) {
      setDragState(null);
      return;
    }
    if (!draftDocument) return;
    const label = dragState.mode === 'resize' ? 'Resize panel' : 'Move panel';
    let nextDocument = draftDocument;
    if (dragState.mode === 'resize') {
      const resizedPanel = findPanelOrCaption(nextDocument, dragState.panelId);
      const spaceChanged = resizedPanel
        && (resizedPanel.pageId !== dragState.pageId || Boolean(resizedPanel.spansSpread) !== dragState.startSpansSpread);
      if (!spaceChanged && resizedPanel?.aspectRatioLocked && resizedPanel.aspectRatio) {
        const pageRows = LAYOUT_PAGE_ROWS;
        const caption = isCaption(resizedPanel);
        const minWidth = caption ? 0.5 : resizedPanel.panelKind === 'text' ? minTextPanelWidth : minPanelWidth;
        const minHeight = caption ? 0.25 : resizedPanel.panelKind === 'text' ? minTextPanelHeight : minPanelHeight;
        const rect = snapNearestAspectRect(
          resizedPanel.rect,
          dragState.startRect,
          dragState.corner ?? 'se',
          pageRows,
          parseAspectRatio(resizedPanel.aspectRatio),
          PANEL_COMMIT_SNAP_SCALE,
          { minWidth, minHeight },
          panelLayoutColumns(resizedPanel),
        );
        nextDocument = updatePanelOrCaptionById(nextDocument, resizedPanel.id, { rect });
      }
    }
    setDragState(null);
    setDraftDocument(null);
    commitDocument(nextDocument, label, document);
  };
  const tailDragRef = useRef<{ captionId: string; columns: number; offsetColumns: number; box: DOMRect } | null>(null);
  const beginTailDrag = (event: React.PointerEvent<SVGCircleElement>, caption: StoryPanel, offsetColumns: number) => {
    if (isSaving) return;
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    tailDragRef.current = {
      captionId: caption.id,
      columns: panelLayoutColumns(caption),
      offsetColumns,
      box: svg.getBoundingClientRect(),
    };
    setDraftDocument(displayDocumentRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const continueTailDrag = (event: React.PointerEvent<SVGCircleElement>) => {
    const state = tailDragRef.current;
    if (!state) return;
    const gridX = ((event.clientX - state.box.left) / state.box.width) * gridColumns + state.offsetColumns;
    const gridY = ((event.clientY - state.box.top) / state.box.height) * LAYOUT_PAGE_ROWS;
    const tail: StoryPanelCaptionTail = {
      x: Math.min(state.columns, Math.max(0, roundStep(gridX, CAPTION_GRID_SNAP))),
      y: Math.min(LAYOUT_PAGE_ROWS, Math.max(0, roundStep(gridY, CAPTION_GRID_SNAP))),
    };
    setDraftDocument(updatePanelOrCaptionById(displayDocumentRef.current, state.captionId, { tail }));
  };
  const endTailDrag = () => {
    if (!tailDragRef.current) return;
    tailDragRef.current = null;
    const nextDocument = draftDocumentRef.current;
    setDraftDocument(null);
    if (nextDocument) commitDocument(nextDocument, 'Move speech tail', document);
  };
  const beginCropPan = (event: React.PointerEvent<HTMLDivElement>, panel: StoryPanel) => {
    if (isSaving || cropModePanelId !== panel.id || !panel.activeAssetId) return;
    if ((event.target as HTMLElement).closest('.story-panels-page-panel-crop-zoom')) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setCropDragState({
      panelId: panel.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCrop: imageCropForPanel(panel),
      panelWidth: bounds.width,
      panelHeight: bounds.height,
    });
    setDraftDocument(displayDocument);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const continueCropPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!cropDragState || !draftDocument) return;
    const deltaX = event.clientX - cropDragState.startClientX;
    const deltaY = event.clientY - cropDragState.startClientY;
    const nextFocal = focalFromPanDelta(
      cropDragState.startCrop,
      deltaX,
      deltaY,
      cropDragState.panelWidth,
      cropDragState.panelHeight,
    );
    setDraftDocument({
      ...draftDocument,
      panels: draftDocument.panels.map((panel) => (
        panel.id === cropDragState.panelId
          ? { ...panel, imageCrop: { ...cropDragState.startCrop, ...nextFocal } }
          : panel
      )),
    });
  };
  const endCropPan = () => {
    if (!cropDragState || !draftDocument) return;
    const nextDocument = draftDocument;
    setCropDragState(null);
    setDraftDocument(null);
    commitDocument(nextDocument, 'Adjust image crop', document);
  };
  const openPanelMenu = (event: React.MouseEvent, panel: StoryPanel) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectPanel(panel.id);
    setPageMenu({ kind: 'panel', x: event.clientX, y: event.clientY, panelId: panel.id });
  };
  const openPageMenu = (event: React.MouseEvent<HTMLDivElement>, pageId: string) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const columnWidth = bounds.width / gridColumns;
    const rows = LAYOUT_PAGE_ROWS;
    const rowHeight = Math.max(22, bounds.height / rows);
    const minWidth = selectedPanel?.panelKind === 'text' ? minTextPanelWidth : minPanelWidth;
    const x = Math.min(gridColumns - minWidth, Math.max(0, roundStep((event.clientX - bounds.left) / columnWidth, panelSnapScale)));
    const y = Math.max(0, roundStep((event.clientY - bounds.top) / rowHeight, panelSnapScale));
    setPageMenu({ kind: 'page', x: event.clientX, y: event.clientY, pageId, rect: { x, y, w: selectedPanel?.rect.w ?? 6, h: selectedPanel?.rect.h ?? 3 } });
    setPageMenuSubmenu(null);
  };
  const clearPanelSelection = () => {
    if (!selectedPanelId || isSaving || dragState) return;
    const editingPanelId = richTextEditingPanelIdRef.current;
    if (editingPanelId) {
      persistPanelTextDraft(
        editingPanelId,
        visibleTextDraftRef.current ?? richTextEditorRef.current?.innerHTML,
      );
    }
    onSelectPanel(null);
  };
  const handlePageBackgroundClick = (event: React.MouseEvent<HTMLElement>) => {
    if (layoutMode === 'all-pages') return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('.story-panels-page-panel')) return;
    clearPanelSelection();
  };
  const handlePagePreviewBackgroundClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (layoutMode === 'all-pages') return;
    if (event.target !== event.currentTarget) return;
    clearPanelSelection();
  };
  const openPageDetail = (pageId: string) => {
    const pageIndex = pages.findIndex((page) => page.id === pageId);
    if (pageIndex < 0) return;
    setCurrentPageIndex(pageIndex);
    setSelectedPageId(pageId);
    onLayoutModeChange('single');
  };
  const openPanelDetail = (event: React.MouseEvent, panel: StoryPanel) => {
    event.preventDefault();
    event.stopPropagation();
    const pageIndex = pages.findIndex((page) => page.id === panel.pageId);
    if (pageIndex >= 0) {
      setCurrentPageIndex(pageIndex);
      setSelectedPageId(panel.pageId);
    }
    onSelectPanel(panel.id);
    if (layoutMode === 'all-pages') {
      onLayoutModeChange('single');
    }
    onInspectorVisibleChange(true);
  };
  const singlePrintSlotForPage = (page: StoryPanelDocument['pages'][number] | null, fallbackIndex: number) => {
    const pageIndex = page ? pages.findIndex((candidate) => candidate.id === page.id) : fallbackIndex;
    return pageIndex >= 0 && pageIndex % 2 === 0 ? 'left' : 'right';
  };
  const singlePrintFrameStyle = (printSlot: 'left' | 'right'): CSSProperties => ({
    gridTemplateColumns: printSlot === 'left'
      ? `${PRINT_OUTER_MARGIN}fr ${PRINT_PAGE_WIDTH}fr ${PRINT_INNER_GUTTER}fr`
      : `${PRINT_INNER_GUTTER}fr ${PRINT_PAGE_WIDTH}fr ${PRINT_OUTER_MARGIN}fr`,
    gridTemplateRows: PRINT_SHEET_GRID_ROWS,
  });
  const renderSinglePagePreviewFrame = (
    page: StoryPanelDocument['pages'][number] | null,
    fallbackIndex: number,
    grid: ReactNode,
  ) => {
    if (!hasSinglePageSidePanel) return grid;
    const printSlot = singlePrintSlotForPage(page, fallbackIndex);
    return (
      <div
        className={`story-panels-single-page-preview is-${singlePagePreviewMode} is-print-slot-${printSlot}`}
        style={singlePagePreviewMode === 'print' ? singlePrintFrameStyle(printSlot) : undefined}
        onClick={handlePagePreviewBackgroundClick}
      >
        {grid}
      </div>
    );
  };
  const applyRichTextCommand = (command: 'bold' | 'italic' | 'underline') => {
    window.document.execCommand(command);
    const active = window.document.activeElement;
    if (active instanceof HTMLElement && active.classList.contains('story-panels-rich-text-editor')) {
      setVisibleTextDraft(sanitizeRichText(active.innerHTML));
    }
  };
  /** Tail SVGs for the dialogue captions on one page, drawn over the bubbles
   * in printable-page point space (360×576) so web and PDF tails match. */
  const renderCaptionTails = (pagePanels: { panel: StoryPanel; offsetColumns: number }[], interactive: boolean) => (
    pagePanels.map(({ panel, offsetColumns }) => {
      if (!isCaption(panel) || !panel.tail) return null;
      const style = captionStyleForPanel(panel);
      if (captionSpeechKindFor(style) !== 'dialogue' || style.background === 'transparent') return null;
      const toPt = (gridX: number, gridY: number) => ({
        x: ((gridX - offsetColumns) / gridColumns) * PRINT_PAGE_WIDTH,
        y: (gridY / LAYOUT_PAGE_ROWS) * PRINT_PAGE_HEIGHT,
      });
      const origin = toPt(panel.rect.x, panel.rect.y);
      const rectPt = {
        ...origin,
        w: (panel.rect.w / gridColumns) * PRINT_PAGE_WIDTH,
        h: (panel.rect.h / LAYOUT_PAGE_ROWS) * PRINT_PAGE_HEIGHT,
      };
      const tipPt = toPt(panel.tail.x, panel.tail.y);
      const geometry = speechTailGeometry(rectPt, tipPt);
      const selected = interactive && selectedPanelId === panel.id;
      if (!geometry && !selected) return null;
      return (
        <svg
          key={`${panel.id}-tail-${offsetColumns}`}
          className="story-panels-caption-tail"
          viewBox={`0 0 ${PRINT_PAGE_WIDTH} ${PRINT_PAGE_HEIGHT}`}
          preserveAspectRatio="none"
          style={{ zIndex: panel.layer + 2 }}
          aria-hidden="true"
        >
          {geometry && (
            <>
              <polygon
                points={geometry.fill.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="#ffffff"
              />
              {geometry.edges.map(([start, end], index) => (
                <line
                  key={index}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="#cbd5e1"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          )}
          {selected && (
            <circle
              className="story-panels-caption-tail-handle"
              cx={tipPt.x}
              cy={tipPt.y}
              r={7}
              onPointerDown={(event) => beginTailDrag(event, panel, offsetColumns)}
              onPointerMove={continueTailDrag}
              onPointerUp={endTailDrag}
              onPointerCancel={endTailDrag}
            />
          )}
        </svg>
      );
    })
  );
  const renderSnapGuides = (pageId: string) => {
    if (!dragState || !snapGuides || !snapGuides.pageIds.includes(pageId)) return null;
    const offset = snapGuides.pageIds[0] === pageId ? 0 : gridColumns;
    return (
      <>
        {snapGuides.cols
          .filter((col) => col >= offset && col <= offset + gridColumns)
          .map((col) => (
            <span
              key={`guide-col-${col}`}
              className="story-panels-snap-guide is-col"
              style={{ left: `${((col - offset) / gridColumns) * 100}%` }}
              aria-hidden="true"
            />
          ))}
        {snapGuides.rows.map((row) => (
          <span
            key={`guide-row-${row}`}
            className="story-panels-snap-guide is-row"
            style={{ top: `${(row / LAYOUT_PAGE_ROWS) * 100}%` }}
            aria-hidden="true"
          />
        ))}
      </>
    );
  };
  const undoEntry = undoStack[undoStack.length - 1];
  const redoEntry = redoStack[redoStack.length - 1];
  const viewModes: { mode: StoryPanelLayoutMode; label: string; shortcut: string }[] = [
    { mode: 'all-pages', label: 'All pages', shortcut: 'a' },
    { mode: 'spread', label: 'Spread', shortcut: '2' },
    { mode: 'single', label: 'Single', shortcut: 's' },
  ];
  const shortcutRows: { keys: string; action: string }[] = [
    { keys: 'a / 2 / s', action: 'All pages, spread, or single page view' },
    { keys: 'p', action: 'Show or hide the Panels tray' },
    { keys: 'i', action: 'Show or hide the inspector' },
    { keys: '← / →', action: 'Previous / next page' },
    { keys: 'd', action: 'Delete the selected panel (or page in All pages view)' },
    { keys: '⌘Z / ⇧⌘Z', action: 'Undo / redo' },
    { keys: 'Right-click page', action: 'Create or place a panel at that spot' },
    { keys: '?', action: 'Show or hide this overview' },
  ];
  const toolbar = (
    <header className="layout-view-toolbar">
      <div className="layout-view-toolbar-primary">
        <HoverTooltip text={undoEntry ? `Undo: ${undoEntry.label} (⌘Z)` : 'Undo (⌘Z)'} placement="bottom">
          <button type="button" className="secondary small-button" disabled={isSaving || undoStack.length === 0} onClick={undo} aria-label={undoEntry ? `Undo ${undoEntry.label}` : 'Undo'}>
            <Icon name="undo" />
          </button>
        </HoverTooltip>
        <HoverTooltip text={redoEntry ? `Redo: ${redoEntry.label} (⇧⌘Z)` : 'Redo (⇧⌘Z)'} placement="bottom">
          <button type="button" className="secondary small-button" disabled={isSaving || redoStack.length === 0} onClick={redo} aria-label={redoEntry ? `Redo ${redoEntry.label}` : 'Redo'}>
            <Icon name="redo" />
          </button>
        </HoverTooltip>
        <div ref={addPanelMenuRef} className="story-panels-add-panel-wrap">
          <button
            type="button"
            className={clsx('secondary', { 'is-active': addPanelMenuOpen })}
            disabled={isSaving || !onCreatePanelAt}
            aria-expanded={addPanelMenuOpen}
            aria-haspopup="menu"
            onClick={() => setAddPanelMenuOpen((open) => !open)}
          >
            + Panel
          </button>
          {addPanelMenuOpen && (
            <div className="story-panels-add-panel-menu" role="menu" aria-label="Add panel">
              <button type="button" role="menuitem" onClick={() => addPanelToCurrentPage('image')}>Image panel</button>
              <button type="button" role="menuitem" onClick={() => addPanelToCurrentPage('text')}>Text panel</button>
            </div>
          )}
        </div>
        <HoverTooltip text={panelsTrayVisible ? 'Hide Panels tray (p)' : 'Show Panels tray (p)'} placement="bottom">
          <button
            type="button"
            className={clsx('secondary small-button layout-view-tray-toggle', { 'is-active': panelsTrayVisible })}
            disabled={isSaving}
            aria-pressed={panelsTrayVisible}
            aria-label={panelsTrayVisible ? 'Hide Panels tray' : 'Show Panels tray'}
            onClick={() => onPanelsTrayVisibleChange(!panelsTrayVisible)}
          >
            <Icon name="images" />
          </button>
        </HoverTooltip>
        <HoverTooltip text={inspectorVisible ? 'Hide inspector (i)' : 'Show inspector (i)'} placement="bottom">
          <button
            type="button"
            className={clsx('secondary small-button layout-view-spread-info-toggle', { 'is-active': inspectorVisible })}
            disabled={isSaving || layoutMode === 'all-pages'}
            aria-pressed={inspectorVisible}
            aria-label={inspectorVisible ? 'Hide inspector' : 'Show inspector'}
            onClick={() => onInspectorVisibleChange(!inspectorVisible)}
          >
            <Icon name="info" />
          </button>
        </HoverTooltip>
        <HoverTooltip
          text={singlePagePreviewMode === 'print' ? 'Hide print preview' : 'Show print preview'}
          placement="bottom"
        >
          <button
            type="button"
            className={clsx('secondary small-button layout-view-export-button', { 'is-active': singlePagePreviewMode === 'print' })}
            disabled={isSaving || layoutMode === 'all-pages'}
            aria-pressed={singlePagePreviewMode === 'print'}
            aria-label={singlePagePreviewMode === 'print' ? 'Hide print preview' : 'Show print preview'}
            onClick={onTogglePrintPreview}
          >
            <Icon name="print" />
          </button>
        </HoverTooltip>
      </div>
      <div className="layout-view-toolbar-center">
        <div className="story-panels-preview-toggle" role="group" aria-label="Layout view">
          {viewModes.map(({ mode, label, shortcut }) => (
            <button
              key={mode}
              type="button"
              className={layoutMode === mode ? 'is-active' : ''}
              disabled={isSaving}
              aria-pressed={layoutMode === mode}
              title={`${label} (${shortcut})`}
              onClick={() => onLayoutModeChange(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="layout-view-toolbar-page">
        <div className="story-panels-page-nav" aria-label="Page navigation">
          {layoutMode === 'all-pages' ? (
            <>
              <button type="button" className="secondary" disabled={isSaving || !selectedPageCanChangeOrder || selectedStoryPageIndex <= 0} onClick={() => moveSelectedPage(-1)}>Move left</button>
              <button type="button" className="secondary" disabled={isSaving || !selectedPageCanChangeOrder || selectedStoryPageIndex < 0 || selectedStoryPageIndex >= storyPages.length - 1} onClick={() => moveSelectedPage(1)}>Move right</button>
              <button type="button" className="secondary" disabled={isSaving || !selectedPageCanChangeOrder} onClick={addPageAfterSelected}>Add story page after</button>
              <button
                type="button"
                className="secondary story-panels-delete-page-button"
                disabled={isSaving || !selectedPageCanChangeOrder || storyPages.length <= 1}
                onClick={requestDeleteSelectedPage}
                aria-label="Delete page"
                title="Delete page"
              >
                <TrashIcon />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="secondary small-button" disabled={isSaving || clampedPageIndex <= 0} onClick={goPrevious} aria-label="Previous page (←)" title="Previous page (←)">
                <span aria-hidden="true">←</span>
              </button>
              <button
                type="button"
                className="story-panels-page-jump"
                disabled={isSaving || storyPages.length === 0}
                aria-label={`Current page ${currentPageLabel} of ${Math.max(1, storyPages.length)}. Open the pages rail.`}
                title="Show the pages rail"
                onClick={() => setFilmstripCollapsed(false)}
              >
                {currentPageLabel} <span aria-hidden="true">/</span> {Math.max(1, storyPages.length)}
              </button>
              <button
                type="button"
                className="secondary small-button"
                disabled={isSaving || !canGoNextExistingPage}
                onClick={goNext}
                aria-label="Next page (→)"
                title="Next page (→)"
              >
                <span aria-hidden="true">→</span>
              </button>
              <button
                type="button"
                className="secondary"
                disabled={isSaving}
                onClick={addPagesToNextStorySignature}
                aria-label={`Add ${pagesToReachNextStorySignature()} pages`}
                title={`Add ${pagesToReachNextStorySignature()} pages to reach a multiple of 4 story pages`}
              >
                + Pages
              </button>
            </>
          )}
          <HoverTooltip text="Keyboard shortcuts (?)" placement="bottom">
            <button
              type="button"
              className="secondary small-button"
              aria-label="Keyboard shortcuts"
              onClick={() => setHelpOpen(true)}
            >
              ?
            </button>
          </HoverTooltip>
        </div>
      </div>
    </header>
  );

  return (
    <>
      {toolbar}
      <div
        className={`story-panels-layout-workspace is-${layoutMode} ${usesLayoutPreview ? `is-layout-preview-${singlePagePreviewMode}` : ''}`}
        style={pageLayoutStyle}
      >
        {panelsTrayVisible && (
          <div className="story-panels-layout-side-panel is-tray">
            {sidePanel}
          </div>
        )}
        <div className="story-panels-pages">
        {visiblePages.length ? (
          layoutMode === 'spread' ? (
            <div className="story-panels-spread-wrap">
              <div
                className="story-panels-spread-labels"
                style={singlePagePreviewMode === 'print' ? { gridTemplateColumns: PRINT_SHEET_GRID_COLUMNS } : undefined}
              >
                {visiblePages.map((page, pageIndex) => (
                  <h3
                    key={page ? `${page.id}-label` : `spread-blank-label-${pageIndex}`}
                    className={`is-spread-slot-${pageIndex === 0 ? 'left' : 'right'}`}
                  >
                    {page ? (
                      <>
                        {page.title || page.id} <span>{pageKindLabel(page.pageKind)}</span>
                      </>
                    ) : (
                      'Intentionally Blank'
                    )}
                  </h3>
                ))}
              </div>
              <div
                className="story-panels-print-sheet"
                style={singlePagePreviewMode === 'print' ? {
                  aspectRatio: PRINT_SHEET_ASPECT_RATIO,
                  gridTemplateColumns: PRINT_SHEET_GRID_COLUMNS,
                  gridTemplateRows: PRINT_SHEET_GRID_ROWS,
                } : undefined}
              >
              {visiblePages.map((page, pageIndex) => {
                const spreadSlot = pageIndex === 0 ? 'left' : 'right';
                if (!page) {
                  return (
                    <article
                      key={`spread-blank-${spreadSlot}`}
                      className={`story-panels-page is-blank is-spread-slot is-spread-slot-${spreadSlot}`}
                    >
                      <div className="story-panels-page-grid story-panels-blank-page">
                        <p>This page intentionally left blank.</p>
                      </div>
                    </article>
                  );
                }
                const pagePanels = panelEntriesForPage(displayDocument, page.id, spreadLeftIdByRightId);
                const pageRows = LAYOUT_PAGE_ROWS;
                return (
                  <article
                    key={`${page.id}-${pageIndex}`}
                    className={`story-panels-page is-spread-slot is-spread-slot-${spreadSlot}`}
                  >
                    <div
                      ref={(element) => {
                        pageRefs.current[page.id] = element;
                      }}
                      className="story-panels-page-grid"
                      style={{ gridTemplateRows: `repeat(${pageRows}, minmax(22px, 1fr))` }}
                      onClick={handlePageBackgroundClick}
                      onContextMenu={(event) => openPageMenu(event, page.id)}
                      onPointerMove={continueDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                    >
                      {pagePanels.map(({ panel, offsetColumns }) => (
                        <div
                          key={`${panel.id}-${offsetColumns}`}
                          role="presentation"
                          className={`story-panels-page-panel is-${panel.panelKind} ${isCaption(panel) ? 'is-caption' : ''} ${captionPanelClassName(panel)} ${panel.panelKind === 'image' && panel.activeAssetId ? 'has-image' : ''} ${cropModePanelId === panel.id ? 'is-crop-mode' : ''} ${selectedPanelId === panel.id ? 'is-selected' : ''} ${flashingPanelId === panel.id ? 'is-flashing' : ''} ${dragState?.panelId === panel.id && dragState.activated ? 'is-dragging' : ''}`}
                          style={{
                            ...panelPositionStyle(panel, pageRows, offsetColumns),
                            ...(panel.panelKind === 'text' ? panelCanvasTextStyle(
                              panel,
                              selectedPanelId,
                              fontSizeInput,
                            ) : {}),
                          }}
                          onClick={() => onSelectPanel(panel.id)}
                          onDoubleClick={(event) => openPanelDetail(event, panel)}
                          onContextMenu={(event) => openPanelMenu(event, panel)}
                          onPointerDown={(event) => {
                            if ((event.target as HTMLElement).closest('.story-panels-page-panel-crop-layer')) return;
                            beginDrag(event, panel, 'move');
                          }}
                        >
                          {panel.panelKind === 'text' ? (
                            <span
                              className="story-panels-page-panel-rich-text"
                              dangerouslySetInnerHTML={{ __html: sanitizeRichText(richTextForPanel(panel, panel.id === selectedPanelId ? visibleTextDraft : null)) }}
                            />
                          ) : renderImagePanelBody(panel, cropModePanelId === panel.id)}
                          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                            <span
                              key={corner}
                              className={`story-panels-resize-handle is-${corner}`}
                              aria-hidden="true"
                              onPointerDown={(event) => beginDrag(event, panel, 'resize', corner)}
                            />
                          ))}
                        </div>
                      ))}
                      {renderCaptionTails(pagePanels, true)}
                      {renderSnapGuides(page.id)}
                    </div>
                  </article>
                );
              })}
              {visiblePages.map((page, pageIndex) => {
                const pageNumber = page ? storyPageNumberById.get(page.id) : undefined;
                if (!page || !pageNumber) return null;
                return (
                  <span
                    key={`${page.id}-spread-page-number`}
                    className={`story-panels-print-page-number is-spread-slot-${pageIndex === 0 ? 'left' : 'right'}`}
                  >
                    {pageNumber}
                  </span>
                );
              })}
              {visiblePages.length > 1 && <div className="story-panels-print-gutter" aria-hidden="true" />}
              </div>
            </div>
          ) : (
            visiblePages.map((page, pageIndex) => {
          if (!page) {
            return (
            <article
              key="intentional-blank-start"
              className={`story-panels-page is-blank ${layoutMode === 'all-pages' && selectedPageId === null ? 'is-page-selected' : ''}`}
            >
                <h3>Intentionally Blank</h3>
                {renderSinglePagePreviewFrame(
                  null,
                  clampedPageIndex,
                  <div
                    className="story-panels-page-grid story-panels-blank-page"
                    style={layoutMode === 'all-pages' ? { aspectRatio: comicPageAspectRatio } : undefined}
                  >
                    <p>This page intentionally left blank.</p>
                  </div>,
                )}
              </article>
            );
          }
          const pagePanels = panelEntriesForPage(displayDocument, page.id, spreadLeftIdByRightId);
          const pageRows = LAYOUT_PAGE_ROWS;
          return (
            <article
              key={`${page.id}-${pageIndex}`}
              className={`story-panels-page ${layoutMode === 'all-pages' && selectedPageId === page.id ? 'is-page-selected' : ''}`}
              onClick={() => setSelectedPageId(page.id)}
              onDoubleClick={layoutMode === 'all-pages' ? () => openPageDetail(page.id) : undefined}
            >
              <h3>{page.title || page.id} <span>{pageKindLabel(page.pageKind)}</span></h3>
              {renderSinglePagePreviewFrame(
                page,
                pageIndex,
                <div
                  ref={(element) => {
                    pageRefs.current[page.id] = element;
                  }}
                  className="story-panels-page-grid"
                  style={{
                    ...(layoutMode === 'all-pages' ? { aspectRatio: comicPageAspectRatio } : {}),
                    gridTemplateRows: `repeat(${pageRows}, minmax(22px, 1fr))`,
                  }}
                  onClick={handlePageBackgroundClick}
                  onContextMenu={(event) => openPageMenu(event, page.id)}
                  onPointerMove={continueDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  {pagePanels.map(({ panel, offsetColumns }) => (
                    <div
                      key={`${panel.id}-${offsetColumns}`}
                      role="presentation"
                      className={`story-panels-page-panel is-${panel.panelKind} ${isCaption(panel) ? 'is-caption' : ''} ${captionPanelClassName(panel)} ${panel.panelKind === 'image' && panel.activeAssetId ? 'has-image' : ''} ${cropModePanelId === panel.id ? 'is-crop-mode' : ''} ${selectedPanelId === panel.id ? 'is-selected' : ''} ${flashingPanelId === panel.id ? 'is-flashing' : ''} ${dragState?.panelId === panel.id && dragState.activated ? 'is-dragging' : ''}`}
                      style={{
                        ...panelPositionStyle(panel, pageRows, offsetColumns),
                        ...(panel.panelKind === 'text' ? panelCanvasTextStyle(
                          panel,
                          selectedPanelId,
                          fontSizeInput,
                        ) : {}),
                      }}
                      onClick={layoutMode === 'all-pages' ? undefined : () => onSelectPanel(panel.id)}
                      onDoubleClick={(event) => openPanelDetail(event, panel)}
                      onContextMenu={(event) => openPanelMenu(event, panel)}
                      onPointerDown={layoutMode === 'all-pages' ? undefined : (event) => {
                        if ((event.target as HTMLElement).closest('.story-panels-page-panel-crop-layer')) return;
                        beginDrag(event, panel, 'move');
                      }}
                    >
                      {panel.panelKind === 'text' ? (
                        <span
                          className="story-panels-page-panel-rich-text"
                          dangerouslySetInnerHTML={{ __html: sanitizeRichText(richTextForPanel(panel, panel.id === selectedPanelId ? visibleTextDraft : null)) }}
                        />
                      ) : renderImagePanelBody(panel, layoutMode !== 'all-pages' && cropModePanelId === panel.id)}
                      {layoutMode !== 'all-pages' && (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                        <span
                          key={corner}
                          className={`story-panels-resize-handle is-${corner}`}
                          aria-hidden="true"
                          onPointerDown={(event) => beginDrag(event, panel, 'resize', corner)}
                        />
                      ))}
                    </div>
                  ))}
                  {renderCaptionTails(pagePanels, layoutMode !== 'all-pages')}
                  {renderSnapGuides(page.id)}
                </div>,
              )}
            </article>
          );
        })
          )
        ) : <p className="muted">No pages yet.</p>}
        </div>
        {showsSelectedPanelInfo && (
          <aside
            className="story-panels-info-panel is-docked"
            aria-label="Selected panel settings"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {visibleSelectedPanel ? (
              <>
                <div className="story-panels-info-head">
                  <h3>Selected Panel</h3>
                  <button
                    type="button"
                    className="danger"
                    disabled={isSaving}
                    aria-label={selectedPanelRemoveLabel}
                    title={layoutReadingChunkPanel ? 'Remove from layout (keeps panel in Panels)' : undefined}
                    onClick={requestDeleteSelectedPanel}
                  >
                    {selectedPanelRemoveLabel}
                  </button>
                </div>
                <div className="story-panels-info-panel-body" ref={infoPanelBodyRef}>
                <div className="story-panels-info-control">
                  <span>Panel ID</span>
                  <code>{(panelKindHost ?? visibleSelectedPanel).id}</code>
                </div>
                <div className="story-panels-info-control">
                  <label>
                    Panel name
                    <input
                      type="text"
                      value={panelKindHost?.title ?? visibleSelectedPanel.title}
                      placeholder={panelLabelFor(panelKindHost ?? visibleSelectedPanel)}
                      disabled={!panelKindHost}
                      onChange={(event) => {
                        if (panelKindHost) updatePanelById(panelKindHost.id, { title: event.target.value });
                      }}
                    />
                  </label>
                </div>
                {infoStoryPanel && (
                  <label>
                    {isBookLinked(infoStoryPanel)
                      ? `Story text (${infoStoryPanel.startOffset} to ${infoStoryPanel.endOffset})`
                      : 'Story text'}
                    <textarea
                      value={isBookLinked(infoStoryPanel) ? infoStoryPanel.selectedText : infoStoryPanel.storyText}
                      rows={5}
                      disabled={isBookLinked(infoStoryPanel)}
                      readOnly={isBookLinked(infoStoryPanel)}
                      onChange={(event) => {
                        if (!isBookLinked(infoStoryPanel)) updatePanelById(infoStoryPanel.id, { storyText: event.target.value });
                      }}
                    />
                  </label>
                )}
                {panelKindHost && (
                <div className="story-panels-info-control">
                  <span>Panel kind</span>
                  <div className="story-panels-kind-toggle" role="tablist" aria-label="Panel kind">
                    <button
                      type="button"
                      className={panelKindHost.panelKind === 'image' ? 'is-active' : ''}
                      role="tab"
                      aria-selected={panelKindHost.panelKind === 'image'}
                      disabled={isSaving}
                      onClick={() => updatePanelById(panelKindHost.id, { panelKind: 'image' })}
                    >
                      Image panel
                    </button>
                    <button
                      type="button"
                      className={panelKindHost.panelKind === 'text' ? 'is-active' : ''}
                      role="tab"
                      aria-selected={panelKindHost.panelKind === 'text'}
                      disabled={isSaving}
                      onClick={() => updatePanelById(panelKindHost.id, { panelKind: 'text' })}
                    >
                      Text / caption
                    </button>
                  </div>
                </div>
                )}
                {imageInfoHost?.panelKind === 'image' && (
                  <div className="story-panels-info-image-section">
                    <span>Image</span>
                    <div className="story-panels-info-image-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={isSaving}
                        onClick={() => setPickerPanelId(imageInfoHost.id)}
                      >
                        Choose image…
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={isSaving || !imageInfoHost.activeAssetId}
                        onClick={() => clearPanelImage(imageInfoHost.id)}
                      >
                        Clear image
                      </button>
                    </div>
                    <div className="story-panels-info-aspect-group">
                      <div className="story-panels-info-aspect-head">
                        <span>Ratio</span>
                        {imageInfoHost.aspectRatio && (
                          <span className="story-panels-info-aspect-current">
                            {imageInfoHost.aspectRatio}
                            {imageInfoHost.aspectRatioLocked ? ' · locked' : ''}
                          </span>
                        )}
                      </div>
                      <div className="story-panels-info-aspect-controls">
                        <button
                          type="button"
                          className="secondary"
                          disabled={isSaving || isSnappingAspect || !imageInfoHost.activeAssetId}
                          onClick={() => void snapSelectedPanelToImageRatio(imageInfoHost)}
                        >
                          {isSnappingAspect ? 'Snapping…' : 'Snap to image ratio'}
                        </button>
                        <button
                          type="button"
                          className={`secondary ${imageInfoHost.aspectRatioLocked ? 'is-active' : ''}`}
                          disabled={isSaving}
                          onClick={() => togglePanelAspectRatioLock(imageInfoHost)}
                        >
                          {imageInfoHost.aspectRatioLocked ? '🔓 ratio' : '🔒 ratio'}
                        </button>
                      </div>
                      <div className="story-panels-ratio-chips" role="group" aria-label="Image aspect ratios">
                        {GEMINI_IMAGE_ASPECT_RATIOS.map((ratio) => (
                          <button
                            key={ratio}
                            type="button"
                            className={imageInfoHost.aspectRatio === ratio ? 'is-active' : ''}
                            disabled={isSaving}
                            onClick={() => snapPanelToAspectRatio(imageInfoHost, ratio)}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                      <div className="story-panels-size-rows" role="group" aria-label="Panel size as page fraction">
                        <div className="story-panels-size-row">
                          <span>W</span>
                          {PAGE_SIZE_FRACTIONS.map((fraction) => (
                            <button
                              key={`w-${fraction.label}`}
                              type="button"
                              className={fractionMatchesGridSpan(imageInfoHost.rect.w, gridColumns, fraction) ? 'is-active' : ''}
                              disabled={isSaving}
                              onClick={() => snapPanelToPageSizeFraction(imageInfoHost, 'width', fraction)}
                            >
                              {fraction.label}
                            </button>
                          ))}
                        </div>
                        <div className="story-panels-size-row">
                          <span>H</span>
                          {PAGE_SIZE_FRACTIONS.map((fraction) => (
                            <button
                              key={`h-${fraction.label}`}
                              type="button"
                              className={fractionMatchesGridSpan(imageInfoHost.rect.h, LAYOUT_PAGE_ROWS, fraction) ? 'is-active' : ''}
                              disabled={isSaving}
                              onClick={() => snapPanelToPageSizeFraction(imageInfoHost, 'height', fraction)}
                            >
                              {fraction.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {imageInfoHost.activeAssetId && (
                      <div className="story-panels-info-crop-group">
                        <button
                          type="button"
                          className="secondary story-panels-info-crop-reset"
                          disabled={isSaving || !imageInfoHost.imageCrop || isDefaultImageCrop(imageInfoHost.imageCrop)}
                          onClick={() => resetPanelImageCrop(imageInfoHost.id)}
                        >
                          Reset Crop
                        </button>
                      </div>
                    )}
                    {imageInfoHost.assetIds.length > 1 && (
                      <div className="story-panels-info-image-variants moment-sequence-thumbs">
                        {nonArchivedVariants(assets, imageInfoHost.assetIds).map((asset) => (
                          <button
                            key={asset.id}
                            type="button"
                            className={`moment-sequence-thumb ${asset.id === imageInfoHost.activeAssetId ? 'is-active' : ''}`}
                            disabled={isSaving}
                            onClick={() => setPanelActiveAsset(imageInfoHost.id, asset.id)}
                          >
                            <img src={assetThumbnailUrl(projectSlug, asset)} alt="" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {captionHostPanel && (
                  <div className="story-panels-info-captions-group">
                    <button
                      type="button"
                      className="secondary"
                      disabled={isSaving}
                      onClick={() => addCaptionPanel(captionHostPanel)}
                    >
                      Add caption
                    </button>
                    {childCaptions.length === 0 ? (
                      <p className="muted">No captions yet. Add one to place linked text below this image on the layout.</p>
                    ) : (
                      <div className="story-panels-info-caption-list">
                        {childCaptions.map((caption, index) => (
                          <div
                            key={caption.id}
                            className={`story-panels-info-caption-entry ${visibleSelectedPanel?.id === caption.id ? 'is-selected' : ''}`}
                          >
                            <textarea
                              aria-label={captionLabel(index)}
                              value={captionTextDrafts[caption.id] ?? caption.visibleText}
                              rows={3}
                              onChange={(event) => {
                                setCaptionTextDrafts((current) => ({
                                  ...current,
                                  [caption.id]: event.target.value,
                                }));
                              }}
                              onBlur={() => commitCaptionTextDraft(caption.id)}
                              onKeyDown={(event) => event.stopPropagation()}
                            />
                            <div className="story-panels-info-caption-entry-actions">
                              <button
                                type="button"
                                className="story-panels-delete-caption-button"
                                disabled={isSaving}
                                aria-label={`Delete ${captionLabel(index)}`}
                                onClick={() => setPendingCaptionDeleteId(caption.id)}
                              >
                                <TrashIcon />
                              </button>
                              <div ref={captionStyleWrapRef} className="story-panels-info-caption-style-wrap">
                                <button
                                  type="button"
                                  className={`story-panels-caption-style-button ${captionStylePopoverId === caption.id ? 'is-active' : ''}`}
                                  disabled={isSaving}
                                  aria-label={`Style ${captionLabel(index)}`}
                                  aria-expanded={captionStylePopoverId === caption.id}
                                  onClick={() => setCaptionStylePopoverId((current) => (current === caption.id ? null : caption.id))}
                                >
                                  <StyleIcon />
                                </button>
                                {captionStylePopoverId === caption.id && (
                                  <div
                                    className="story-panels-caption-style-popover"
                                    role="dialog"
                                    aria-label={`${captionLabel(index)} appearance`}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <div className="story-panels-caption-style-field">
                                      <span>Type</span>
                                      <div className="story-panels-caption-style-options">
                                        <button
                                          type="button"
                                          className={captionSpeechKindFor(captionStyleForPanel(caption)) === 'dialogue' ? 'is-active' : ''}
                                          disabled={isSaving}
                                          onClick={() => setCaptionSpeechKind(caption.id, 'dialogue')}
                                        >
                                          Dialogue
                                        </button>
                                        <button
                                          type="button"
                                          className={captionSpeechKindFor(captionStyleForPanel(caption)) === 'narration' ? 'is-active' : ''}
                                          disabled={isSaving}
                                          onClick={() => setCaptionSpeechKind(caption.id, 'narration')}
                                        >
                                          Narration
                                        </button>
                                      </div>
                                    </div>
                                    {captionSpeechKindFor(captionStyleForPanel(caption)) === 'dialogue' && (
                                      <div className="story-panels-caption-style-field">
                                        <button
                                          type="button"
                                          className="secondary"
                                          disabled={isSaving}
                                          onClick={() => updatePanelById(caption.id, {
                                            tail: caption.tail ? null : defaultCaptionTail(caption.rect),
                                          })}
                                        >
                                          {caption.tail ? 'Remove tail' : 'Add tail'}
                                        </button>
                                      </div>
                                    )}
                                    <div className="story-panels-caption-style-field">
                                      <button
                                        type="button"
                                        className="secondary"
                                        disabled={isSaving}
                                        onClick={() => adjustCaptionTextSizeToFit(caption.id)}
                                      >
                                        Adjust text size to fit
                                      </button>
                                      <button
                                        type="button"
                                        className="secondary"
                                        disabled={isSaving}
                                        onClick={() => shrinkCaptionToFit(caption.id)}
                                      >
                                        Shrink height to fit text
                                      </button>
                                    </div>
                                    <div className="story-panels-caption-style-field">
                                      <span>Text color</span>
                                      <div className="story-panels-caption-color-presets">
                                        {CAPTION_COLOR_PRESETS.map((color) => (
                                          <button
                                            key={color}
                                            type="button"
                                            className={captionStyleForPanel(caption).color === color ? 'is-active' : ''}
                                            disabled={isSaving}
                                            aria-label={color}
                                            style={{ backgroundColor: color }}
                                            onClick={() => updateCaptionStyle(caption.id, { color })}
                                          />
                                        ))}
                                      </div>
                                      <label className="story-panels-caption-color-input">
                                        Custom
                                        <input
                                          type="color"
                                          value={captionStyleForPanel(caption).color ?? '#111827'}
                                          disabled={isSaving}
                                          onChange={(event) => updateCaptionStyle(caption.id, { color: event.target.value })}
                                        />
                                      </label>
                                    </div>
                                    {captionStyleForPanel(caption).background === 'transparent' && (
                                      <div className="story-panels-caption-style-field">
                                        <span>Outline color</span>
                                        <div className="story-panels-caption-color-presets">
                                          {CAPTION_COLOR_PRESETS.map((color) => (
                                            <button
                                              key={`outline-${color}`}
                                              type="button"
                                              className={captionStyleForPanel(caption).outlineColor === color ? 'is-active' : ''}
                                              disabled={isSaving}
                                              aria-label={color}
                                              style={{ backgroundColor: color }}
                                              onClick={() => updateCaptionStyle(caption.id, { outlineColor: color })}
                                            />
                                          ))}
                                        </div>
                                        <label className="story-panels-caption-color-input">
                                          Custom
                                          <input
                                            type="color"
                                            value={captionStyleForPanel(caption).outlineColor ?? '#ffffff'}
                                            disabled={isSaving}
                                            onChange={(event) => updateCaptionStyle(caption.id, { outlineColor: event.target.value })}
                                          />
                                        </label>
                                      </div>
                                    )}
                                    <div className="story-panels-caption-style-field">
                                      <label>
                                        Font
                                        <select
                                          value={captionStyleForPanel(caption).fontFamily}
                                          disabled={isSaving}
                                          onChange={(event) => updateCaptionStyle(caption.id, { fontFamily: event.target.value as StoryPanelTextStyle['fontFamily'] })}
                                        >
                                          <option value="serif">Serif</option>
                                          <option value="sans">Sans</option>
                                          <option value="mono">Mono</option>
                                          <option value="comic">Comic Sans</option>
                                        </select>
                                      </label>
                                      <label>
                                        Size
                                        <input
                                          type="number"
                                          min={6}
                                          max={48}
                                          value={
                                            captionFontSizeDraft?.captionId === caption.id
                                              ? captionFontSizeDraft.value
                                              : captionStyleForPanel(caption).fontSize
                                          }
                                          onChange={(event) => setCaptionFontSizeDraft({ captionId: caption.id, value: event.target.value })}
                                          onBlur={() => commitCaptionFontSizeInput(caption.id)}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter') event.currentTarget.blur();
                                          }}
                                        />
                                      </label>
                                      <label>
                                        Align
                                        <select
                                          value={captionStyleForPanel(caption).align}
                                          disabled={isSaving}
                                          onChange={(event) => updateCaptionStyle(caption.id, { align: event.target.value as StoryPanelTextStyle['align'] })}
                                        >
                                          <option value="left">Left</option>
                                          <option value="center">Center</option>
                                          <option value="right">Right</option>
                                        </select>
                                      </label>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {visibleSelectedPanel.panelKind === 'text' && !isCaption(visibleSelectedPanel) && (
                  <div className="story-panels-text-editor-panel">
                    <span>Caption text</span>
                    <div className="story-panels-text-style-row">
                      <label>
                        Font
                        <select
                          value={textStyleForPanel(visibleSelectedPanel).fontFamily}
                          disabled={isSaving}
                          onChange={(event) => updateSelectedPanelTextStyle({ fontFamily: event.target.value as StoryPanelTextStyle['fontFamily'] })}
                        >
                          <option value="serif">Serif</option>
                          <option value="sans">Sans</option>
                          <option value="mono">Mono</option>
                          <option value="comic">Comic Sans</option>
                        </select>
                      </label>
                      <label>
                        Size
                        <input
                          type="number"
                          min={6}
                          max={48}
                          value={fontSizeInput ?? textStyleForPanel(visibleSelectedPanel).fontSize}
                          onChange={(event) => setFontSizeInput(event.target.value)}
                          onBlur={commitFontSizeInput}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                        />
                      </label>
                      <label>
                        Align
                        <select
                          value={textStyleForPanel(visibleSelectedPanel).align}
                          disabled={isSaving}
                          onChange={(event) => updateSelectedPanelTextStyle({ align: event.target.value as StoryPanelTextStyle['align'] })}
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </label>
                    </div>
                    <div className="story-panels-rich-text-toolbar" aria-label="Text formatting">
                      <button type="button" className="secondary" disabled={isSaving} onMouseDown={(event) => event.preventDefault()} onClick={() => applyRichTextCommand('bold')}>Bold</button>
                      <button type="button" className="secondary" disabled={isSaving} onMouseDown={(event) => event.preventDefault()} onClick={() => applyRichTextCommand('italic')}>Italic</button>
                      <button type="button" className="secondary" disabled={isSaving} onMouseDown={(event) => event.preventDefault()} onClick={() => applyRichTextCommand('underline')}>Underline</button>
                    </div>
                    <div
                      ref={richTextEditorRef}
                      className="story-panels-rich-text-editor"
                      contentEditable
                      suppressContentEditableWarning
                      style={textPanelCssProperties(
                        visibleSelectedPanel,
                        textStyleOverrideFromFontSizeInput(visibleSelectedPanel, selectedPanelId, fontSizeInput),
                        'editor',
                      )}
                      onKeyDown={(event) => event.stopPropagation()}
                      onInput={(event) => setVisibleTextDraft(sanitizeRichText(event.currentTarget.innerHTML))}
                      onBlur={commitCustomTextDraft}
                    />
                  </div>
                )}
                </div>
              </>
            ) : (
              <p className="muted">Select a page panel to see its settings and source text.</p>
            )}
          </aside>
        )}
        </div>
      {layoutMode !== 'all-pages' && (
        <PageFilmstrip
          document={displayDocument}
          pages={pages}
          projectSlug={projectSlug}
          assetById={assetById}
          storyPageNumberById={storyPageNumberById}
          leftPageIdByRightPageId={spreadLeftIdByRightId}
          visiblePageIds={visiblePageIds}
          collapsed={filmstripCollapsed}
          disabled={isSaving}
          canDeleteStoryPage={storyPages.length > 1}
          onCollapsedChange={setFilmstripCollapsed}
          onSelectPage={jumpToPageId}
          onMovePage={movePageToTarget}
          onAddPageAfter={addPageAfterId}
          onRequestDeletePage={setPendingPageDeleteId}
        />
      )}
      {helpOpen && (
        <div className="confirm-backdrop" onClick={() => setHelpOpen(false)}>
          <div className="confirm-dialog story-panels-shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="story-panels-shortcuts-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="story-panels-shortcuts-title">Layout shortcuts</h2>
            <dl className="story-panels-shortcuts-list">
              {shortcutRows.map((row) => (
                <div key={row.keys}>
                  <dt><kbd>{row.keys}</kbd></dt>
                  <dd>{row.action}</dd>
                </div>
              ))}
            </dl>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setHelpOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {pageMenu && (
        <div ref={pageMenuRef} className="story-panels-page-context-menu" style={{ left: pageMenu.x, top: pageMenu.y }}>
          {pageMenu.kind === 'page' && (
            <>
              <button
                type="button"
                className="story-panels-page-context-menu-parent"
                aria-expanded={pageMenuSubmenu === 'create'}
                onClick={() => setPageMenuSubmenu((current) => (current === 'create' ? null : 'create'))}
              >
                Create panel
                <span aria-hidden="true">›</span>
              </button>
              {pageMenuSubmenu === 'create' && (
                <div className="story-panels-page-context-submenu">
                  <button type="button" disabled={!onCreatePanelAt} onClick={() => void createPanelAt(pageMenu.pageId, pageMenu.rect, 'image')}>Image panel</button>
                  <button type="button" disabled={!onCreatePanelAt} onClick={() => void createPanelAt(pageMenu.pageId, pageMenu.rect, 'text')}>Text panel</button>
                </div>
              )}
              <button
                type="button"
                className="story-panels-page-context-menu-parent"
                disabled={placeablePanels.length === 0 || !onPlacePanelAt}
                aria-expanded={pageMenuSubmenu === 'place'}
                onClick={() => setPageMenuSubmenu((current) => (current === 'place' ? null : 'place'))}
              >
                Place panel
                <span aria-hidden="true">›</span>
              </button>
              {pageMenuSubmenu === 'place' && (
                <div className="story-panels-page-context-submenu">
                  {quickPlacePanels.map((panel) => (
                    <button key={panel.id} type="button" disabled={!onPlacePanelAt} onClick={() => void placePanelAt(panel.id, pageMenu.pageId, pageMenu.rect)}>
                      {panelLabelFor(panel)}{sidebarPanelPreview(panel) ? ` - ${sidebarPanelPreview(panel)}` : ''}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setPlacementPickerTarget({ pageId: pageMenu.pageId, rect: pageMenu.rect });
                      setPageMenu(null);
                      setPageMenuSubmenu(null);
                    }}
                  >
                    See all...
                  </button>
                </div>
              )}
            </>
          )}
          {pageMenu.kind === 'panel' && (() => {
            const menuPanel = findPanelOrCaption(displayDocument, pageMenu.panelId);
            if (!menuPanel) return null;
            return (
              <>
                {menuPanel.panelKind === 'image' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setPickerPanelId(menuPanel.id);
                        setPageMenu(null);
                      }}
                    >
                      Choose image…
                    </button>
                    {menuPanel.activeAssetId && (
                      <>
                        <button
                          type="button"
                          className={cropModePanelId === menuPanel.id ? 'is-active' : ''}
                          onClick={() => {
                            onSelectPanel(menuPanel.id);
                            setCropModePanelId((current) => (current === menuPanel.id ? null : menuPanel.id));
                            setPageMenu(null);
                          }}
                        >
                          {cropModePanelId === menuPanel.id ? 'Done cropping' : 'Crop'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            clearPanelImage(menuPanel.id);
                            setPageMenu(null);
                          }}
                        >
                          Clear image
                        </button>
                      </>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setPendingPanelDeleteId(menuPanel.id);
                    setPageMenu(null);
                  }}
                >
                  Remove from layout
                </button>
              </>
            );
          })()}
        </div>
      )}
      {placementPickerTarget && (
        <div className="confirm-backdrop" onClick={() => setPlacementPickerTarget(null)}>
          <div className="confirm-dialog story-panels-placement-picker" role="dialog" aria-modal="true" aria-labelledby="story-panels-placement-picker-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="story-panels-placement-picker-title">Place panel here</h2>
            <p>Choose a panel to place at the clicked location.</p>
            <div className="story-panels-placement-picker-list">
              {placeablePanels.length === 0 ? (
                <p className="muted">No unplaced panels available.</p>
              ) : placeablePanels.map((panel) => (
                <button key={panel.id} type="button" disabled={isSaving || !onPlacePanelAt} onClick={() => void placePanelFromPicker(panel.id)}>
                  <span>{panelLabelFor(panel)}</span>
                  {sidebarPanelPreview(panel) && <small>{sidebarPanelPreview(panel)}</small>}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setPlacementPickerTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {pendingCaptionDelete && (
        <div className="confirm-backdrop" onClick={() => setPendingCaptionDeleteId(null)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-story-caption-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="delete-story-caption-title">Delete {panelLabelFor(pendingCaptionDelete)}?</h2>
            <p>This will remove the caption from the page layout.</p>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setPendingCaptionDeleteId(null)}>Cancel</button>
              <button type="button" className="danger" disabled={isSaving} onClick={confirmDeleteCaption}>Delete caption</button>
            </div>
          </div>
        </div>
      )}
      {pendingPanelDelete && (
        <div className="confirm-backdrop" onClick={() => setPendingPanelDeleteId(null)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-story-panel-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="delete-story-panel-title">
              {isCaption(pendingPanelDelete)
                ? `Delete ${panelLabelFor(pendingPanelDelete)}?`
                : 'Remove panel from layout?'}
            </h2>
            <p>
              {isPanel(pendingPanelDelete) && !isCaption(pendingPanelDelete)
                ? 'This removes the panel from the page layout. The panel stays in Panels and can be placed again.'
                : 'This will remove the layout item from the page.'}
            </p>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setPendingPanelDeleteId(null)}>Cancel</button>
              <button type="button" className="danger" disabled={isSaving} onClick={confirmRemoveSelectedPanel}>
                {isPanel(pendingPanelDelete) && !isCaption(pendingPanelDelete) ? 'Remove from layout' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingPageDelete && (
        <div className="confirm-backdrop" onClick={() => setPendingPageDeleteId(null)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-story-page-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="delete-story-page-title">Delete {pendingPageDelete.title || pendingPageDelete.id}?</h2>
            <p>
              This will remove the page
              {pendingPageDeletePanelCount > 0 ? ` and ${pendingPageDeletePanelCount} panel${pendingPageDeletePanelCount === 1 ? '' : 's'} on it` : ''}.
            </p>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setPendingPageDeleteId(null)}>Cancel</button>
              <button type="button" className="danger" disabled={isSaving} onClick={confirmDeleteSelectedPage}>Delete page</button>
            </div>
          </div>
        </div>
      )}
      {pickerPanelId && (() => {
        const pickerPanel = displayDocument.panels.find((panel) => panel.id === pickerPanelId);
        if (!pickerPanel || pickerPanel.panelKind !== 'image') return null;
        return (
          <PanelImagePicker
            projectSlug={projectSlug}
            panelLabel={panelLabelFor(pickerPanel)}
            assets={assets}
            projectTags={projectTags}
            canvas={canvas}
            currentActiveAssetId={pickerPanel.activeAssetId}
            onSelect={(assetId) => {
              assignPanelImage(pickerPanelId, assetId);
              setPickerPanelId(null);
            }}
            onClose={() => setPickerPanelId(null)}
          />
        );
      })()}
    </>
  );
}
