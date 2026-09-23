/** Resolves text the model quoted to book offsets. The fuzzy side names the
 *  words; this precise side finds them, tolerant of the ways a model reshapes
 *  a quote (case, straight vs. curly quotes, collapsed whitespace). */

export interface NormalizedText {
  text: string;
  /** map[i] is the original index of normalized character i. */
  map: number[];
}

const CHAR_MAP: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '-',
  '…': '...',
};

const OPENING_PUNCT = /["'‘“(\[]/;
const CLOSING_PUNCT = /[.!?,;:"'’”…)\]]/;

export function normalizeForMatch(source: string): NormalizedText {
  let text = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    const raw = source[index];
    if (/\s/.test(raw)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += ' ';
      map.push(index - 1);
      pendingSpace = false;
    }
    const mapped = CHAR_MAP[raw];
    const lowered = raw.toLowerCase();
    const out = mapped ?? (lowered.length === 1 ? lowered : raw);
    for (const ch of out) {
      text += ch;
      map.push(index);
    }
  }
  return { text, map };
}

/** First normalized index whose original position is at or after `original`. */
function normalizedIndexAtOrAfter(book: NormalizedText, original: number): number {
  let low = 0;
  let high = book.map.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (book.map[mid] < original) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Locate `quote` inside the book between original offsets [from, to). Returns
 *  original [start, end) or null when it is absent or falls outside the window. */
export function locateQuote(book: NormalizedText, quote: string, from: number, to: number): [number, number] | null {
  const needle = normalizeForMatch(quote).text;
  if (!needle) return null;
  const searchFrom = normalizedIndexAtOrAfter(book, from);
  const index = book.text.indexOf(needle, searchFrom);
  if (index < 0) return null;
  const start = book.map[index];
  const end = book.map[index + needle.length - 1] + 1;
  if (end > to) return null;
  return [start, end];
}

export interface ChunkRangeRequest {
  bookText: string;
  book: NormalizedText;
  /** The passage the task is allowed to chunk. */
  rangeStart: number;
  rangeEnd: number;
  /** Where the next panel starts unless `startText` says otherwise. */
  cursor: number;
  startText?: string | null;
  endText: string;
}

export class ChunkRangeError extends Error {}

/** Resolve one panel's [start, end) from the model's quoted boundaries. The
 *  start is the cursor (or the quoted opening words, searched from the cursor);
 *  the end is the quoted closing words, searched from the start. Both edges are
 *  widened over adjacent quotation marks and sentence punctuation so a panel
 *  ends at `said."` when the model quoted `said`. */
export function resolveChunkRange(request: ChunkRangeRequest): [number, number] {
  const { bookText, book, rangeStart, rangeEnd } = request;
  let start: number;
  const startText = (request.startText ?? '').trim();
  if (startText) {
    const located = locateQuote(book, startText, request.cursor, rangeEnd);
    if (!located) {
      throw new ChunkRangeError(
        `startText was not found in the passage after the previous panel. Quote the exact opening words as they appear in the passage, or omit startText to continue where the previous panel ended.`,
      );
    }
    start = located[0];
    while (start > request.cursor && OPENING_PUNCT.test(bookText[start - 1])) start -= 1;
  } else {
    start = request.cursor;
    while (start < rangeEnd && /\s/.test(bookText[start])) start += 1;
  }
  if (start >= rangeEnd) throw new ChunkRangeError('The passage is fully chunked; there is no text left after the previous panel.');
  const endText = request.endText.trim();
  if (!endText) throw new ChunkRangeError('endText is required: quote the exact closing words of this panel.');
  const located = locateQuote(book, endText, start, rangeEnd);
  if (!located) {
    throw new ChunkRangeError(
      `endText was not found between the start of this panel and the end of the passage. Quote the exact closing words as they appear in the passage, in order.`,
    );
  }
  let end = located[1];
  while (end < rangeEnd && CLOSING_PUNCT.test(bookText[end])) end += 1;
  if (end <= start) throw new ChunkRangeError('The panel would be empty: endText must come after the panel start.');
  if (start < rangeStart) throw new ChunkRangeError('The panel starts before the passage.');
  return [start, end];
}
