import type { StoryPanelRect } from '../types';
import { LAYOUT_GRID_COLUMNS, LAYOUT_PAGE_ROWS } from './printLayout';

export type PageSizeFraction = {
  num: number;
  den: number;
  label: string;
};

export const PAGE_SIZE_FRACTIONS: PageSizeFraction[] = [
  { num: 1, den: 5, label: '1/5' },
  { num: 1, den: 4, label: '1/4' },
  { num: 1, den: 3, label: '1/3' },
  { num: 2, den: 5, label: '2/5' },
  { num: 1, den: 2, label: '1/2' },
  { num: 2, den: 3, label: '2/3' },
  { num: 1, den: 1, label: 'Full' },
];

export function gridSpanForPageFraction(
  pageUnits: number,
  fraction: PageSizeFraction,
): number {
  return (pageUnits * fraction.num) / fraction.den;
}

export function fractionMatchesGridSpan(
  span: number,
  pageUnits: number,
  fraction: PageSizeFraction,
  epsilon = 0.02,
): boolean {
  return Math.abs(span - gridSpanForPageFraction(pageUnits, fraction)) <= epsilon;
}

export function rectWithPageSizeFractions(
  rect: StoryPanelRect,
  options: { width?: PageSizeFraction; height?: PageSizeFraction },
): StoryPanelRect {
  return {
    ...rect,
    w: options.width
      ? gridSpanForPageFraction(LAYOUT_GRID_COLUMNS, options.width)
      : rect.w,
    h: options.height
      ? gridSpanForPageFraction(LAYOUT_PAGE_ROWS, options.height)
      : rect.h,
  };
}
