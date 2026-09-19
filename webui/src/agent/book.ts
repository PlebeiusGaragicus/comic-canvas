/** Book context: replaces the pi read-book session + `--fork`. The book is
 *  seeded as a message prefix per task; this module decides whether it fits. */
import { estimateTokens } from '@earendil-works/pi-agent-core';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { BookContext } from '../types';
import { readBook, readMetadata, writeMetadata } from '../services/adaptation';
import { readSettings, resolveDefaultTextModel, type ResolvedTextModel } from '../services/settings';
import { ServiceError } from '../services/errors';
import { utcNow } from '../services/common';
import { sha256Hex } from '../shared/images';
import { assistantMessage, userMessage } from './messages';

/** Tokens kept free for the task prompt, tools, and the model's reply. */
export const BOOK_RESERVE_TOKENS = 16_000;

export const BOOK_LOADED_REPLY = 'Book loaded.';

export function bookPreamble(bookText: string): string {
  return `Here is the full text of the book we are adapting into a comic. Read it carefully; later instructions refer to it.\n\n<book>\n${bookText}\n</book>`;
}

export function seedMessages(bookText: string, modelId?: string): AgentMessage[] {
  return [userMessage(bookPreamble(bookText)), assistantMessage(BOOK_LOADED_REPLY, modelId)];
}

export function estimateBookTokens(bookText: string): number {
  return estimateTokens(userMessage(bookPreamble(bookText)));
}

export async function requireTextModel(): Promise<ResolvedTextModel> {
  const resolved = resolveDefaultTextModel(await readSettings());
  if (!resolved) {
    throw new ServiceError('Choose a default text model in Settings before running agent tasks.', { code: 'invalid' });
  }
  return resolved;
}

/** "read-book" in the browser: measure the book against the selected model
 *  and persist the verdict. No model call is made. */
export async function prepareBookContext(slug: string): Promise<BookContext> {
  const bookText = await readBook(slug);
  const resolved = await requireTextModel();
  const tokenEstimate = estimateBookTokens(bookText);
  const contextWindow = resolved.model.contextWindow;
  const fits = tokenEstimate + BOOK_RESERVE_TOKENS <= contextWindow;
  const bookContext: BookContext = {
    bookHash: await sha256Hex(new TextEncoder().encode(bookText)),
    tokenEstimate,
    preparedAt: utcNow(),
    fits,
    modelId: resolved.model.id,
    contextWindow,
  };
  const metadata = await readMetadata(slug);
  await writeMetadata(slug, { ...metadata, bookContext });
  if (!fits) {
    throw new ServiceError(
      `The book is about ${tokenEstimate.toLocaleString()} tokens but ${resolved.model.name} has a ${contextWindow.toLocaleString()}-token context window (${BOOK_RESERVE_TOKENS.toLocaleString()} reserved). Pick a model with a larger window.`,
      { code: 'invalid' },
    );
  }
  return bookContext;
}

/** The book text for a task step, or a clear refusal when it is not prepared / no longer fits. */
export async function loadSeededBook(slug: string): Promise<{ text: string; tokenEstimate: number }> {
  const metadata = await readMetadata(slug);
  const context = metadata.bookContext;
  if (!context) throw new ServiceError('Load book session before running this task', { code: 'conflict' });
  const resolved = await requireTextModel();
  const bookText = await readBook(slug);
  const currentHash = await sha256Hex(new TextEncoder().encode(bookText));
  if (currentHash !== context.bookHash) {
    throw new ServiceError('The book changed since it was prepared. Run "Read book" again.', { code: 'conflict' });
  }
  const tokenEstimate = context.tokenEstimate;
  if (tokenEstimate + BOOK_RESERVE_TOKENS > resolved.model.contextWindow) {
    throw new ServiceError(
      `The book (${tokenEstimate.toLocaleString()} tokens) does not fit ${resolved.model.name}'s ${resolved.model.contextWindow.toLocaleString()}-token context. Pick a larger model or re-run "Read book".`,
      { code: 'conflict' },
    );
  }
  return { text: bookText, tokenEstimate };
}

export async function hasPreparedBook(slug: string): Promise<boolean> {
  const metadata = await readMetadata(slug);
  return Boolean(metadata.bookContext?.fits);
}
