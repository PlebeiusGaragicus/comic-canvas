import { describe, expect, it } from 'vitest';
import {
  CHAT_WRAPPER_RE,
  DEFAULT_AUTO_PLACE_H,
  DEFAULT_AUTO_PLACE_W,
  appendImagePrompt,
  attachAssetsToPanel,
  autoPlacePanel,
  createBookmark,
  createPanel,
  deletePanel,
  draftPanelToCanvas,
  emptyDocument,
  listBackups,
  nextImagePromptId,
  nextPanelId,
  optionalBookText,
  patchPanel,
  readDocument,
  replaceImagePrompt,
  resetChunks,
  resetLayout,
  saveDocument,
  validateDocument,
  validatePanel,
  validatePanelEntities,
  validateRect,
} from './storyPanels';
import { createCharacter, createLocation, readMetadata, updateCharacter, updateLocation, writeMetadata } from './adaptation';
import { attachGeneratedAssetsToCanvas, readStoredCanvas } from './canvas';
import { readAsset } from './assets';
import { isServiceError } from './errors';
import { getProjectDoc, putProjectDoc } from '../store/db';
import { writeBlob } from '../store/blobs';
import { bookPath } from './adaptation';
import { LAYOUT_PAGE_ROWS } from '../storyPanels/printLayout';
import { FARM, importedDoc, seedAsset, seedProject } from '../test/fixtures';
import type { StoryPanel, StoryPanelDocument } from '../types';

async function seedBook(text: string): Promise<void> {
  await writeBlob(bookPath(FARM), text);
}

function panelWhere(document: StoryPanelDocument, predicate: (panel: StoryPanel) => boolean): StoryPanel {
  const panel = document.panels.find(predicate);
  if (!panel) throw new Error('panel not found');
  return panel;
}

function byId(document: StoryPanelDocument, id: string): StoryPanel {
  return panelWhere(document, (panel) => panel.id === id);
}

const DEFAULT_RECT = { x: 0, y: 0, w: DEFAULT_AUTO_PLACE_W, h: DEFAULT_AUTO_PLACE_H };

async function createExtractedCharacter(slug: string, variantKey?: string): Promise<void> {
  await createCharacter(FARM, { name: slug.replace(/-/g, ' '), slug, summary: `${slug} summary.` });
  const variants: Record<string, { prompt: string; label?: string; storyContext?: string }> = { base: { prompt: 'Character reference sheet for the hero.' } };
  if (variantKey) variants[variantKey] = { prompt: 'Variant sheet.', label: variantKey, storyContext: 'Later in the story.' };
  await updateCharacter(FARM, slug, { visualDescription: 'Visual details.', performanceNotes: 'Behaviour notes.', continuityNotes: 'Continuity.', variants });
}

async function createExtractedLocation(slug: string, prompt: string): Promise<void> {
  await createLocation(FARM, { name: slug, slug, summary: `${slug} summary.` });
  await updateLocation(FARM, slug, { visualDescription: 'Visual details.', continuityNotes: 'Continuity.', variants: { base: { prompt } } });
}

/** Create a panel plus canonical hero character and barn location; returns the panel id. */
async function seedPanelEntitiesProject(): Promise<string> {
  await seedBook('Alpha opens the barn door.\n');
  const created = await createPanel(FARM, { startOffset: 0, endOffset: 26, selectedText: 'Alpha opens the barn door.' });
  const panel = panelWhere(created, (item) => item.sourceKind === 'panel' && Boolean(item.selectedText));
  await createExtractedCharacter('hero');
  await createExtractedLocation('barn', 'Red barn establishing prompt.');
  return panel.id;
}

