import type { StoryPanel, StoryPanelDocument, StoryPanelPage } from '../types';
import { panelKindHostFor } from './panelCaptions';
import { isBookmark, isPanel } from './panelModel';

export function panelIsPlacedOnLayout(pages: StoryPanelPage[], panel: Pick<StoryPanel, 'pageId' | 'sourceKind'>): boolean {
  if (!panel.pageId) return false;
  return panel.sourceKind === 'panel' && pages.some((page) => page.id === panel.pageId);
}

export function removeStoryPanelFromLayout(document: StoryPanelDocument, panelId: string): StoryPanelDocument {
  const childIds = new Set(
    document.panels.filter((panel) => panel.parentPanelId === panelId).map((panel) => panel.id),
  );
  return {
    ...document,
    panels: document.panels
      .filter((panel) => !childIds.has(panel.id))
      .map((panel) => (
        panel.id === panelId
          ? { ...panel, pageId: null }
          : panel
      )),
  };
}

export function isPanelChunkSourceKind(sourceKind: StoryPanel['sourceKind']): boolean {
  return sourceKind === 'panel';
}

/** Reading-list chunk whose layout placement should be cleared, not deleted. */
export function readingChunkPanelForLayoutAction(
  document: StoryPanelDocument,
  selectedPanel: StoryPanel | null,
): StoryPanel | null {
  const host = panelKindHostFor(document, selectedPanel);
  if (!host || !isPanel(host) || isBookmark(host)) return null;
  return host;
}
