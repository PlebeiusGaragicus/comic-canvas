/** "read-book": prepare the book context. No model call. */
import { prepareBookContext } from '../book';
import { registerProfile } from './registry';

export const READ_BOOK = registerProfile({
  id: 'read-book',
  title: () => 'Read book',
  acceptsTarget: false,
  acceptsInstructions: false,
  tools: [],
  precheck: async () => undefined,
  plan: async function* (slug) {
    yield {
      name: 'read book',
      systemPrompt: '',
      tools: [],
      seedBook: false,
      buildPrompt: async () => null,
      onSuccess: async () => {
        const context = await prepareBookContext(slug);
        return { bookTokenEstimate: context.tokenEstimate, bookHash: context.bookHash };
      },
    };
  },
});