describe('story panel documents', () => {
  it('serves the fixed page frame with default text blocks and supports create/patch/save/delete', async () => {
    await seedProject();
    await seedBook('Alpha opens the door. Beta crosses the room. Gamma watches.\n');

    const empty = await readDocument(FARM);
    expect(empty.pages.map((page) => page.pageKind)).toEqual(['cover', 'inside-cover', 'story', 'story', 'story', 'story', 'inside-back-cover', 'back-cover']);
    expect(empty.pages.slice(2, 6).map((page) => page.id)).toEqual(['page-001', 'page-002', 'page-003', 'page-004']);
    expect(empty.pages.map((page) => page.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(empty.panels.map((panel) => [panel.pageId, panel.sourceKind, panel.panelKind, panel.visibleText, panel.storyText])).toEqual([
      ['cover', 'panel', 'text', 'Title goes here', ''],
      ['inside-front-cover', 'panel', 'text', 'Copyright information goes here.', ''],
      ['inside-back-cover', 'panel', 'text', 'About this comic, acknowledgements, or bonus notes go here.', ''],
    ]);
    expect(await optionalBookText(FARM)).toMatch(/^Alpha opens/);

    const created = await createPanel(FARM, { startOffset: 0, endOffset: 21, selectedText: 'Alpha opens the door.' });
    const alpha = panelWhere(created, (panel) => panel.sourceKind === 'panel' && panel.selectedText === 'Alpha opens the door.');
    expect(alpha.rect).toEqual(DEFAULT_RECT);
    expect(alpha.storyText).toBe('Alpha opens the door.');

    const unplaced = await createPanel(FARM, { startOffset: 22, endOffset: 44, selectedText: 'Beta crosses the room.', autoPlace: false });
    expect(panelWhere(unplaced, (panel) => panel.selectedText === 'Beta crosses the room.').pageId).toBeNull();

    await expect(createPanel(FARM, { startOffset: 6, endOffset: 25, selectedText: 'opens the door. Bet' })).rejects.toSatisfy(
      (error) => isServiceError(error, 'invalid') && /overlap/.test(error.message),
    );
    await expect(createPanel(FARM, { startOffset: 45, endOffset: 59, selectedText: 'Gamma watches!' })).rejects.toSatisfy(
      (error) => isServiceError(error, 'invalid') && /does not match/.test(error.message),
    );

    const patched = await patchPanel(FARM, alpha.id, { rect: { x: 0, y: 2, w: 6, h: 6 }, layer: 1, finalized: true });
    expect(byId(patched, alpha.id)).toMatchObject({ rect: { x: 0, y: 2, w: 6, h: 6 }, layer: 1, finalized: true });

    byId(patched, alpha.id).pageId = 'page-002';
    const saved = await saveDocument(FARM, patched);
    expect(byId(saved, alpha.id).pageId).toBe('page-002');

    const deleted = await deletePanel(FARM, alpha.id);
    expect(deleted.panels.some((panel) => panel.id === alpha.id)).toBe(false);
    expect(deleted.panels.some((panel) => panel.selectedText === 'Beta crosses the room.')).toBe(true);
    await expect(deletePanel(FARM, alpha.id)).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });

  it('does not re-seed a deleted fixed-page text block', async () => {
    await seedProject();
    const loaded = await readDocument(FARM);
    const copyright = panelWhere(loaded, (panel) => panel.pageId === 'inside-front-cover');
    const deleted = await deletePanel(FARM, copyright.id);
    expect(deleted.panels.some((panel) => panel.pageId === 'inside-front-cover')).toBe(false);
    const reloaded = await readDocument(FARM);
    expect(reloaded.panels.some((panel) => panel.pageId === 'inside-front-cover')).toBe(false);
  });

  it('re-slices selected text from the book on read and rejects mismatches', async () => {
    await seedProject();
    await seedBook('Alpha. Beta.\n');
    const created = await createPanel(FARM, { startOffset: 0, endOffset: 6 });
    const alpha = panelWhere(created, (panel) => panel.startOffset === 0);
    expect(alpha.selectedText).toBe('Alpha.');
    const stored = await getProjectDoc<StoryPanelDocument>('storyPanels', FARM);
    expect(stored).toBeDefined();
    const tampered = structuredClone(stored as StoryPanelDocument);
    byId(tampered, alpha.id).selectedText = 'Nope.';
    await putProjectDoc('storyPanels', FARM, tampered);
    await expect(readDocument(FARM)).rejects.toSatisfy((error) => isServiceError(error, 'invalid') && /does not match/.test(error.message));
    byId(tampered, alpha.id).selectedText = '';
    byId(tampered, alpha.id).endOffset = 999;
    await putProjectDoc('storyPanels', FARM, tampered);
    await expect(readDocument(FARM)).rejects.toSatisfy((error) => /exceeds book length/.test((error as Error).message));
  });

  it('works without a book: offsets are refused, drafts are fine', async () => {
    await seedProject();
    expect(await optionalBookText(FARM)).toBeNull();
    expect((await readDocument(FARM)).pages.length).toBe(8);
    await expect(createPanel(FARM, { startOffset: 0, endOffset: 5, selectedText: 'Alpha' })).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
    const draft = await createPanel(FARM, { storyText: 'A brave pony stepped into the sun.' });
    const last = draft.panels[draft.panels.length - 1];
    expect(last.sourceKind).toBe('panel');
    expect(last.storyText).toBe('A brave pony stepped into the sun.');
    await saveDocument(FARM, draft);
  });
});

describe('ordering and placement', () => {
  it('inserts drafts after a panel and shifts later orders', async () => {
    await seedProject();
    const first = panelWhere(await createPanel(FARM, { storyText: 'First panel.' }), (panel) => panel.storyText === 'First panel.');
    const second = panelWhere(await createPanel(FARM, { storyText: 'Second panel.' }), (panel) => panel.storyText === 'Second panel.');
    const inserted = await createPanel(FARM, { storyText: 'Between.', insertAfterPanelId: first.id });
    const between = panelWhere(inserted, (panel) => panel.storyText === 'Between.');
    const ordered = inserted.panels
      .filter((panel) => ['First panel.', 'Between.', 'Second panel.'].includes(panel.storyText))
      .sort((a, b) => a.order - b.order)
      .map((panel) => panel.storyText);
    expect(ordered).toEqual(['First panel.', 'Between.', 'Second panel.']);
    expect(between.order).toBe(first.order + 1);
    expect(byId(inserted, second.id).order).toBe(second.order + 1);
    await expect(createPanel(FARM, { storyText: 'x', insertAfterPanelId: 'panel-999' })).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });

  it('auto-places drafts in a 3x3 grid and overflows to the next story page', async () => {
    await seedProject();
    const unplaced = await createPanel(FARM, { storyText: 'First panel.', autoPlace: false });
    expect(panelWhere(unplaced, (panel) => panel.storyText === 'First panel.').pageId).toBeNull();

    const second = panelWhere(await createPanel(FARM, { storyText: 'Second panel.' }), (panel) => panel.storyText === 'Second panel.');
    expect(second.pageId).toBe('page-001');
    expect(second.rect).toEqual(DEFAULT_RECT);
    const third = panelWhere(await createPanel(FARM, { storyText: 'Third panel.' }), (panel) => panel.storyText === 'Third panel.');
    expect(third.rect).toEqual({ ...DEFAULT_RECT, x: DEFAULT_AUTO_PLACE_W });
    const fourth = panelWhere(await createPanel(FARM, { storyText: 'Fourth panel.' }), (panel) => panel.storyText === 'Fourth panel.');
    expect(fourth.rect).toEqual({ ...DEFAULT_RECT, x: DEFAULT_AUTO_PLACE_W * 2 });
    const fifth = panelWhere(await createPanel(FARM, { storyText: 'Fifth panel.' }), (panel) => panel.storyText === 'Fifth panel.');
    expect(fifth.rect).toEqual({ ...DEFAULT_RECT, y: DEFAULT_AUTO_PLACE_H });
    const sixth = panelWhere(await createPanel(FARM, { storyText: 'Sixth panel.' }), (panel) => panel.storyText === 'Sixth panel.');
    expect(sixth.rect.y).toBeCloseTo(DEFAULT_AUTO_PLACE_H);
    await createPanel(FARM, { storyText: 'Seventh panel.' });
    const eighth = panelWhere(await createPanel(FARM, { storyText: 'Eighth panel.' }), (panel) => panel.storyText === 'Eighth panel.');
    expect(eighth.rect.y).toBeCloseTo(DEFAULT_AUTO_PLACE_H * 2);
    expect(eighth.rect.y + eighth.rect.h).toBeCloseTo(LAYOUT_PAGE_ROWS);
    const ninth = panelWhere(await createPanel(FARM, { storyText: 'Ninth panel.' }), (panel) => panel.storyText === 'Ninth panel.');
    expect(ninth.pageId).toBe('page-001');
    expect(ninth.rect.x).toBeCloseTo(DEFAULT_AUTO_PLACE_W);
    const tenth = panelWhere(await createPanel(FARM, { storyText: 'Tenth panel.' }), (panel) => panel.storyText === 'Tenth panel.');
    expect(tenth.pageId).toBe('page-001');
    expect(tenth.rect.x).toBeCloseTo(DEFAULT_AUTO_PLACE_W * 2);
    expect(tenth.rect.y + tenth.rect.h).toBeCloseTo(LAYOUT_PAGE_ROWS);
    const eleventh = panelWhere(await createPanel(FARM, { storyText: 'Eleventh panel.' }), (panel) => panel.storyText === 'Eleventh panel.');
    expect(eleventh.pageId).toBe('page-002');
    expect(eleventh.rect).toEqual(DEFAULT_RECT);
  });

  it('appends a new story page when every story page is full', async () => {
    await seedProject();
    const document = await readDocument(FARM);
    document.pages = document.pages.filter((page) => page.pageKind !== 'story' || page.id === 'page-001');
    await saveDocument(FARM, document);
    for (let index = 0; index < 9; index += 1) await createPanel(FARM, { storyText: `Panel ${index}.` });
    const overflow = panelWhere(await createPanel(FARM, { storyText: 'Overflow.' }), (panel) => panel.storyText === 'Overflow.');
    expect(overflow.pageId).toBe('page-002');
    const pages = (await readDocument(FARM)).pages;
    expect(pages.map((page) => page.id)).toEqual(['cover', 'inside-front-cover', 'page-001', 'page-002', 'inside-back-cover', 'back-cover']);
    expect(pages.map((page) => page.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('auto-places an existing unplaced panel after its predecessor and refuses twice', async () => {
    await seedProject();
    const first = panelWhere(await createPanel(FARM, { storyText: 'First panel.' }), (panel) => panel.storyText === 'First panel.');
    expect(first.pageId).toBe('page-001');
    const second = panelWhere(await createPanel(FARM, { storyText: 'Second panel.', autoPlace: false }), (panel) => panel.storyText === 'Second panel.');
    expect(second.pageId).toBeNull();
    const placed = byId(await autoPlacePanel(FARM, second.id), second.id);
    expect(placed.pageId).toBe('page-001');
    expect(placed.rect).toEqual({ ...DEFAULT_RECT, x: DEFAULT_AUTO_PLACE_W });
    await expect(autoPlacePanel(FARM, second.id)).rejects.toSatisfy((error) => isServiceError(error, 'invalid') && /already placed/.test(error.message));
  });

  it('places book-linked panels next to their story neighbour', async () => {
    await seedProject();
    await seedBook('Alpha opens the door. Beta crosses the room. Gamma watches.\n');
    const first = await createPanel(FARM, { startOffset: 0, endOffset: 21, selectedText: 'Alpha opens the door.' });
    const alpha = panelWhere(first, (panel) => panel.selectedText === 'Alpha opens the door.');
    alpha.pageId = 'page-002';
    alpha.rect = { x: 0, y: 4, w: 6, h: 3 };
    await saveDocument(FARM, first);
    const second = await createPanel(FARM, { startOffset: 22, endOffset: 44, selectedText: 'Beta crosses the room.' });
    const beta = panelWhere(second, (panel) => panel.startOffset === 22);
    expect(beta.pageId).toBe('page-002');
    expect(beta.rect).toEqual({ x: 6, y: 4, w: DEFAULT_AUTO_PLACE_W, h: DEFAULT_AUTO_PLACE_H });
  });

  it('allows book-linked panels on front matter and unplacing via pageId null', async () => {
    await seedProject();
    await seedBook('Alpha opens the door.\n');
    const onCover = await createPanel(FARM, { startOffset: 0, endOffset: 21, selectedText: 'Alpha opens the door.', pageId: 'cover' });
    const panel = panelWhere(onCover, (item) => item.selectedText === 'Alpha opens the door.');
    expect(panel.pageId).toBe('cover');
    const unplaced = byId(await patchPanel(FARM, panel.id, { pageId: null }), panel.id);
    expect(unplaced.pageId).toBeNull();
    await expect(patchPanel(FARM, panel.id, { pageId: 'page-999' })).rejects.toSatisfy((error) => /Unknown page/.test((error as Error).message));
    await expect(createPanel(FARM, { storyText: 'x', pageId: 'page-999' })).rejects.toSatisfy((error) => /Unknown page/.test((error as Error).message));
  });
});

describe('resets and bookmarks', () => {
  it('reset-layout keeps chunks, drops placement and re-seeds the fixed pages', async () => {
    await seedProject();
    await seedBook('Alpha opens the door. Beta crosses the room.\n');
    const created = await createPanel(FARM, { startOffset: 0, endOffset: 21, selectedText: 'Alpha opens the door.' });
    const alphaId = panelWhere(created, (panel) => panel.selectedText === 'Alpha opens the door.').id;
    await patchPanel(FARM, alphaId, { rect: { x: 0, y: 2, w: 6, h: 6 }, layer: 1, finalized: true });
    const reset = await resetLayout(FARM);
    const alpha = byId(reset, alphaId);
    expect(alpha.selectedText).toBe('Alpha opens the door.');
    expect(alpha.pageId).toBeNull();
    expect(alpha.rect).toEqual(DEFAULT_RECT);
    expect(alpha.layer).toBe(0);
    expect(alpha.finalized).toBe(false);
    expect(reset.panels.some((panel) => panel.sourceKind === 'panel' && panel.pageId === 'cover')).toBe(true);
  });

  it('reset-chunks clears everything but keeps the fixed-page text blocks and writes a backup', async () => {
    await seedProject();
    await seedBook('Alpha opens the door.\n');
    await createPanel(FARM, { startOffset: 0, endOffset: 21, selectedText: 'Alpha opens the door.' });
    const reset = await resetChunks(FARM);
    expect(reset.panels.some((panel) => panel.sourceKind === 'bookmark')).toBe(false);
    expect(reset.panels.some((panel) => panel.selectedText === 'Alpha opens the door.')).toBe(false);
    expect(reset.panels.some((panel) => panel.sourceKind === 'panel' && panel.panelKind === 'text')).toBe(true);
    expect(Object.keys((await readStoredCanvas(FARM)).nodes).length).toBeGreaterThan(0);
    expect(await optionalBookText(FARM)).toBe('Alpha opens the door.\n');
    const backups = await listBackups(FARM);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^panels\.json\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
  });

  it('keeps only the newest three backups', async () => {
    await seedProject();
    await createPanel(FARM, { storyText: 'First.' });
    for (let index = 0; index < 5; index += 1) {
      await writeBlob(`projects/${FARM}/story-panels/panels.json.bak-2026-01-0${index + 1}T00-00-00Z`, '{}');
    }
    await resetChunks(FARM);
    const backups = await listBackups(FARM);
    expect(backups).toHaveLength(3);
    expect(backups.slice(0, 2)).toEqual(['panels.json.bak-2026-01-04T00-00-00Z', 'panels.json.bak-2026-01-05T00-00-00Z']);
    expect(backups[2]).toMatch(/^panels\.json\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
  });

  it('recovers an invalid stored document through either reset', async () => {
    await seedProject();
    const broken = { version: 1, panels: [{ id: 'bad', sourceKind: 'bad-kind' }] };
    await putProjectDoc('storyPanels', FARM, broken);
    await expect(readDocument(FARM)).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    await resetLayout(FARM);
    expect((await readDocument(FARM)).panels.some((panel) => panel.id === 'bad')).toBe(false);
    await putProjectDoc('storyPanels', FARM, broken);
    await resetChunks(FARM);
    expect((await readDocument(FARM)).pages.length).toBe(8);
  });

  it('creates bookmarks titled from the selection and inserts them after a panel', async () => {
    await seedProject();
    await seedBook('Chapter One\n\nThe air was warm.\n');
    const created = await createPanel(FARM, {
      startOffset: 13,
      endOffset: 30,
      selectedText: 'The air was warm.',
      imagePrompts: [{ id: 'prompt-001', text: 'Warm opening line.' }],
    });
    const story = panelWhere(created, (panel) => panel.selectedText === 'The air was warm.');
    expect(story.storyText).toBe('The air was warm.');
    expect(story.imagePrompts[0].text).toBe('Warm opening line.');
    await expect(createPanel(FARM, { startOffset: 13, endOffset: 20, selectedText: 'The air' })).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));

    const bookmark = panelWhere(await createBookmark(FARM, { startOffset: 0, endOffset: 11, selectedText: 'Chapter One' }), (panel) => panel.sourceKind === 'bookmark');
    expect(bookmark.title).toBe('Chapter One');
    expect(bookmark.pageId).toBeNull();
    expect(bookmark.panelKind).toBe('text');

    const inserted = await createBookmark(FARM, { startOffset: 13, endOffset: 30, insertAfterPanelId: story.id });
    const gamma = panelWhere(inserted, (panel) => panel.sourceKind === 'bookmark' && panel.startOffset === 13);
    expect(gamma.title).toBe('The air was warm.');
    expect(gamma.order).toBe(story.order + 1);
    expect(byId(inserted, bookmark.id).order).toBe(bookmark.order + 1);
    await expect(createBookmark(FARM, { startOffset: 0, endOffset: 999 })).rejects.toSatisfy((error) => /exceeds book length/.test((error as Error).message));
  });

  it('refuses bookmarks without a book', async () => {
    await seedProject();
    await expect(createBookmark(FARM, { startOffset: 0, endOffset: 3 })).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });
});

describe('images, captions and validation', () => {
  it('assigns assets, aspect ratio and crop; activeAssetId must be attached', async () => {
    await seedProject();
    await seedBook('Alpha opens the door.\n');
    await seedAsset(FARM, importedDoc('01HPANELIMG', { title: 'Panel art', tags: ['scene'] }));
    const created = await createPanel(FARM, { startOffset: 0, endOffset: 21, selectedText: 'Alpha opens the door.' });
    const panel = panelWhere(created, (item) => item.selectedText === 'Alpha opens the door.');
    const assigned = byId(await patchPanel(FARM, panel.id, { assetIds: ['01HPANELIMG'], activeAssetId: '01HPANELIMG' }), panel.id);
    expect(assigned.assetIds).toEqual(['01HPANELIMG']);
    expect(assigned.activeAssetId).toBe('01HPANELIMG');
    const ratio = byId(await patchPanel(FARM, panel.id, { aspectRatio: '16:9', aspectRatioLocked: true }), panel.id);
    expect(ratio).toMatchObject({ aspectRatio: '16:9', aspectRatioLocked: true });
    const crop = byId(await patchPanel(FARM, panel.id, { imageCrop: { focalX: 0.25, focalY: 0.75, scale: 2 } }), panel.id);
    expect(crop.imageCrop).toEqual({ focalX: 0.25, focalY: 0.75, scale: 2 });
    expect(() => validatePanel({ ...assigned, assetIds: [], activeAssetId: '01HPANELIMG' })).toThrow(/activeAssetId must be attached/);
    expect(() => validatePanel({ id: 'free', order: 0, sourceKind: 'bad-kind' })).toThrow(/sourceKind/);
  });

  it('attachAssetsToPanel merges, activates the newest, clears the crop and ignores unknown panels', async () => {
    await seedProject();
    const panel = panelWhere(await createPanel(FARM, { storyText: 'Draft.' }), (item) => item.storyText === 'Draft.');
    await patchPanel(FARM, panel.id, { assetIds: ['01HA'], activeAssetId: '01HA', imageCrop: { focalX: 0.1, focalY: 0.2, scale: 3 } });
    await attachAssetsToPanel(FARM, panel.id, ['01HB', '01HA']);
    const updated = byId(await readDocument(FARM), panel.id);
    expect(updated.assetIds).toEqual(['01HA', '01HB']);
    expect(updated.activeAssetId).toBe('01HB');
    expect(updated.imageCrop).toBeNull();
    await attachAssetsToPanel(FARM, 'panel-999', ['01HC']);
    await attachAssetsToPanel(FARM, panel.id, []);
    expect(byId(await readDocument(FARM), panel.id).assetIds).toEqual(['01HA', '01HB']);
  });

  it('stores captions on their parent with styled text', async () => {
    await seedProject();
    await seedBook('Alpha opens the door.\n');
    const created = await createPanel(FARM, { startOffset: 0, endOffset: 21, selectedText: 'Alpha opens the door.' });
    const parent = panelWhere(created, (item) => item.selectedText === 'Alpha opens the door.');
    const document = await patchPanel(FARM, parent.id, { pageId: parent.pageId, rect: parent.rect });
    (byId(document, parent.id) as unknown as Record<string, unknown>).captions = [
      {
        id: 'panel-caption-001',
        visibleText: 'Ponyville was busy.',
        richText: '',
        textStyle: { fontFamily: 'serif', fontSize: 7, align: 'center' },
        rect: { x: parent.rect.x, y: parent.rect.y + parent.rect.h + 0.25, w: parent.rect.w, h: 1 },
        layer: 1,
      },
    ];
    const saved = await saveDocument(FARM, document);
    const caption = byId(saved, parent.id).captions[0];
    expect(caption.visibleText).toBe('Ponyville was busy.');
    expect(caption.textStyle).toEqual({ fontFamily: 'serif', fontSize: 7, align: 'center', speechKind: 'dialogue', background: 'white', color: '#111827', outlineColor: '#ffffff' });
    byId(saved, parent.id).captions[0].textStyle = { fontFamily: 'sans', fontSize: 9, align: 'left', speechKind: 'narration', background: 'transparent', color: '#1e40af', outlineColor: '#eab308' };
    const styled = byId(await saveDocument(FARM, saved), parent.id).captions[0].textStyle;
    expect(styled).toMatchObject({ speechKind: 'narration', background: 'transparent', color: '#1e40af', outlineColor: '#eab308' });
    // Caption ids may not collide with panel ids; captions live on the parent, never top-level.
    byId(saved, parent.id).captions[0].id = parent.id;
    await expect(saveDocument(FARM, saved)).rejects.toSatisfy((error) => /Caption id duplicates panel id/.test((error as Error).message));
    expect(() => validatePanel({ id: 'panel-009', order: 0, parentPanelId: 'panel-001' })).toThrow(/Captions must be stored on their parent panel/);
  });

  it('enforces rect, spread and document invariants', () => {
    expect(() => validateRect({ x: 0, y: 8, w: 4, h: 3 })).toThrow(/page height grid/);
    const rect = validateRect({ x: 0, y: LAYOUT_PAGE_ROWS - 2, w: 4, h: 2 });
    expect(rect.y + rect.h).toBe(LAYOUT_PAGE_ROWS);
    expect(() => validateRect({ x: 20, y: 0, w: 8, h: 1 })).toThrow(/24-column spread grid/);
    expect(() => validatePanel({ id: 'panel-001', order: 0, rect: { x: 4, y: 0, w: 16, h: 4 } })).toThrow(/12-column page grid/);
    const spanning = validatePanel({ id: 'panel-001', order: 0, spansSpread: true, pageId: 'page-002', rect: { x: 4, y: 0, w: 16, h: 4 } });
    expect(spanning.rect.w).toBe(16);
    expect(() => validatePanel({ id: 'panel-001', order: 0, startOffset: 3 })).toThrow(/set together/);
    expect(() => validatePanel({ id: 'panel-001', order: 0, startOffset: 3, endOffset: 3 })).toThrow(/greater than startOffset/);
    expect(() => validatePanel({ id: 'panel-001', order: 0, sourceKind: 'bookmark' })).toThrow(/Bookmark items must have book offsets/);
    expect(() => validatePanel({ id: 'panel-001', order: 0, sourceKind: 'bookmark', startOffset: 0, endOffset: 1, pageId: 'cover' })).toThrow(/must not be placed/);
    const document = emptyDocument();
    expect(() => validateDocument({ ...document, pages: [...document.pages, document.pages[0]] })).toThrow(/Duplicate page ids/);
    expect(() => validateDocument({ ...document, panels: [...document.panels, document.panels[0]] })).toThrow(/Duplicate panel ids/);
    expect(() => validateDocument({ ...document, panels: [{ id: 'panel-x', order: 0, pageId: 'nowhere' }] })).toThrow(/unknown page/);
    expect(() =>
      validateDocument({
        ...document,
        panels: [
          { id: 'panel-a', order: 0, startOffset: 0, endOffset: 10 },
          { id: 'panel-b', order: 1, startOffset: 5, endOffset: 12 },
        ],
      }),
    ).toThrow(/Panel text ranges overlap: panel-a and panel-b/);
    // Bookmarks may overlap story panels.
    expect(() =>
      validateDocument({
        ...document,
        panels: [
          { id: 'panel-a', order: 0, startOffset: 0, endOffset: 10 },
          { id: 'panel-b', order: 1, sourceKind: 'bookmark', startOffset: 5, endOffset: 12 },
        ],
      }),
    ).not.toThrow();
  });

  it('allocates panel and prompt ids sequentially, counting captions', () => {
    const document = emptyDocument();
    expect(document.panels.map((panel) => panel.id)).toEqual(['panel-001', 'panel-002', 'panel-003']);
    expect(nextPanelId(document)).toBe('panel-004');
    document.panels[0].captions.push({ id: 'panel-004', visibleText: '', richText: '', textStyle: document.panels[0].textStyle, rect: { x: 0, y: 0, w: 1, h: 1 }, tail: null, layer: 0 });
    expect(nextPanelId(document)).toBe('panel-005');
    expect(nextImagePromptId([])).toBe('prompt-001');
    expect(nextImagePromptId([{ id: 'prompt-002', text: '' }])).toBe('prompt-003');
  });
});

describe('image prompts', () => {
  it('appends and replaces prompts and rejects chat wrappers', async () => {
    await seedProject();
    const panel = panelWhere(await createPanel(FARM, { storyText: 'Draft.' }), (item) => item.storyText === 'Draft.');
    const promptId = await appendImagePrompt(FARM, panel.id, '  A hero in a barn.  ');
    expect(promptId).toBe('prompt-001');
    expect(byId(await readDocument(FARM), panel.id).imagePrompts).toEqual([{ id: 'prompt-001', text: 'A hero in a barn.' }]);
    await replaceImagePrompt(FARM, panel.id, promptId, 'A hero at dusk.');
    expect(byId(await readDocument(FARM), panel.id).imagePrompts[0].text).toBe('A hero at dusk.');
    await expect(replaceImagePrompt(FARM, panel.id, 'prompt-009', 'x')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
    await expect(appendImagePrompt(FARM, 'panel-999', 'x')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
    await expect(appendImagePrompt(FARM, panel.id, '   ')).rejects.toSatisfy((error) => /must not be empty/.test((error as Error).message));
    for (const wrapped of ["Sure, here's the prompt.", 'Here is a prompt', '```\nprompt\n```', 'Plain start.\nDone.']) {
      expect(CHAT_WRAPPER_RE.test(wrapped)).toBe(true);
      await expect(appendImagePrompt(FARM, panel.id, wrapped)).rejects.toSatisfy((error) => /chat wrapper/.test((error as Error).message));
    }
    expect(CHAT_WRAPPER_RE.test('The hero stands, sure of himself.')).toBe(false);
  });
});

describe('panel entities', () => {
  it('validates character/location slugs (variant flat keys count) and persists them', async () => {
    await seedProject();
    const panelId = await seedPanelEntitiesProject();
    await expect(patchPanel(FARM, panelId, { characterSlugs: ['nobody'] })).rejects.toSatisfy(
      (error) => isServiceError(error, 'invalid') && /nobody/.test(error.message) && /Known characters: hero/.test(error.message),
    );
    await expect(patchPanel(FARM, panelId, { locationSlug: 'nowhere' })).rejects.toSatisfy((error) => isServiceError(error, 'invalid') && /Known locations: barn/.test(error.message));
    const panel = byId(await patchPanel(FARM, panelId, { characterSlugs: ['hero'], locationSlug: 'barn' }), panelId);
    expect(panel.characterSlugs).toEqual(['hero']);
    expect(panel.locationSlug).toBe('barn');

    await createExtractedCharacter('villain', 'older');
    await expect(validatePanelEntities(FARM, ['villain-older', 'hero'], 'barn')).resolves.toBeUndefined();
    await expect(validatePanelEntities(FARM, ['villain-young'], null)).rejects.toSatisfy((error) => /villain-older/.test((error as Error).message));
    await expect(validatePanelEntities(FARM, [], null)).resolves.toBeUndefined();

    await appendImagePrompt(FARM, panelId, 'Hero swings the barn door open.', { characterSlugs: ['hero', 'hero'], locationSlug: 'barn' });
    expect(byId(await readDocument(FARM), panelId).characterSlugs).toEqual(['hero']);
    await expect(appendImagePrompt(FARM, panelId, 'Someone unknown.', { characterSlugs: ['ghost'] })).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
  });

  it('draft-to-canvas blocks on missing refs, then creates a node whose results auto-attach', async () => {
    await seedProject();
    const panelId = await seedPanelEntitiesProject();
    const promptId = await appendImagePrompt(FARM, panelId, 'Hero swings the barn door open.', { characterSlugs: ['hero'], locationSlug: 'barn' });

    await expect(draftPanelToCanvas(FARM, panelId, promptId)).rejects.toSatisfy(
      (error) => isServiceError(error, 'conflict') && /Missing reference images/.test(error.message) && /hero/.test(error.message) && /barn/.test(error.message),
    );
    await expect(draftPanelToCanvas(FARM, panelId, 'prompt-099')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));

    const heroAsset = '01HHEROSHEET';
    const barnAsset = '01HBARNIMG';
    await seedAsset(FARM, importedDoc(heroAsset));
    await seedAsset(FARM, importedDoc(barnAsset));
    const metadata = await readMetadata(FARM);
    metadata.characters.hero.variants.base.assetIds = [heroAsset];
    metadata.characters.hero.variants.base.activeAssetId = heroAsset;
    metadata.locations.barn.variants.base.assetIds = [barnAsset];
    metadata.locations.barn.variants.base.activeAssetId = barnAsset;
    await writeMetadata(FARM, metadata);

    const drafted = await draftPanelToCanvas(FARM, panelId, promptId);
    const node = drafted.canvas.nodes[drafted.nodeId];
    expect(node.assetIds).toEqual([]);
    expect(node.origin).toEqual({ kind: 'panel', id: panelId });
    expect(node.refs).toEqual([heroAsset, barnAsset]);
    expect(node.prompt).toBe('Hero swings the barn door open.');
    expect(node.tags).toEqual(expect.arrayContaining(['comic-adaptation', 'story-panel', panelId, 'hero', 'barn']));
    expect(node.displayName).toBe(`Panel ${panelId}`);

    const generatedAsset = '01HPANELGEN';
    await seedAsset(FARM, importedDoc(generatedAsset, { title: 'Generated panel' }));
    const result = await attachGeneratedAssetsToCanvas(FARM, drafted.nodeId, [await readAsset(FARM, generatedAsset)]);
    expect(result.panelId).toBe(panelId);
    await attachAssetsToPanel(FARM, result.panelId as string, [generatedAsset]);
    const panel = byId(await readDocument(FARM), panelId);
    expect(panel.assetIds).toContain(generatedAsset);
    expect(panel.activeAssetId).toBe(generatedAsset);
  });
});
