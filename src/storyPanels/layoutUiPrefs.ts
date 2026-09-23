/** Persisted visibility toggles for the layout editor chrome. */

function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Ignore storage read failures in private browsing or restricted contexts.
  }
  return fallback;
}

function writeBoolPref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Ignore storage write failures.
  }
}

const INSPECTOR_KEY = 'story-panels-inspector-visible';
const TRAY_KEY = 'story-panels-tray-visible';
const FILMSTRIP_KEY = 'story-panels-filmstrip-collapsed';

export const readInspectorVisible = () => readBoolPref(INSPECTOR_KEY, true);
export const writeInspectorVisible = (value: boolean) => writeBoolPref(INSPECTOR_KEY, value);

export const readPanelsTrayVisible = () => readBoolPref(TRAY_KEY, false);
export const writePanelsTrayVisible = (value: boolean) => writeBoolPref(TRAY_KEY, value);

export const readFilmstripCollapsed = () => readBoolPref(FILMSTRIP_KEY, false);
export const writeFilmstripCollapsed = (value: boolean) => writeBoolPref(FILMSTRIP_KEY, value);
