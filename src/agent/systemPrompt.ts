/** System prompts: a fixed preamble plus the skill markdown that used to be
 *  invoked with `/skill:<name>`. */

export const PREAMBLE = [
  'You are a focused assistant inside Comic Canvas, an app that adapts a book into a comic.',
  'When the book is part of this conversation, it is the source of truth; do not invent facts that contradict it.',
  'The tools provided are the only way to deliver results; nothing you write in prose is saved.',
  'Follow the task instructions below exactly, including the delivery contract.',
].join(' ');

export function buildSystemPrompt(skillMarkdown: string, extraSections: string[] = []): string {
  const sections = [PREAMBLE, skillMarkdown.trim(), ...extraSections.map((section) => section.trim()).filter(Boolean)];
  return sections.join('\n\n') + '\n';
}
