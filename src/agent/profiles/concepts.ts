/** Concept-art suggestion profiles. */
import { readMetadata } from '../../services/adaptation';
import { listCards } from '../../services/conceptCards';
import { hasPreparedBook } from '../book';
import { conflict } from '../../services/errors';
import { conceptContextLines, existingCardIds, registeredRecordLines } from '../context';
import { buildSystemPrompt } from '../systemPrompt';
import { createConceptCardTool } from '../tools';
import conceptCharacterSkill from '../skills/concept-character.md?raw';
import conceptLocationSkill from '../skills/concept-location.md?raw';
import { registerProfile } from './registry';
import type { TaskStep } from './types';

async function* suggestConceptPlan(slug: string, subjectKind: 'character' | 'location'): AsyncGenerator<TaskStep, void, void> {
  const cardsBefore = new Set<string>();
  yield {
    name: `concept ${subjectKind}`,
    systemPrompt: buildSystemPrompt(subjectKind === 'character' ? conceptCharacterSkill : conceptLocationSkill),
    tools: [createConceptCardTool(slug)],
    seedBook: true,
    buildPrompt: async () => {
      for (const id of await existingCardIds(slug)) cardsBefore.add(id);
      const lines = [`Invent one new ${subjectKind} concept for this book and deliver it with create_concept_card.`, '', ...(await conceptContextLines(slug))];
      const metadata = await readMetadata(slug);
      const records = subjectKind === 'character' ? metadata.characters : metadata.locations;
      if (Object.keys(records).length) {
        lines.push(
          '',
          subjectKind === 'character'
            ? 'Main cast already covered by registered character records:'
            : 'Settings already covered by registered location records:',
          ...registeredRecordLines(records),
        );
      }
      return lines.join('\n').replace(/\s+$/, '') + '\n';
    },
    onSuccess: async () => {
      const cards = await listCards(slug, true);
      const newCards = cards.filter((card) => !cardsBefore.has(card.id));
      if (!newCards.length) throw new Error('Agent finished without calling create_concept_card');
      const newest = newCards.reduce((best, card) => (card.createdAt > best.createdAt ? card : best));
      return { outputCardId: newest.id, subjectKind };
    },
    repairPrompt: 'You did not call create_concept_card. Your task is not complete. Deliver the concept by calling create_concept_card now; do not answer with prose only.',
  };
}

for (const subjectKind of ['character', 'location'] as const) {
  registerProfile({
    id: `suggest-concept-${subjectKind}`,
    title: () => (subjectKind === 'character' ? 'Suggest character concept' : 'Suggest location concept'),
    acceptsTarget: false,
    acceptsInstructions: false,
    tools: ['create_concept_card'],
    precheck: async (slug) => {
      if (!(await hasPreparedBook(slug))) throw conflict('Load book session before running this task');
    },
    plan: (slug) => suggestConceptPlan(slug, subjectKind),
  });
}
