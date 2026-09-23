/** Landscape letter sheet proportions mirrored from api/story_panels_print.py (in points). */
export const PRINT_SHEET_WIDTH = 792;
export const PRINT_SHEET_HEIGHT = 612;
export const PRINT_OUTER_MARGIN = 18;
export const PRINT_TOP_MARGIN = 18;
export const PRINT_BOTTOM_MARGIN = 18;
export const PRINT_INNER_GUTTER = 18;
export const PRINT_HALF_WIDTH = PRINT_SHEET_WIDTH / 2;
export const PRINT_PAGE_WIDTH = PRINT_HALF_WIDTH - PRINT_OUTER_MARGIN - PRINT_INNER_GUTTER;
export const PRINT_PAGE_HEIGHT = PRINT_SHEET_HEIGHT - PRINT_TOP_MARGIN - PRINT_BOTTOM_MARGIN;
/** Horizontal layout grid divisions for one printable page. */
export const LAYOUT_GRID_COLUMNS = 12;
/** Vertical layout grid divisions spanning the full printable page height. */
export const LAYOUT_PAGE_ROWS = 10;
export const PRINT_SHEET_ASPECT_RATIO = `${PRINT_SHEET_WIDTH} / ${PRINT_SHEET_HEIGHT}`;
export const PRINT_SHEET_GRID_COLUMNS = `${PRINT_OUTER_MARGIN}fr ${PRINT_PAGE_WIDTH}fr ${PRINT_INNER_GUTTER * 2}fr ${PRINT_PAGE_WIDTH}fr ${PRINT_OUTER_MARGIN}fr`;
export const PRINT_SHEET_GRID_ROWS = `${PRINT_TOP_MARGIN}fr ${PRINT_PAGE_HEIGHT}fr ${PRINT_BOTTOM_MARGIN}fr`;

export type BookletPageBorder = 'black' | 'grey' | 'none';

export const BOOKLET_PAGE_BORDER_OPTIONS: { value: BookletPageBorder; label: string }[] = [
  { value: 'black', label: 'Solid black' },
  { value: 'grey', label: 'Faint grey' },
  { value: 'none', label: 'No border' },
];
