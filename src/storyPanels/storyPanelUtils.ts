import type { StoryPanel } from '../types';

export function sortedPanels(panels: StoryPanel[]) {
  return [...panels].sort(
    (a, b) => (a.startOffset ?? Number.MAX_SAFE_INTEGER) - (b.startOffset ?? Number.MAX_SAFE_INTEGER) || a.order - b.order,
  );
}

export function withSelectedText(bookText: string, panel: StoryPanel): StoryPanel {
  if (panel.startOffset === null || panel.endOffset === null) return panel;
  return { ...panel, selectedText: bookText.slice(panel.startOffset, panel.endOffset) };
}

