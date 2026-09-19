/** Panel image-prompt drafting and refinement profiles. */
import { invalid, notFound, conflict } from '../../services/errors';
import { findPanel, GEMINI_IMAGE_GUIDE, panelPromptContextLines, panelStoryText, requireExtractedCharacters } from '../context';
import { buildSystemPrompt } from '../systemPrompt';
import { replacePanelImagePromptTool, setPanelImagePromptTool } from '../tools';
import panelPromptSkill from '../skills/panel-prompt.md?raw';
import panelPromptRefineSkill from '../skills/panel-prompt-refine.md?raw';
import { registerProfile } from './registry';
import type { TaskArgs, TaskStep } from './types';

const GUIDE_SECTION = `## Gemini image prompt guide (follow exactly)\n\n${GEMINI_IMAGE_GUIDE.trim()}`;

export function parseRefineTarget(target: string): { panelId: string; promptId: string } {
  const index = target.indexOf(':');
  return index < 0 ? { panelId: target, promptId: '' } : { panelId: target.slice(0, index), promptId: target.slice(index + 1) };
}

async function draftPrecheck(slug: string, args: TaskArgs): Promise<void> {
  if (!args.target) throw invalid('draft-panel-prompt requires a target panel id');
  await requireExtractedCharacters(slug);
  const { panel } = await findPanel(slug, args.target);
  if (!panel) throw notFound(`Panel not found: ${args.target}`);
  if (!panelStoryText(panel)) throw conflict('Panel has no story text to draft from');
}

async function* draftPlan(slug: string, args: TaskArgs): AsyncGenerator<TaskStep, void, void> {
  const panelId = args.target as string;
  const guidance = (args.instructions ?? '').trim();
  const promptIdsBefore = new Set<string>();
  yield {
    name: `draft prompt ${panelId}`,
    systemPrompt: buildSystemPrompt(panelPromptSkill, [GUIDE_SECTION]),
    tools: [setPanelImagePromptTool(slug)],
    seedBook: false,
    buildPrompt: async () => {
      const { document, panel } = await findPanel(slug, panelId);
      if (!panel) throw new Error(`Panel not found: ${panelId}`);
      for (const prompt of panel.imagePrompts) promptIdsBefore.add(prompt.id);
      const lines = [`Draft the image prompt for panel ${panelId}.`, ''];
      if (guidance) lines.push('User guidance — an idea or direction for this image (build the prompt around it):', guidance, '');
      lines.push(...(await panelPromptContextLines(slug, panel, document)));
      return lines.join('\n').replace(/\s+$/, '') + '\n';
    },
    onSuccess: async () => {
      const { panel } = await findPanel(slug, panelId);
      if (!panel) throw new Error(`Panel disappeared while drafting: ${panelId}`);
      const newPrompts = panel.imagePrompts.filter((prompt) => !promptIdsBefore.has(prompt.id));
      if (!newPrompts.length) throw new Error('Agent finished without calling set_panel_image_prompt');
      return { panelId, promptId: newPrompts[newPrompts.length - 1].id };
    },
    repairPrompt: `You did not call set_panel_image_prompt. Your task is not complete. Save the finished prompt for ${panelId} by calling set_panel_image_prompt now; do not answer with prose only.`,
  };
}

async function refinePrecheck(slug: string, args: TaskArgs): Promise<void> {
  if (!args.target || !args.target.includes(':')) throw invalid("refine-panel-prompt requires a 'panelId:promptId' target");
  if (!(args.instructions ?? '').trim()) throw invalid('refine-panel-prompt requires feedback instructions');
  await requireExtractedCharacters(slug);
  const { panelId, promptId } = parseRefineTarget(args.target);
  const { panel } = await findPanel(slug, panelId);
  if (!panel) throw notFound(`Panel not found: ${panelId}`);
  if (!panel.imagePrompts.some((prompt) => prompt.id === promptId)) throw notFound(`Image prompt not found: ${promptId}`);
}

async function* refinePlan(slug: string, args: TaskArgs): AsyncGenerator<TaskStep, void, void> {
  const { panelId, promptId } = parseRefineTarget(args.target as string);
  const feedback = (args.instructions ?? '').trim();
  yield {
    name: `refine prompt ${panelId}:${promptId}`,
    systemPrompt: buildSystemPrompt(panelPromptRefineSkill, [GUIDE_SECTION]),
    tools: [replacePanelImagePromptTool(slug)],
    seedBook: false,
    buildPrompt: async () => {
      const { document, panel } = await findPanel(slug, panelId);
      if (!panel) throw new Error(`Panel not found: ${panelId}`);
      const current = panel.imagePrompts.find((prompt) => prompt.id === promptId);
      if (!current) throw new Error(`Image prompt not found: ${promptId}`);
      const lines = [
        `Revise image prompt ${promptId} on panel ${panelId}.`,
        '',
        'Current prompt (revise this):',
        current.text.trim(),
        '',
        'User feedback (apply this):',
        feedback,
        '',
        ...(await panelPromptContextLines(slug, panel, document)),
      ];
      return lines.join('\n').replace(/\s+$/, '') + '\n';
    },
    onSuccess: async () => {
      const { panel } = await findPanel(slug, panelId);
      if (!panel) throw new Error(`Panel disappeared while refining: ${panelId}`);
      const current = panel.imagePrompts.find((prompt) => prompt.id === promptId);
      if (!current || !current.text.trim()) throw new Error('Refined prompt is missing or empty after the run');
      return { panelId, promptId };
    },
    repairPrompt: `You did not call replace_panel_image_prompt. Revise prompt ${promptId} on ${panelId} by calling replace_panel_image_prompt now; do not answer with prose only.`,
  };
}

registerProfile({
  id: 'draft-panel-prompt',
  title: () => 'Draft panel prompt',
  acceptsTarget: true,
  acceptsInstructions: true,
  tools: ['set_panel_image_prompt'],
  precheck: draftPrecheck,
  plan: draftPlan,
});

registerProfile({
  id: 'refine-panel-prompt',
  title: () => 'Refine panel prompt',
  acceptsTarget: true,
  acceptsInstructions: true,
  tools: ['replace_panel_image_prompt'],
  precheck: refinePrecheck,
  plan: refinePlan,
});
