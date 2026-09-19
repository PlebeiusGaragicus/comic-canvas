export type SinglePagePreviewMode = 'readable' | 'print';

export const SINGLE_PAGE_PREVIEW_MODE_KEY = 'story-panels-single-page-preview-mode';

export function readSinglePagePreviewMode(): SinglePagePreviewMode {
  try {
    const stored = localStorage.getItem(SINGLE_PAGE_PREVIEW_MODE_KEY);
    if (stored === 'readable' || stored === 'print') return stored;
  } catch {
    // Ignore storage read failures in private browsing or restricted contexts.
  }
  return 'print';
}

export function writeSinglePagePreviewMode(mode: SinglePagePreviewMode) {
  try {
    localStorage.setItem(SINGLE_PAGE_PREVIEW_MODE_KEY, mode);
  } catch {
    // Ignore storage write failures.
  }
}
