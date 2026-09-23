import type { StoryPanel } from '../types';
import { isBookLinked, isCaption } from './panelModel';

export type SidebarItemKind = 'panel' | 'bookmark';

export type SidebarFilter = 'all' | SidebarItemKind;

export const SIDEBAR_FILTER_OPTIONS: Array<{ id: SidebarFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'panel', label: 'Panels' },
  { id: 'bookmark', label: 'Bookmarks' },
];

export function isSidebarItem(panel: StoryPanel): panel is StoryPanel & { sourceKind: SidebarItemKind } {
  if (panel.sourceKind === 'bookmark') return true;
  return panel.sourceKind === 'panel' && !isCaption(panel);
}

export function sidebarItemLabel(kind: SidebarItemKind) {
  switch (kind) {
    case 'panel':
      return 'Panel';
    case 'bookmark':
      return 'Bookmark';
  }
}

export function sortSidebarItems(panels: StoryPanel[]) {
  return panels
    .filter(isSidebarItem)
    .sort((a, b) => (
      isBookLinked(a) && isBookLinked(b)
        ? a.startOffset - b.startOffset || a.order - b.order
        : a.order - b.order
    ));
}

export function filterSidebarItems(panels: StoryPanel[], filter: SidebarFilter) {
  const sorted = sortSidebarItems(panels);
  if (filter === 'all') return sorted;
  return sorted.filter((panel) => panel.sourceKind === filter);
}

export function sidebarItemPrimaryText(panel: StoryPanel) {
  if (panel.sourceKind === 'bookmark') return panel.title.trim() || panel.selectedText.trim();
  if (panel.title.trim()) return panel.title.trim();
  if (isBookLinked(panel)) return panel.storyText.trim() || panel.selectedText.trim();
  return panel.storyText || panel.selectedText;
}

export function manualPanelNumber(panels: StoryPanel[], panelId: string) {
  const index = sortSidebarItems(panels).findIndex((panel) => panel.id === panelId);
  return index >= 0 ? index + 1 : 0;
}

export function sidebarItemSecondaryText(panel: StoryPanel) {
  if (panel.sourceKind === 'panel' && panel.visibleText.trim()) {
    return panel.visibleText.trim();
  }
  if (panel.sourceKind === 'bookmark' && panel.title.trim() && panel.selectedText.trim() !== panel.title.trim()) {
    return panel.selectedText.trim();
  }
  return '';
}

export function bookAnchorPanels(panels: StoryPanel[]) {
  return panels.filter(
    (panel) => (panel.sourceKind === 'panel' || panel.sourceKind === 'bookmark') && isBookLinked(panel),
  );
}

export type InsertDraftPayload = {
  storyText: string;
  insertAfterPanelId: string | null;
};
