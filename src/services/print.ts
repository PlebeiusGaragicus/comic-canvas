/** PDF booklet export (ported from api/story_panels_print.py, pdf-lib instead
 *  of reportlab). Landscape letter sheets, two book pages per side, saddle
 *  stitch imposition; the layout math is shared with the web layout editor. */
import {
  PDFDocument,
  StandardFonts,
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingRgbColor,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import type { StoryPanel, StoryPanelCaption, StoryPanelDocument, StoryPanelImageCrop, StoryPanelPage, StoryPanelTextStyle } from '../types';
import {
  LAYOUT_GRID_COLUMNS,
  LAYOUT_PAGE_ROWS,
  PRINT_BOTTOM_MARGIN,
  PRINT_HALF_WIDTH,
  PRINT_INNER_GUTTER,
  PRINT_OUTER_MARGIN,
  PRINT_SHEET_HEIGHT,
  PRINT_SHEET_WIDTH,
  PRINT_TOP_MARGIN,
  type BookletPageBorder,
} from '../storyPanels/printLayout';
import { spreadRightPageIdByLeftPageId } from '../storyPanels/spreadPageLayout';
import { speechTailGeometry, type SpeechTailGeometry } from '../storyPanels/speechTail';
import { DEFAULT_IMAGE_CROP, computeSourceCropBox } from '../storyPanels/panelImageCrop';
import { readBlobOrNull } from '../store/blobs';
import { imageDimensions, imageOps } from '../shared/images';
import { assetPngPath } from './assetBlobs';
import { readDocument } from './storyPanels';

export type PageBorder = BookletPageBorder;

export interface PrintPage {
  page: StoryPanelPage | null;
  /** Story-page number (story pages only). */
  number: number | null;
}

export interface ImposedSheet {
  frontLeft: PrintPage;
  frontRight: PrintPage;
  backLeft: PrintPage;
  backRight: PrintPage;
}

export interface RichTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

const BLANK: PrintPage = { page: null, number: null };

// --- page order and imposition (pure) ----------------------------------------------

function sortedPages(pages: StoryPanelPage[]): StoryPanelPage[] {
  return [...pages].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Reading-order pages with story pages numbered 1..n. */
export function storyPages(document: StoryPanelDocument): PrintPage[] {
  let storyNumber = 0;
  return sortedPages(document.pages).map((page) => {
    if (page.pageKind === 'story') {
      storyNumber += 1;
      return { page, number: storyNumber };
    }
    return { page, number: null };
  });
}

/** Pad to a multiple of four for saddle stitch; blanks go before the last
 *  page so the back cover stays at the final reading-order position. */
export function paddedBookletPages(pages: PrintPage[]): PrintPage[] {
  const padded = [...pages];
  while (padded.length === 0 || padded.length % 4 !== 0) {
    if (padded.length === 0) padded.push(BLANK);
    else padded.splice(padded.length - 1, 0, BLANK);
  }
  return padded;
}

/** Sheets as (front: right, left) / (back: left+1, right-1) pairs from the outside in. */
export function imposeBookletPages(pages: PrintPage[]): ImposedSheet[] {
  const padded = paddedBookletPages(pages);
  const sheets: ImposedSheet[] = [];
  let left = 0;
  let right = padded.length - 1;
  while (left < right) {
    sheets.push({ frontLeft: padded[right], frontRight: padded[left], backLeft: padded[left + 1], backRight: padded[right - 1] });
    left += 2;
    right -= 2;
  }
  return sheets;
}

export type PagePanelEntry = [StoryPanel, number];

/** Panels per page as (panel, column offset); spread-spanning panels appear
 *  on both pages of their spread (offset 0 on the left, 12 on the right). */
export function panelsByPage(document: StoryPanelDocument): Map<string, PagePanelEntry[]> {
  const rightByLeft = spreadRightPageIdByLeftPageId(sortedPages(document.pages));
  const panels = new Map<string, PagePanelEntry[]>();
  const push = (pageId: string, entry: PagePanelEntry) => {
    const list = panels.get(pageId);
    if (list) list.push(entry);
    else panels.set(pageId, [entry]);
  };
  for (const panel of document.panels) {
    if (panel.pageId === null) continue;
    push(panel.pageId, [panel, 0]);
    if (panel.spansSpread) {
      const partner = rightByLeft.get(panel.pageId);
      if (partner !== undefined) push(partner, [panel, LAYOUT_GRID_COLUMNS]);
    }
  }
  for (const entries of panels.values()) {
    entries.sort((a, b) => a[0].layer - b[0].layer || a[0].rect.y - b[0].rect.y || a[0].rect.x - b[0].rect.x || a[0].order - b[0].order);
  }
  return panels;
}

/** `(left, top, right, bottom)` source-pixel window; a null crop means centred at scale 1. */
export function sourceCropBox(crop: StoryPanelImageCrop | null | undefined, sourceW: number, sourceH: number, targetRatio: number): [number, number, number, number] {
  const box = computeSourceCropBox(crop ?? DEFAULT_IMAGE_CROP, sourceW, sourceH, targetRatio);
  return [box.left, box.top, box.right, box.bottom];
}

/** CSS uses a fixed 1px text-shadow halo; 1 CSS px is 0.75pt in print. */
export function captionOutlineOffsets(): Array<[number, number]> {
  const offset = 0.75;
  return [
    [-offset, offset],
    [offset, offset],
    [-offset, -offset],
    [offset, -offset],
    [0, offset],
    [0, -offset],
    [-offset, 0],
    [offset, 0],
  ];
}

// --- rich text ----------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** The `strong|b`, `em|i`, `u`, `br|div|p` subset; `null` entries are line breaks. */
export function parseRichText(html: string): Array<RichTextRun | null> {
  const runs: Array<RichTextRun | null> = [];
  let bold = 0;
  let italic = 0;
  let underline = 0;
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let last = 0;
  const emitData = (data: string) => {
    if (!data) return;
    runs.push({ text: decodeEntities(data), bold: bold > 0, italic: italic > 0, underline: underline > 0 });
  };
  for (let match = tagRe.exec(html); match !== null; match = tagRe.exec(html)) {
    emitData(html.slice(last, match.index));
    last = match.index + match[0].length;
    const tag = match[1].toLowerCase();
    const closing = match[0].startsWith('</');
    if (tag === 'strong' || tag === 'b') bold = closing ? Math.max(0, bold - 1) : bold + 1;
    else if (tag === 'em' || tag === 'i') italic = closing ? Math.max(0, italic - 1) : italic + 1;
    else if (tag === 'u') underline = closing ? Math.max(0, underline - 1) : underline + 1;
    else if (tag === 'br') {
      if (!closing) runs.push(null);
    } else if (tag === 'div' || tag === 'p') runs.push(null);
  }
  emitData(html.slice(last));
  return runs.length ? runs : [{ text: '', bold: false, italic: false, underline: false }];
}

export function plainTextToRichText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

/** Greedy word wrap of rich-text runs into lines that fit `width` at `size`. */
export function wrapRichText(runs: Array<RichTextRun | null>, width: number, measure: (run: RichTextRun, text: string) => number): RichTextRun[][] {
  const lines: RichTextRun[][] = [];
  let current: RichTextRun[] = [];
  let currentWidth = 0;
  const pushLine = () => {
    lines.push(current);
    current = [];
    currentWidth = 0;
  };
  for (const run of runs) {
    if (run === null) {
      if (current.length) pushLine();
      else lines.push([]);
      continue;
    }
    for (const token of run.text.split(' ')) {
      if (token === '' && current.length) continue;
      let prefix = current.length ? ' ' : '';
      let tokenWidth = measure(run, prefix + token);
      if (current.length && currentWidth + tokenWidth > width) {
        pushLine();
        prefix = '';
        tokenWidth = measure(run, token);
      }
      current.push({ ...run, text: prefix + token });
      currentWidth += tokenWidth;
    }
  }
  if (current.length) pushLine();
  return lines;
}

// --- fonts and colours --------------------------------------------------------------

type FontFamily = StoryPanelTextStyle['fontFamily'];

/** Standard-14 face for a family/weight/slant (`comic` falls back to Helvetica). */
export function fontName(fontFamily: FontFamily, bold = false, italic = false): StandardFonts {
  if (fontFamily === 'serif') {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (fontFamily === 'mono') {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

export function hexColor(hex: string): RGB {
  const value = hex.replace('#', '');
  return rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
}

const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);
const LIGHT_GREY = rgb(0.827, 0.827, 0.827);
const PANEL_BORDER = hexColor('#cbd5e1');
const IMAGE_BORDER = hexColor('#0f172a');
const PLACEHOLDER_FILL = hexColor('#dbeafe');
const PLACEHOLDER_BORDER = hexColor('#2563eb');
const PAGE_NUMBER = hexColor('#475569');
const BLANK_TEXT = hexColor('#64748b');
const DEFAULT_TEXT = hexColor('#111827');

class Fonts {
  private readonly cache = new Map<StandardFonts, PDFFont>();
  private readonly charsets = new Map<StandardFonts, Set<number>>();

  constructor(private readonly pdf: PDFDocument) {}

  async get(name: StandardFonts): Promise<PDFFont> {
    let font = this.cache.get(name);
    if (!font) {
      font = await this.pdf.embedFont(name);
      this.cache.set(name, font);
      this.charsets.set(name, new Set(font.getCharacterSet()));
    }
    return font;
  }

  /** Standard fonts only cover WinAnsi; unencodable characters are dropped. */
  sanitize(name: StandardFonts, text: string): string {
    const charset = this.charsets.get(name);
    if (!charset) return text;
    let out = '';
    for (const char of text) {
      if (charset.has(char.codePointAt(0) ?? -1)) out += char;
    }
    return out;
  }
}

// --- drawing primitives -------------------------------------------------------------

function colorOps(fillColor: RGB | null, strokeColor: RGB | null): PDFOperator[] {
  const ops: PDFOperator[] = [];
  if (fillColor) ops.push(setFillingRgbColor(fillColor.red, fillColor.green, fillColor.blue));
  if (strokeColor) ops.push(setStrokingRgbColor(strokeColor.red, strokeColor.green, strokeColor.blue));
  return ops;
}

function paintOp(doFill: boolean, doStroke: boolean): PDFOperator {
  if (doFill && doStroke) return fillAndStroke();
  if (doFill) return fill();
  if (doStroke) return stroke();
  return endPath();
}

function drawRect(page: PDFPage, x: number, y: number, w: number, h: number, options: { fill?: RGB | null; stroke?: RGB | null; lineWidth?: number }): void {
  page.pushOperators(
    pushGraphicsState(),
    ...colorOps(options.fill ?? null, options.stroke ?? null),
    setLineWidth(options.lineWidth ?? 1),
    rectangle(x, y, w, h),
    paintOp(Boolean(options.fill), Boolean(options.stroke)),
    popGraphicsState(),
  );
}

const KAPPA = 0.5523;

/** reportlab's `roundRect`: radius clamped to half the shorter side. */
function roundRectOps(x: number, y: number, w: number, h: number, radius: number): PDFOperator[] {
  const r = Math.min(radius, w / 2, h / 2);
  const k = r * KAPPA;
  return [
    moveTo(x + r, y),
    lineTo(x + w - r, y),
    appendBezierCurve(x + w - r + k, y, x + w, y + r - k, x + w, y + r),
    lineTo(x + w, y + h - r),
    appendBezierCurve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h),
    lineTo(x + r, y + h),
    appendBezierCurve(x + r - k, y + h, x, y + h - r + k, x, y + h - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
    closePath(),
  ];
}

function drawRoundRect(page: PDFPage, x: number, y: number, w: number, h: number, radius: number, options: { fill?: RGB | null; stroke?: RGB | null; lineWidth?: number }): void {
  page.pushOperators(
    pushGraphicsState(),
    ...colorOps(options.fill ?? null, options.stroke ?? null),
    setLineWidth(options.lineWidth ?? 1),
    ...roundRectOps(x, y, w, h, radius),
    paintOp(Boolean(options.fill), Boolean(options.stroke)),
    popGraphicsState(),
  );
}

function drawLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number, color: RGB, lineWidth: number, dash?: [number, number]): void {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness: lineWidth, ...(dash ? { dashArray: [dash[0], dash[1]] } : {}) });
}

function beginClip(page: PDFPage, x: number, y: number, w: number, h: number): void {
  page.pushOperators(pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath());
}

function endClip(page: PDFPage): void {
  page.pushOperators(popGraphicsState());
}

// --- renderer -----------------------------------------------------------------------

interface RenderContext {
  slug: string;
  pdf: PDFDocument;
  fonts: Fonts;
  panelsByPage: Map<string, PagePanelEntry[]>;
  pageBorder: PageBorder;
  imageCache: Map<string, PDFImage | null>;
}

export interface RenderBookletOptions {
  pageBorder?: PageBorder;
}

export async function renderBookletPdf(slug: string, options: RenderBookletOptions = {}): Promise<Blob> {
  const document = await readDocument(slug);
  const pdf = await PDFDocument.create();
  const context: RenderContext = {
    slug,
    pdf,
    fonts: new Fonts(pdf),
    panelsByPage: panelsByPage(document),
    pageBorder: options.pageBorder ?? 'black',
    imageCache: new Map(),
  };
  for (const sheet of imposeBookletPages(storyPages(document))) {
    await drawSheetSide(context, sheet.frontLeft, sheet.frontRight);
    await drawSheetSide(context, sheet.backLeft, sheet.backRight);
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

async function drawSheetSide(context: RenderContext, leftPage: PrintPage, rightPage: PrintPage): Promise<void> {
  const page = context.pdf.addPage([PRINT_SHEET_WIDTH, PRINT_SHEET_HEIGHT]);
  drawRect(page, 0, 0, PRINT_SHEET_WIDTH, PRINT_SHEET_HEIGHT, { fill: WHITE });
  await drawComicPage(context, page, leftPage, 0, true);
  await drawComicPage(context, page, rightPage, PRINT_HALF_WIDTH, false);
  drawLine(page, PRINT_HALF_WIDTH, 0, PRINT_HALF_WIDTH, PRINT_SHEET_HEIGHT, LIGHT_GREY, 1, [3, 4]);
}

async function drawComicPage(context: RenderContext, page: PDFPage, printPage: PrintPage, originX: number, isLeft: boolean): Promise<void> {
  const innerMargin = isLeft ? PRINT_INNER_GUTTER : PRINT_OUTER_MARGIN;
  const outerMargin = isLeft ? PRINT_OUTER_MARGIN : PRINT_INNER_GUTTER;
  const pageX = originX + outerMargin;
  const pageY = PRINT_BOTTOM_MARGIN;
  const pageW = PRINT_HALF_WIDTH - outerMargin - innerMargin;
  const pageH = PRINT_SHEET_HEIGHT - PRINT_TOP_MARGIN - PRINT_BOTTOM_MARGIN;
  if (context.pageBorder === 'black') drawRect(page, pageX, pageY, pageW, pageH, { stroke: BLACK, lineWidth: 0.75 });
  else if (context.pageBorder === 'grey') drawRect(page, pageX, pageY, pageW, pageH, { stroke: PANEL_BORDER, lineWidth: 0.5 });
  if (printPage.page === null) {
    await drawBlankPage(context, page, pageX, pageY, pageW, pageH);
    return;
  }
  const rows = LAYOUT_PAGE_ROWS;
  for (const [panel, columnOffset] of context.panelsByPage.get(printPage.page.id) ?? []) {
    const clipped = Boolean(panel.spansSpread);
    if (clipped) beginClip(page, pageX, pageY, pageW, pageH);
    await drawPanel(context, page, panel, printPage.number, pageX, pageY, pageW, pageH, rows, columnOffset);
    const captions = [...panel.captions].sort((a, b) => a.layer - b.layer || a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id));
    for (const caption of captions) {
      await drawCaption(context, page, caption, pageX, pageY, pageW, pageH, rows, columnOffset);
    }
    if (clipped) endClip(page);
  }
  if (printPage.number !== null) {
    const font = await context.fonts.get(StandardFonts.Helvetica);
    const label = String(printPage.number);
    page.drawText(label, { x: pageX + pageW / 2 - font.widthOfTextAtSize(label, 7) / 2, y: pageY - 10, size: 7, font, color: PAGE_NUMBER });
  }
}

async function drawBlankPage(context: RenderContext, page: PDFPage, x: number, y: number, w: number, h: number): Promise<void> {
  const font = await context.fonts.get(StandardFonts.HelveticaOblique);
  const text = 'This page intentionally left blank.';
  page.drawText(text, { x: x + w / 2 - font.widthOfTextAtSize(text, 10) / 2, y: y + h / 2, size: 10, font, color: BLANK_TEXT });
}

function placeRect(rect: StoryPanel['rect'], pageX: number, pageY: number, pageW: number, pageH: number, rows: number, columnOffset: number) {
  const x = pageX + ((rect.x - columnOffset) / LAYOUT_GRID_COLUMNS) * pageW;
  const w = (rect.w / LAYOUT_GRID_COLUMNS) * pageW;
  const h = (rect.h / rows) * pageH;
  const y = pageY + pageH - (rect.y / rows) * pageH - h;
  return { x, y, w, h };
}

async function drawPanel(
  context: RenderContext,
  page: PDFPage,
  panel: StoryPanel,
  pageNumber: number | null,
  pageX: number,
  pageY: number,
  pageW: number,
  pageH: number,
  rows: number,
  columnOffset: number,
): Promise<void> {
  const { x, y, w, h } = placeRect(panel.rect, pageX, pageY, pageW, pageH, rows, columnOffset);
  if (panel.panelKind === 'text') {
    await drawTextPanel(context, page, panel, false, x, y, w, h, null);
    return;
  }
  await drawImagePanel(context, page, panel, pageNumber, x, y, w, h);
}

async function drawCaption(
  context: RenderContext,
  page: PDFPage,
  caption: StoryPanelCaption,
  pageX: number,
  pageY: number,
  pageW: number,
  pageH: number,
  rows: number,
  columnOffset: number,
): Promise<void> {
  const { x, y, w, h } = placeRect(caption.rect, pageX, pageY, pageW, pageH, rows, columnOffset);
  let tail: SpeechTailGeometry | null = null;
  const style = caption.textStyle;
  if (style.speechKind === 'dialogue' && style.background !== 'transparent' && caption.tail) {
    const tipX = pageX + ((caption.tail.x - columnOffset) / LAYOUT_GRID_COLUMNS) * pageW;
    const tipY = pageY + pageH - (caption.tail.y / rows) * pageH;
    tail = speechTailGeometry({ x, y, w, h }, { x: tipX, y: tipY });
  }
  await drawTextPanel(context, page, caption, true, x, y, w, h, tail);
}

async function drawTextPanel(
  context: RenderContext,
  page: PDFPage,
  panel: StoryPanel | StoryPanelCaption,
  isCaption: boolean,
  x: number,
  y: number,
  w: number,
  h: number,
  tail: SpeechTailGeometry | null,
): Promise<void> {
  const style = panel.textStyle;
  const transparent = isCaption && style.background === 'transparent';
  const radius = isCaption && style.speechKind === 'dialogue' ? Math.min(w, h) / 2 : 0;
  if (!transparent) {
    const paint = { fill: WHITE, stroke: PANEL_BORDER, lineWidth: 1 };
    if (radius > 0) drawRoundRect(page, x, y, w, h, radius, paint);
    else drawRect(page, x, y, w, h, paint);
  }
  if (tail) {
    // Borderless triangle opens the bubble throat; only the two side edges stroke.
    const [a, tip, b] = tail.fill;
    page.pushOperators(pushGraphicsState(), ...colorOps(WHITE, null), moveTo(a.x, a.y), lineTo(tip.x, tip.y), lineTo(b.x, b.y), closePath(), fill(), popGraphicsState());
    for (const [start, end] of tail.edges) drawLine(page, start.x, start.y, end.x, end.y, PANEL_BORDER, 0.75);
  }
  const selectedText = 'selectedText' in panel ? panel.selectedText : '';
  const visibleText = panel.visibleText || selectedText;
  const richText = panel.richText || plainTextToRichText(visibleText);
  const textColor = isCaption ? hexColor(style.color ?? '#111827') : BLACK;
  const outlineColor = transparent ? hexColor(style.outlineColor ?? '#ffffff') : null;
  await drawRichText(context, page, richText, x + 5, y + h - 8, w - 10, h - 10, {
    fontFamily: style.fontFamily,
    size: style.fontSize,
    align: style.align,
    color: textColor,
    outlineColor,
    outlineOffsets: outlineColor ? captionOutlineOffsets() : [],
  });
}

async function drawImagePanel(context: RenderContext, page: PDFPage, panel: StoryPanel, pageNumber: number | null, x: number, y: number, w: number, h: number): Promise<void> {
  const image = await croppedPanelImage(context, panel, w / h);
  if (image === null) {
    drawRect(page, x, y, w, h, { fill: PLACEHOLDER_FILL, stroke: PLACEHOLDER_BORDER, lineWidth: 1 });
    const label = `Page ${pageNumber ?? '?'} Panel`;
    const body = (panel.storyText || panel.selectedText).trim();
    await drawWrappedText(context, page, `${label}\n${body}`, x + 5, y + h - 12, w - 10, h - 10, 7);
    return;
  }
  page.drawImage(image, { x, y, width: w, height: h });
  drawRect(page, x, y, w, h, { stroke: IMAGE_BORDER, lineWidth: 1 });
}

/** The panel's active asset cropped to the panel's aspect ratio (null when the pixels are missing). */
async function croppedPanelImage(context: RenderContext, panel: StoryPanel, targetRatio: number): Promise<PDFImage | null> {
  const assetId = panel.activeAssetId;
  if (!assetId) return null;
  const source = await readBlobOrNull(assetPngPath(context.slug, assetId));
  if (source === null) return null;
  const { width, height } = await imageDimensions(source);
  const [left, top, right, bottom] = sourceCropBox(panel.imageCrop ?? null, width, height, targetRatio);
  const key = `${assetId}:${left},${top},${right},${bottom}`;
  const cached = context.imageCache.get(key);
  if (cached !== undefined) return cached;
  let image: PDFImage | null = null;
  try {
    const cropped = await imageOps.cropToPng(source, { left, top, right, bottom });
    image = await context.pdf.embedPng(await cropped.arrayBuffer());
  } catch (error) {
    console.error(`print: could not embed asset ${assetId}`, error);
  }
  context.imageCache.set(key, image);
  return image;
}

async function drawWrappedText(context: RenderContext, page: PDFPage, text: string, x: number, y: number, width: number, height: number, size: number): Promise<void> {
  const fontKey = StandardFonts.Helvetica;
  const font = await context.fonts.get(fontKey);
  const lineHeight = size * 1.25;
  const minY = y - height;
  let remainingY = y;
  const draw = (line: string) => page.drawText(context.fonts.sanitize(fontKey, line), { x, y: remainingY, size, font, color: IMAGE_BORDER });
  const measure = (value: string) => font.widthOfTextAtSize(context.fonts.sanitize(fontKey, value), size);
  const paragraphs = text.split(/\r?\n/);
  for (const paragraph of paragraphs.length ? paragraphs : ['']) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = `${line} ${word}`.trim();
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        draw(line);
        remainingY -= lineHeight;
      }
      line = word;
      if (remainingY < minY) return;
    }
    if (line && remainingY >= minY) {
      draw(line);
      remainingY -= lineHeight;
    }
    if (remainingY < minY) return;
  }
}

