import { afterEach, describe, expect, it } from 'vitest';
import {
  captionOutlineOffsets,
  fontName,
  imposeBookletPages,
  paddedBookletPages,
  panelsByPage,
  parseRichText,
  plainTextToRichText,
  renderBookletPdf,
  sourceCropBox,
  storyPages,
  wrapRichText,
  type PrintPage,
} from './print';
import { createPanel, emptyDocument, readDocument, saveDocument, validatePanel } from './storyPanels';
import { spreadRightPageIdByLeftPageId } from '../storyPanels/spreadPageLayout';
import { speechTailGeometry } from '../storyPanels/speechTail';
import { imageOps } from '../shared/images';
import { writeBlob } from '../store/blobs';
import { bookPath } from './adaptation';
import { FARM, importedDoc, seedAsset, seedProject } from '../test/fixtures';
import type { StoryPanel } from '../types';

// A real 1x1 PNG so pdf-lib can embed what the (stubbed) crop returns.
const ONE_PIXEL_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0));

const originalCrop = imageOps.cropToPng;

afterEach(() => {
  imageOps.cropToPng = originalCrop;
});

async function pdfHeader(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return String.fromCharCode(...bytes.slice(0, 4));
}

describe('page order and imposition', () => {
  it('numbers only story pages in reading order', () => {
    const pages = storyPages(emptyDocument());
    expect(pages.map((page) => page.number)).toEqual([null, null, 1, 2, 3, 4, null, null]);
    expect(pages[0].page?.pageKind).toBe('cover');
    expect(pages[7].page?.pageKind).toBe('back-cover');
  });

  it('pads before the last page and imposes outside-in (five-page case)', () => {
    const pages: PrintPage[] = [1, 2, 3, 4, 5].map((number) => ({ page: null, number }));
    expect(paddedBookletPages(pages).map((page) => page.number)).toEqual([1, 2, 3, 4, null, null, null, 5]);
    const sheets = imposeBookletPages(pages);
    expect(sheets).toHaveLength(2);
    expect([sheets[0].frontLeft.number, sheets[0].frontRight.number, sheets[0].backLeft.number, sheets[0].backRight.number]).toEqual([5, 1, 2, null]);
    expect([sheets[1].frontLeft.number, sheets[1].frontRight.number, sheets[1].backLeft.number, sheets[1].backRight.number]).toEqual([null, 3, 4, null]);
    expect(paddedBookletPages([])).toHaveLength(4);
  });

  it('keeps the back cover on the outside of the first sheet', () => {
    const pages = storyPages(emptyDocument());
    expect(pages).toHaveLength(8);
    const padded = paddedBookletPages(pages);
    expect(padded).toHaveLength(8);
    expect(padded[padded.length - 1].page?.pageKind).toBe('back-cover');
    expect(padded[0].page?.pageKind).toBe('cover');
    const outer = imposeBookletPages(pages)[0];
    expect(outer.frontRight.page?.pageKind).toBe('cover');
    expect(outer.frontLeft.page?.pageKind).toBe('back-cover');
  });

  it('pairs cover with back cover and draws spanning panels on both pages of a spread', () => {
    const spanning = validatePanel({ id: 'panel-001', order: 0, spansSpread: true, pageId: 'page-002', rect: { x: 4, y: 0, w: 16, h: 4 } });
    const document = emptyDocument();
    const pages = [...document.pages].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const interior = pages.filter((page) => page.pageKind !== 'cover' && page.pageKind !== 'back-cover');
    const pairs = spreadRightPageIdByLeftPageId(pages);
    expect(pairs.get('cover')).toBe('back-cover');
    expect(pairs.get(interior[0].id)).toBe(interior[1].id);

    document.panels = [{ ...spanning, pageId: interior[0].id }];
    const byPage = panelsByPage(document);
    expect(byPage.get(interior[0].id)?.map(([panel, offset]) => [panel.id, offset])).toEqual([['panel-001', 0]]);
    expect(byPage.get(interior[1].id)?.map(([panel, offset]) => [panel.id, offset])).toEqual([['panel-001', 12]]);
    // Panels sort by layer, then y, then x.
    const a = validatePanel({ id: 'panel-a', order: 5, pageId: 'page-001', layer: 1, rect: { x: 0, y: 0, w: 4, h: 4 } });
    const b = validatePanel({ id: 'panel-b', order: 6, pageId: 'page-001', layer: 0, rect: { x: 4, y: 2, w: 4, h: 4 } });
    const c = validatePanel({ id: 'panel-c', order: 7, pageId: 'page-001', layer: 0, rect: { x: 0, y: 2, w: 4, h: 4 } });
    document.panels = [a, b, c];
    expect(panelsByPage(document).get('page-001')?.map(([panel]) => panel.id)).toEqual(['panel-c', 'panel-b', 'panel-a']);
  });
});

