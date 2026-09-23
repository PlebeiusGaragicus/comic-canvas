import type { StoryPanelPage } from '../types';

export function sortedStoryPages(pages: StoryPanelPage[]) {
  return pages
    .filter((page) => page.pageKind === 'story')
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function storyPageNumberById(pages: StoryPanelPage[]) {
  return new Map(sortedStoryPages(pages).map((page, index) => [page.id, index + 1]));
}

export function storyPagePlacementLabel(pages: StoryPanelPage[], pageId: string | null) {
  if (!pageId) return 'Not placed';
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) return 'Unknown page';
  const pageNumber = storyPageNumberById(pages).get(pageId);
  if (pageNumber) return `Page ${pageNumber}`;
  if (page.title.trim()) return page.title.trim();
  if (page.pageKind === 'cover') return 'Front cover';
  if (page.pageKind === 'inside-cover') return 'Inside front cover';
  if (page.pageKind === 'inside-back-cover') return 'Inside back cover';
  if (page.pageKind === 'back-cover') return 'Back cover';
  return page.id;
}