interface RichTextOptions {
  fontFamily: FontFamily;
  size: number;
  align: StoryPanelTextStyle['align'];
  color: RGB | null;
  outlineColor: RGB | null;
  outlineOffsets: Array<[number, number]>;
}

async function drawRichText(context: RenderContext, page: PDFPage, html: string, x: number, y: number, width: number, height: number, options: RichTextOptions): Promise<void> {
  const fillColor = options.color ?? DEFAULT_TEXT;
  const size = options.size;
  const lineHeight = size * 1.25;
  const fontFor = (run: RichTextRun) => fontName(options.fontFamily, run.bold, run.italic);
  // Embed every face up front so measuring can stay synchronous.
  const faces = new Map<StandardFonts, PDFFont>();
  for (const name of [fontName(options.fontFamily), fontName(options.fontFamily, true), fontName(options.fontFamily, false, true), fontName(options.fontFamily, true, true)]) {
    faces.set(name, await context.fonts.get(name));
  }
  const textFor = (run: RichTextRun, text = run.text) => context.fonts.sanitize(fontFor(run), text);
  const measure = (run: RichTextRun, text: string) => (faces.get(fontFor(run)) as PDFFont).widthOfTextAtSize(textFor(run, text), size);
  const lines = wrapRichText(parseRichText(html), width, measure);

  const minY = y - height;
  let remainingY = y;
  for (const line of lines) {
    if (remainingY < minY) return;
    const lineWidth = line.reduce((sum, run) => sum + measure(run, run.text), 0);
    let cursorX = x;
    if (options.align === 'center') cursorX = x + Math.max(0, (width - lineWidth) / 2);
    else if (options.align === 'right') cursorX = x + Math.max(0, width - lineWidth);
    const drawLineRuns = (offsetX: number, offsetY: number, color: RGB) => {
      let runX = cursorX + offsetX;
      for (const run of line) {
        const font = faces.get(fontFor(run)) as PDFFont;
        const text = textFor(run);
        if (text) page.drawText(text, { x: runX, y: remainingY + offsetY, size, font, color });
        runX += font.widthOfTextAtSize(text, size);
      }
    };
    if (options.outlineColor && options.outlineOffsets.length) {
      for (const [offsetX, offsetY] of options.outlineOffsets) drawLineRuns(offsetX, offsetY, options.outlineColor);
    }
    drawLineRuns(0, 0, fillColor);
    let underlineX = cursorX;
    for (const run of line) {
      const runWidth = measure(run, run.text);
      if (run.underline && run.text.trim()) {
        drawLine(page, underlineX, remainingY - 1.5, underlineX + runWidth, remainingY - 1.5, fillColor, 0.75);
      }
      underlineX += runWidth;
    }
    remainingY -= lineHeight;
  }
}