describe('geometry helpers', () => {
  it('speech tails point at the tip from the bubble boundary', () => {
    expect(speechTailGeometry({ x: 0, y: 0, w: 120, h: 40 }, { x: 60, y: 20 })).toBeNull();
    const tail = speechTailGeometry({ x: 0, y: 0, w: 120, h: 40 }, { x: 60, y: -40 });
    expect(tail).not.toBeNull();
    const [fillA, tip, fillB] = tail!.fill;
    expect(tip).toEqual({ x: 60, y: -40 });
    expect(fillA.y).toBeGreaterThan(-5);
    expect(fillB.y).toBeGreaterThan(-5);
    for (const [start, end] of tail!.edges) {
      expect(end).toEqual({ x: 60, y: -40 });
      const nearest = Math.max(20, Math.min(100, start.x));
      expect(Math.abs(Math.hypot(start.x - nearest, start.y - 20) - 20)).toBeLessThan(0.5);
    }
  });

  it('crop box matches CSS object-position', () => {
    expect(sourceCropBox({ focalX: 0.25, focalY: 0.75, scale: 2 }, 1200, 800, 1)).toEqual([200, 300, 600, 700]);
    expect(sourceCropBox({ focalX: 0.5, focalY: 0.5, scale: 1 }, 1000, 800, 1)).toEqual([100, 0, 900, 800]);
    expect(sourceCropBox(null, 1000, 800, 1)).toEqual([100, 0, 900, 800]);
  });

  it('outline offsets mirror the 1px CSS halo at 0.75pt', () => {
    const offsets = captionOutlineOffsets();
    expect(offsets).toHaveLength(8);
    expect(new Set(offsets.map(([x, y]) => `${x},${y}`))).toEqual(
      new Set(['-0.75,0.75', '0.75,0.75', '-0.75,-0.75', '0.75,-0.75', '0,0.75', '0,-0.75', '-0.75,0', '0.75,0']),
    );
  });

  it('maps font families to standard-14 faces (comic falls back to Helvetica)', () => {
    expect(fontName('serif')).toBe('Times-Roman');
    expect(fontName('serif', true, true)).toBe('Times-BoldItalic');
    expect(fontName('mono', false, true)).toBe('Courier-Oblique');
    expect(fontName('sans', true)).toBe('Helvetica-Bold');
    expect(fontName('comic')).toBe('Helvetica');
    expect(fontName('comic', true, true)).toBe('Helvetica-BoldOblique');
  });
});

describe('rich text', () => {
  it('parses the strong/em/u/br subset with entity decoding', () => {
    const runs = parseRichText('<strong>Custom</strong> <em>caption</em><br><div>&amp;<u>text.</u></div>');
    expect(runs).toEqual([
      { text: 'Custom', bold: true, italic: false, underline: false },
      { text: ' ', bold: false, italic: false, underline: false },
      { text: 'caption', bold: false, italic: true, underline: false },
      null,
      null,
      { text: '&', bold: false, italic: false, underline: false },
      { text: 'text.', bold: false, italic: false, underline: true },
      null,
    ]);
    expect(parseRichText('')).toEqual([{ text: '', bold: false, italic: false, underline: false }]);
    expect(plainTextToRichText('a & b < c\nd')).toBe('a &amp; b &lt; c<br>d');
    expect(parseRichText(plainTextToRichText('a & b < c\nd')).map((run) => run?.text ?? null)).toEqual(['a & b < c', null, 'd']);
  });

  it('wraps greedily by word at the measured width', () => {
    const measure = (_run: unknown, text: string) => text.length * 10;
    const lines = wrapRichText(parseRichText('one two three<br>four'), 75, measure);
    expect(lines.map((line) => line.map((run) => run.text).join(''))).toEqual(['one two', 'three', 'four']);
    const styled = wrapRichText(parseRichText('<b>bold</b> plain'), 200, measure);
    expect(styled).toEqual([[{ text: 'bold', bold: true, italic: false, underline: false }, { text: ' plain', bold: false, italic: false, underline: false }]]);
    expect(wrapRichText([null, null], 100, measure)).toEqual([[], []]);
  });
});

