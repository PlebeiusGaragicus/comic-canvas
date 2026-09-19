import type { CSSProperties } from 'react';
import type { StoryPanel, StoryPanelDocument } from '../types';
import { LAYOUT_GRID_COLUMNS } from './printLayout';
import { layoutPanels } from './panelModel';

/** How many layout columns a panel's rect lives in (24 when it spans a spread). */
export function panelLayoutColumns(panel: Pick<StoryPanel, 'spansSpread'>) {
  return panel.spansSpread ? LAYOUT_GRID_COLUMNS * 2 : LAYOUT_GRID_COLUMNS;
}

export type PagePanelEntry = { panel: StoryPanel; offsetColumns: number };

/** Panels rendered on a page: its own panels, plus spread-spanning panels
 * anchored on the spread's left page shown shifted by 12 columns. */
export function panelEntriesForPage(
  document: StoryPanelDocument,
  pageId: string,
  leftPageIdByRightPageId: Map<string, string>,
): PagePanelEntry[] {
  const partnerLeftId = leftPageIdByRightPageId.get(pageId) ?? null;
  return layoutPanels(document)
    .flatMap((panel): PagePanelEntry[] => {
      if (panel.pageId === pageId) return [{ panel, offsetColumns: 0 }];
      if (panel.spansSpread && partnerLeftId !== null && panel.pageId === partnerLeftId) {
        return [{ panel, offsetColumns: LAYOUT_GRID_COLUMNS }];
      }
      return [];
    })
    .sort((a, b) => a.panel.layer - b.panel.layer || a.panel.rect.y - b.panel.rect.y || a.panel.rect.x - b.panel.rect.x);
}

/** Absolute position of a panel inside a page grid (percentages of one page). */
export function panelPositionStyle(panel: StoryPanel, rows: number, offsetColumns = 0): CSSProperties {
  return {
    left: `${((panel.rect.x - offsetColumns) / LAYOUT_GRID_COLUMNS) * 100}%`,
    top: `${(panel.rect.y / rows) * 100}%`,
    width: `${(panel.rect.w / LAYOUT_GRID_COLUMNS) * 100}%`,
    height: `${(panel.rect.h / rows) * 100}%`,
    zIndex: panel.layer + 1,
  };
}
