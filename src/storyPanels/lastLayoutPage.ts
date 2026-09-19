const LAST_LAYOUT_PAGE_KEY_PREFIX = 'story-panels-last-page:';

export function readLastLayoutPageId(projectSlug: string): string | null {
  try {
    return localStorage.getItem(`${LAST_LAYOUT_PAGE_KEY_PREFIX}${projectSlug}`);
  } catch {
    // Ignore storage read failures in private browsing or restricted contexts.
    return null;
  }
}

export function writeLastLayoutPageId(projectSlug: string, pageId: string) {
  try {
    localStorage.setItem(`${LAST_LAYOUT_PAGE_KEY_PREFIX}${projectSlug}`, pageId);
  } catch {
    // Ignore storage write failures.
  }
}
