/** "chunk-panels": break a selected passage of the book into panels with a
 *  shot and size per beat. Range target is `startOffset:endOffset`. */
import { conflict, invalid } from '../../services/errors';
import { readBook, readDocument, unclaimedRanges } from '../../services/storyPanels';
import { status as adaptationStatus } from '../../services/adaptation';
import { clipText } from '../context';
import { buildSystemPrompt } from '../systemPrompt';
import { createStoryPanelTool, type ChunkSession } from '../tools';
import chunkPanelsSkill from '../skills/chunk-panels.md?raw';
import { requireBookSession } from './entities';
import { registerProfile } from './registry';
import type { TaskArgs, TaskStep } from './types';

export function parseChunkTarget(target: string | null): { start: number; end: number } {
  const match = /^(\d+):(\d+)$/.exec(target ?? '');
  if (!match) throw invalid("chunk-panels requires a 'startOffset:endOffset' target");
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end <= start) throw invalid('chunk-panels range must end after it starts');
  return { start, end };
}

async function precheck(slug: string, args: TaskArgs): Promise<void> {
  const { start, end } = parseChunkTarget(args.target);
  await requireBookSession(slug);
  const book = await readBook(slug);
  if (end > book.length) throw invalid('chunk-panels range exceeds the book length');
  if (!book.slice(start, end).trim()) throw invalid('The selected passage is empty');
  const document = await readDocument(slug);
  if (!unclaimedRanges(document, start, end).length) throw conflict('Every part of that passage is already a panel');
}

async function* plan(slug: string, args: TaskArgs): AsyncGenerator<TaskStep, void, void> {
  const { start, end } = parseChunkTarget(args.target);
  const guidance = (args.instructions ?? '').trim();
  const session: ChunkSession = { rangeStart: start, rangeEnd: end, cursor: start, createdIds: [] };
  const idsBefore = new Set<string>();
  yield {
    name: `chunk ${start}-${end}`,
    systemPrompt: buildSystemPrompt(chunkPanelsSkill),
    tools: [createStoryPanelTool(slug, session)],
    seedBook: true,
    buildPrompt: async () => {
      const book = await readBook(slug);
      const document = await readDocument(slug);
      for (const panel of document.panels) idsBefore.add(panel.id);
      const lines = [`Break the passage below (book offsets ${start}-${end}) into panels with create_story_panel.`, ''];
      if (guidance) lines.push('User guidance (follow it):', guidance, '');
      const linked = document.panels
        .filter((panel) => panel.sourceKind === 'panel' && panel.startOffset !== null && panel.endOffset !== null)
        .sort((a, b) => a.startOffset! - b.startOffset!);
      const before = linked.filter((panel) => panel.endOffset! <= start).slice(-2);
      if (before.length) {
        lines.push('Panels just before the passage (for continuity; do not recreate):');
        for (const panel of before) lines.push(`- ${panel.id} ${panel.title ? `"${panel.title}" ` : ''}[${panel.shot ?? 'shot unset'}]: ${clipText(panel.storyText || panel.selectedText, 200)}`);
        lines.push('');
      }
      const inside = linked.filter((panel) => panel.startOffset! < end && panel.endOffset! > start);
      if (inside.length) {
        lines.push('Panels already inside the passage (skip their text; the tool refuses overlaps):');
        for (const panel of inside) lines.push(`- ${panel.id} (${panel.startOffset}-${panel.endOffset}): ${clipText(panel.storyText || panel.selectedText, 200)}`);
        lines.push('');
      }
      const status = await adaptationStatus(slug);
      if (Object.keys(status.characters).length) {
        lines.push('Registered characters (valid characterSlugs values are the slugs in brackets):');
        for (const [slug, record] of Object.entries(status.characters).sort()) lines.push(`- [${slug}] ${record.name || slug}${record.summary.trim() ? `: ${clipText(record.summary, 160)}` : ''}`);
        lines.push('');
      }
      if (Object.keys(status.locations).length) {
        lines.push('Registered locations (valid locationSlug values are the slugs in brackets):');
        for (const [slug, record] of Object.entries(status.locations).sort()) lines.push(`- [${slug}] ${record.name || slug}${record.summary.trim() ? `: ${clipText(record.summary, 160)}` : ''}`);
        lines.push('');
      }
      lines.push('THE PASSAGE (chunk all of this, in order):', '<passage>', book.slice(start, end), '</passage>');
      return lines.join('\n') + '\n';
    },
    onSuccess: async () => {
      const document = await readDocument(slug);
      const created = document.panels
        .filter((panel) => !idsBefore.has(panel.id) && panel.sourceKind === 'panel' && panel.startOffset !== null && panel.startOffset >= start && panel.startOffset < end)
        .sort((a, b) => a.startOffset! - b.startOffset!)
        .map((panel) => panel.id);
      if (!created.length) throw new Error('Agent finished without calling create_story_panel');
      return { rangeStart: start, rangeEnd: end, panelIds: created };
    },
    repairPrompt: 'You did not call create_story_panel. Your task is not complete. Carve the passage into panels by calling create_story_panel now, one call per panel in order; do not answer with prose only.',
  };
}

registerProfile({
  id: 'chunk-panels',
  title: () => 'Chunk panels',
  acceptsTarget: true,
  acceptsInstructions: true,
  tools: ['create_story_panel'],
  precheck,
  plan,
});
