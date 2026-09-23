/** Shared helpers: timestamps and slugs. One copy of each (AGENTS.md). */

/** ISO-8601 UTC without fractional seconds, `Z` suffix (matches the old backend). */
export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function slugify(value: string, fallback = ''): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

export const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_RE = TAG_RE;
export const TAG_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidTagId(value: string): boolean {
  return TAG_RE.test(value);
}

export function clip(text: string, max: number, suffix = '…[+truncated]'): string {
  return text.length > max ? text.slice(0, max) + suffix : text;
}

/** Deep-clone plain JSON data (documents are plain objects). */
export function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

export function sortedCopy<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...items].sort(compare);
}
