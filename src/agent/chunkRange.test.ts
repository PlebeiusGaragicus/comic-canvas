import { describe, expect, it } from 'vitest';
import { ChunkRangeError, locateQuote, normalizeForMatch, resolveChunkRange } from './chunkRange';

const BOOK = '“Hello,” said Hero.\n\nThe barn door creaked open…  Villain waited inside, smiling.\n"Come in," he said.';

function resolve(options: { cursor?: number; startText?: string; endText: string; rangeStart?: number; rangeEnd?: number }): [number, number] {
  return resolveChunkRange({
    bookText: BOOK,
    book: normalizeForMatch(BOOK),
    rangeStart: options.rangeStart ?? 0,
    rangeEnd: options.rangeEnd ?? BOOK.length,
    cursor: options.cursor ?? options.rangeStart ?? 0,
    startText: options.startText,
    endText: options.endText,
  });
}

describe('normalizeForMatch', () => {
  it('lowercases, unifies quotes and dashes, collapses whitespace and keeps an index map', () => {
    const normalized = normalizeForMatch('  “Hi”—\n\n there… ');
    expect(normalized.text).toBe('"hi"- there...');
    expect(normalized.map).toHaveLength(normalized.text.length);
    expect(BOOK[normalizeForMatch(BOOK).map[normalizeForMatch(BOOK).text.indexOf('villain')]]).toBe('V');
  });
});

describe('locateQuote', () => {
  it('finds curly-quoted, differently cased, re-wrapped text and respects the window', () => {
    const book = normalizeForMatch(BOOK);
    expect(locateQuote(book, '"hello," SAID hero', 0, BOOK.length)).toEqual([0, 18]);
    expect(locateQuote(book, 'creaked open... villain\nwaited', 0, BOOK.length)).toEqual([BOOK.indexOf('creaked'), BOOK.indexOf('waited') + 'waited'.length]);
    expect(locateQuote(book, 'said Hero', 5, BOOK.length)).toEqual([9, 18]);
    expect(locateQuote(book, 'said Hero', 12, BOOK.length)).toBeNull();
    expect(locateQuote(book, 'said Hero', 0, 15)).toBeNull();
    expect(locateQuote(book, 'not in the book', 0, BOOK.length)).toBeNull();
    expect(locateQuote(book, '   ', 0, BOOK.length)).toBeNull();
  });
});

describe('resolveChunkRange', () => {
  it('starts at the cursor, ends at the quote, and widens over closing punctuation', () => {
    const [start, end] = resolve({ endText: 'said Hero' });
    expect(start).toBe(0);
    expect(BOOK.slice(start, end)).toBe('“Hello,” said Hero.');
    const [start2, end2] = resolve({ cursor: end, endText: 'creaked open' });
    expect(BOOK.slice(start2, end2)).toBe('The barn door creaked open…');
  });

  it('skips with startText and widens over an opening quote', () => {
    const [start, end] = resolve({ cursor: 19, startText: 'Come in', endText: 'he said' });
    expect(BOOK.slice(start, end)).toBe('"Come in," he said.');
  });

  it('explains failures the model can act on', () => {
    expect(() => resolve({ endText: 'never written' })).toThrow(ChunkRangeError);
    expect(() => resolve({ endText: 'never written' })).toThrow(/endText was not found/);
    expect(() => resolve({ startText: 'nope', endText: 'he said' })).toThrow(/startText was not found/);
    expect(() => resolve({ cursor: BOOK.length, endText: 'he said' })).toThrow(/fully chunked/);
    expect(() => resolve({ endText: '' })).toThrow(/endText is required/);
    expect(() => resolve({ endText: 'he said', rangeEnd: 30 })).toThrow(/endText was not found/);
  });
});
