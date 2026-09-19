import type { VisualStyleDefinition } from '../types';

export function defaultVisualStyleId(styles: VisualStyleDefinition[]): string | null {
  const marked = styles.filter((style) => style.default);
  if (marked.length === 1) return marked[0].id;
  return styles[0]?.id ?? null;
}

export function resolveVisualStyleId(
  value: string | null | undefined,
  styles: VisualStyleDefinition[],
  fallbackId?: string | null,
): string | null {
  if (value && styles.some((style) => style.id === value)) return value;
  const defaultId = fallbackId ?? defaultVisualStyleId(styles);
  if (defaultId && styles.some((style) => style.id === defaultId)) return defaultId;
  return null;
}
