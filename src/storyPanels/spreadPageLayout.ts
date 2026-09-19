import type { StoryPanelPage } from '../types';

export function interiorSpreadPages(pages: StoryPanelPage[]) {
  return pages.filter((page) => page.pageKind !== 'cover' && page.pageKind !== 'back-cover');
}

/** Right-page id per left page of each two-page spread (cover pairs with back cover). */
export function spreadRightPageIdByLeftPageId(pages: StoryPanelPage[]): Map<string, string> {
  const pairs = new Map<string, string>();
  const cover = pages.find((page) => page.pageKind === 'cover');
  const backCover = pages.find((page) => page.pageKind === 'back-cover');
  if (cover && backCover) pairs.set(cover.id, backCover.id);
  const interior = interiorSpreadPages(pages);
  for (let index = 0; index + 1 < interior.length; index += 2) {
    pairs.set(interior[index].id, interior[index + 1].id);
  }
  return pairs;
}

/** Inverse of spreadRightPageIdByLeftPageId. */
export function spreadLeftPageIdByRightPageId(pages: StoryPanelPage[]): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const [leftId, rightId] of spreadRightPageIdByLeftPageId(pages)) {
    pairs.set(rightId, leftId);
  }
  return pairs;
}

/** Left-page index within interiorSpreadPages for a spread containing this interior page. */
export function spreadInteriorStartIndex(interiorIndex: number): number {
  if (interiorIndex <= 0) return 0;
  return interiorIndex % 2 === 0 ? interiorIndex : interiorIndex - 1;
}

export function spreadAnchorInteriorIndexForPageId(
  pageId: string,
  interiorSpreadPages: StoryPanelPage[],
): number | null {
  const interiorIndex = interiorSpreadPages.findIndex((page) => page.id === pageId);
  if (interiorIndex < 0) return null;
  return spreadInteriorStartIndex(interiorIndex);
}

/** Pages-array index of the left page for the spread that contains pageId. */
export function spreadAnchorPageIndexForPageId(
  pageId: string,
  pages: StoryPanelPage[],
  spreadPages: StoryPanelPage[],
): number {
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) return 0;
  if (page.pageKind === 'cover' || page.pageKind === 'back-cover') return 0;
  const interiorStart = spreadAnchorInteriorIndexForPageId(pageId, spreadPages);
  if (interiorStart == null) {
    const pageIndex = pages.findIndex((candidate) => candidate.id === pageId);
    return pageIndex >= 0 ? pageIndex : 0;
  }
  const anchorPage = spreadPages[interiorStart];
  const anchorIndex = pages.findIndex((candidate) => candidate.id === anchorPage?.id);
  return anchorIndex >= 0 ? anchorIndex : 0;
}

export function spreadVisiblePages(
  anchorPageIndex: number,
  pages: StoryPanelPage[],
  coverPage: StoryPanelPage | null,
  backCoverPage: StoryPanelPage | null,
): (StoryPanelPage | null)[] {
  if (pages.length === 0) return [];
  if (anchorPageIndex === 0 && coverPage && backCoverPage) {
    return [coverPage, backCoverPage];
  }
  if (anchorPageIndex === 0) {
    return [null, coverPage ?? pages[0]].filter((page, index) => index === 0 || Boolean(page));
  }
  const spreadPages = interiorSpreadPages(pages);
  const anchorPage = pages[Math.min(Math.max(anchorPageIndex, 0), pages.length - 1)];
  const interiorIndex = spreadPages.findIndex((page) => page.id === anchorPage.id);
  if (interiorIndex < 0) {
    return [anchorPage, null];
  }
  const start = spreadInteriorStartIndex(interiorIndex);
  return [
    spreadPages[start] ?? null,
    spreadPages[start + 1] ?? null,
  ];
}

export function lastSpreadAnchorPageIndex(
  pages: StoryPanelPage[],
  spreadPages: StoryPanelPage[],
): number {
  if (spreadPages.length === 0) return 0;
  const lastInteriorSpreadStart = spreadPages.length <= 1
    ? 0
    : spreadPages.length % 2 === 0
      ? spreadPages.length - 2
      : spreadPages.length - 1;
  const anchorPage = spreadPages[lastInteriorSpreadStart];
  const anchorIndex = pages.findIndex((page) => page.id === anchorPage?.id);
  return anchorIndex >= 0 ? anchorIndex : 0;
}

export function nextSpreadAnchorPageIndex(
  anchorPageIndex: number,
  pages: StoryPanelPage[],
  spreadPages: StoryPanelPage[],
): number | null {
  if (anchorPageIndex === 0) {
    if (spreadPages.length === 0) return null;
    const firstInterior = spreadPages[0];
    const firstIndex = pages.findIndex((page) => page.id === firstInterior.id);
    return firstIndex >= 0 ? firstIndex : null;
  }
  const anchorPage = pages[anchorPageIndex];
  const interiorIndex = spreadPages.findIndex((page) => page.id === anchorPage?.id);
  if (interiorIndex < 0) return null;
  const nextInteriorStart = spreadInteriorStartIndex(interiorIndex) + 2;
  if (nextInteriorStart >= spreadPages.length) return null;
  const nextAnchor = spreadPages[nextInteriorStart];
  const nextIndex = pages.findIndex((page) => page.id === nextAnchor.id);
  return nextIndex >= 0 ? nextIndex : null;
}

export function previousSpreadAnchorPageIndex(
  anchorPageIndex: number,
  pages: StoryPanelPage[],
  spreadPages: StoryPanelPage[],
): number {
  if (anchorPageIndex <= 0) return 0;
  const anchorPage = pages[anchorPageIndex];
  const interiorIndex = spreadPages.findIndex((page) => page.id === anchorPage?.id);
  if (interiorIndex <= 0) return 0;
  const prevInteriorStart = spreadInteriorStartIndex(interiorIndex) - 2;
  if (prevInteriorStart < 0) return 0;
  const prevAnchor = spreadPages[prevInteriorStart];
  const prevIndex = pages.findIndex((page) => page.id === prevAnchor.id);
  return prevIndex >= 0 ? prevIndex : 0;
}
