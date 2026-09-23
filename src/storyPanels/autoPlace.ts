export const AUTO_PLACE_KEY = 'story-panels-auto-place';

export function readAutoPlaceEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_PLACE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeAutoPlaceEnabled(enabled: boolean) {
  try {
    localStorage.setItem(AUTO_PLACE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage write failures.
  }
}

/** Manual-story projects always auto-place the first panel; later panels follow the toggle. */
export function autoPlaceDraftPanel(sidebarPanelCount: number, autoPlaceEnabled: boolean): boolean {
  return sidebarPanelCount === 0 || autoPlaceEnabled;
}
