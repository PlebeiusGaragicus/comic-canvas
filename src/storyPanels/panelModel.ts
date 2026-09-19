import type { StoryPanel, StoryPanelCaption, StoryPanelDocument } from '../types';

export function isPanel(panel: Pick<StoryPanel, 'sourceKind'>): boolean {
  return panel.sourceKind === 'panel';
}

export function isBookmark(panel: Pick<StoryPanel, 'sourceKind'>): boolean {
  return panel.sourceKind === 'bookmark';
}

export function isCaption(panel: Pick<StoryPanel, 'sourceKind' | 'parentPanelId'>): boolean {
  return isPanel(panel) && Boolean(panel.parentPanelId);
}

export function captionAsPanel(parent: StoryPanel, caption: StoryPanelCaption): StoryPanel {
  return {
    id: caption.id,
    order: parent.order,
    title: '',
    sourceKind: 'panel',
    startOffset: null,
    endOffset: null,
    selectedText: '',
    storyText: '',
    visibleText: caption.visibleText,
    richText: caption.richText,
    textStyle: caption.textStyle,
    pageId: parent.pageId,
    panelKind: 'text',
    spansSpread: parent.spansSpread,
    rect: caption.rect,
    tail: caption.tail ?? null,
    layer: caption.layer,
    parentPanelId: parent.id,
    assetIds: [],
    activeAssetId: null,
    aspectRatio: null,
    aspectRatioLocked: false,
    imageCrop: null,
    captions: [],
    imagePrompts: [],
    characterSlugs: [],
    locationSlug: null,
    finalized: false,
  };
}

export function panelCaptionItems(panel: StoryPanel): StoryPanel[] {
  if (!isPanel(panel) || panel.pageId == null) return [];
  return (panel.captions ?? []).map((caption) => captionAsPanel(panel, caption));
}

export function isBookLinked(panel: StoryPanel): panel is StoryPanel & { startOffset: number; endOffset: number } {
  return panel.startOffset !== null && panel.endOffset !== null;
}

export function isUnplaced(panel: StoryPanel): boolean {
  return isPanel(panel) && panel.parentPanelId == null && panel.pageId === null;
}

export function topLevelPanels(panels: StoryPanel[]) {
  return panels.filter((panel) => isPanel(panel) && panel.parentPanelId == null);
}

export function layoutPanels(document: StoryPanelDocument) {
  return document.panels.flatMap((panel) => {
    if (!isPanel(panel) || panel.pageId === null) return [];
    return [panel, ...panelCaptionItems(panel)];
  });
}