describe('renderBookletPdf', () => {
  async function seedStoryBook(): Promise<void> {
    await seedProject();
    await writeBlob(bookPath(FARM), 'Alpha opens the door. Beta crosses the room. Gamma watches.\n');
  }

  it('renders a booklet with image, text, caption tail and spanning panels', async () => {
    imageOps.cropToPng = async () => new Blob([ONE_PIXEL_PNG], { type: 'image/png' });
    await seedStoryBook();
    await seedAsset(FARM, importedDoc('01HPANELIMG'));
    const created = await createPanel(FARM, { startOffset: 0, endOffset: 21, selectedText: 'Alpha opens the door.' });
    const image = created.panels.find((panel) => panel.selectedText === 'Alpha opens the door.') as StoryPanel;
    image.assetIds = ['01HPANELIMG'];
    image.activeAssetId = '01HPANELIMG';
    image.imageCrop = { focalX: 0.25, focalY: 0.75, scale: 2 };
    image.captions = [
      {
        id: 'caption-talk',
        visibleText: 'Hello there!',
        richText: '',
        textStyle: { fontFamily: 'comic', fontSize: 8, align: 'center', speechKind: 'dialogue', background: 'white', color: '#111827', outlineColor: '#ffffff' },
        rect: { x: 0, y: 4, w: 3, h: 1 },
        tail: { x: 1.5, y: 3 },
        layer: 1,
      },
      {
        id: 'caption-narration',
        visibleText: '',
        richText: '<strong>Custom</strong> <em>caption</em> <u>text.</u> Ünïcode ✓',
        textStyle: { fontFamily: 'sans', fontSize: 10, align: 'right', speechKind: 'narration', background: 'transparent', color: '#1e40af', outlineColor: '#eab308' },
        rect: { x: 0, y: 5.5, w: 4, h: 1 },
        tail: null,
        layer: 1,
      },
    ];
    const interior = created.pages.filter((page) => page.pageKind !== 'cover' && page.pageKind !== 'back-cover');
    created.panels.push(
      validatePanel({ id: 'panel-span', order: 99, pageId: interior[0].id, spansSpread: true, rect: { x: 2, y: 1, w: 20, h: 6 } }),
      validatePanel({ id: 'panel-missing', order: 100, pageId: 'page-003', assetIds: ['ghost'], activeAssetId: 'ghost', rect: { x: 0, y: 0, w: 6, h: 3 } }),
      validatePanel({ id: 'panel-text', order: 101, pageId: 'page-004', panelKind: 'text', richText: 'Mono <b>text</b>', textStyle: { fontFamily: 'mono', fontSize: 6, align: 'left' }, rect: { x: 0, y: 0, w: 6, h: 3 } }),
    );
    await saveDocument(FARM, created);
    expect((await readDocument(FARM)).panels.find((panel) => panel.id === image.id)?.captions[0].tail).toEqual({ x: 1.5, y: 3 });

    for (const pageBorder of ['black', 'grey', 'none'] as const) {
      const blob = await renderBookletPdf(FARM, { pageBorder });
      expect(blob.type).toBe('application/pdf');
      expect(await pdfHeader(blob)).toBe('%PDF');
    }
  });

  it('renders the empty document (eight pages, two sheets)', async () => {
    await seedProject();
    const blob = await renderBookletPdf(FARM);
    expect(await pdfHeader(blob)).toBe('%PDF');
    expect(blob.size).toBeGreaterThan(1000);
  });
});
