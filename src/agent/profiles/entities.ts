/** Character / location discovery, extraction and refinement profiles. */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { CharacterRecord, LocationRecord } from '../../types';
import { characterIsExtracted, locationIsExtracted, readMetadata, type EntityRecord } from '../../services/adaptation';
import { conflict, invalid, notFound } from '../../services/errors';
import { hasPreparedBook } from '../book';
import { entityRecordContext, registeredRecordLines, type EntityKindId } from '../context';
import { buildSystemPrompt } from '../systemPrompt';
import {
  listCharactersTool,
  listLocationsTool,
  registerCharacterTool,
  registerLocationTool,
  updateCharacterTool,
  updateLocationTool,
} from '../tools';
import discoverCharactersSkill from '../skills/discover-characters.md?raw';
import discoverLocationsSkill from '../skills/discover-locations.md?raw';
import extractCharacterSkill from '../skills/extract-character.md?raw';
import extractLocationSkill from '../skills/extract-location.md?raw';
import refineCharacterSkill from '../skills/refine-character.md?raw';
import refineLocationSkill from '../skills/refine-location.md?raw';
import { registerProfile } from './registry';
import type { TaskArgs, TaskStep } from './types';

interface EntityKind {
  kind: EntityKindId;
  records: (slug: string) => Promise<Record<string, EntityRecord>>;
  isExtracted: (record: EntityRecord) => boolean;
  skills: { discover: string; extract: string; refine: string };
  tools: {
    register: (slug: string) => AgentTool;
    list: (slug: string) => AgentTool;
    update: (slug: string) => AgentTool;
  };
}

const CHARACTER: EntityKind = {
  kind: 'character',
  records: async (slug) => (await readMetadata(slug)).characters,
  isExtracted: (record) => characterIsExtracted(record as CharacterRecord),
  skills: { discover: discoverCharactersSkill, extract: extractCharacterSkill, refine: refineCharacterSkill },
  tools: { register: registerCharacterTool, list: listCharactersTool, update: updateCharacterTool },
};

const LOCATION: EntityKind = {
  kind: 'location',
  records: async (slug) => (await readMetadata(slug)).locations,
  isExtracted: (record) => locationIsExtracted(record as LocationRecord),
  skills: { discover: discoverLocationsSkill, extract: extractLocationSkill, refine: refineLocationSkill },
  tools: { register: registerLocationTool, list: listLocationsTool, update: updateLocationTool },
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export async function requireBookSession(slug: string): Promise<void> {
  if (!(await hasPreparedBook(slug))) throw conflict('Load book session before running this task');
}

function discoverStep(slug: string, entity: EntityKind, force: boolean): TaskStep {
  const { kind } = entity;
  const slugsBefore = new Set<string>();
  return {
    name: `discover ${kind}s`,
    systemPrompt: buildSystemPrompt(entity.skills.discover),
    tools: [entity.tools.register(slug), entity.tools.list(slug)],
    seedBook: true,
    buildPrompt: async () => {
      const existing = await entity.records(slug);
      for (const key of Object.keys(existing)) slugsBefore.add(key);
      if (Object.keys(existing).length && !force) return null;
      const lines = [`Discover the ${kind}s of this book and register each one with register_${kind}.`];
      if (Object.keys(existing).length) {
        lines.push('', `${capitalize(kind)}s already registered (do NOT register these again):`, ...registeredRecordLines(existing));
      }
      return lines.join('\n').replace(/\s+$/, '') + '\n';
    },
    onSuccess: async (ran) => {
      if (!ran) return null;
      const newSlugs = Object.keys(await entity.records(slug)).filter((key) => !slugsBefore.has(key));
      if (!newSlugs.length) throw new Error(`Agent finished without calling register_${kind}`);
      return { registeredSlugs: newSlugs.sort() };
    },
    repairPrompt: `You did not call register_${kind}. Your task is not complete. Register each ${kind} you found by calling register_${kind} now; do not answer with prose only.`,
  };
}

function extractStep(slug: string, entity: EntityKind, entitySlug: string, force: boolean): TaskStep {
  const { kind } = entity;
  return {
    name: `extract ${kind} ${entitySlug}`,
    systemPrompt: buildSystemPrompt(entity.skills.extract),
    tools: [entity.tools.update(slug), entity.tools.list(slug)],
    seedBook: true,
    buildPrompt: async () => {
      const record = (await entity.records(slug))[entitySlug];
      if (!record) throw new Error(`${capitalize(kind)} not registered: ${entitySlug}`);
      if (entity.isExtracted(record) && !force) return null;
      return [
        `Extract the ${kind} "${entitySlug}" from the book.`,
        '',
        `Current ${kind} record (fill it in with update_${kind}):`,
        entityRecordContext(kind, record),
      ].join('\n') + '\n';
    },
    onSuccess: async () => {
      const record = (await entity.records(slug))[entitySlug];
      if (!record) throw new Error(`${capitalize(kind)} disappeared during extract: ${entitySlug}`);
      if (!entity.isExtracted(record)) {
        throw new Error(
          `Agent finished without delivering an extracted record for ${entitySlug} (update_${kind} must set visualDescription and a base variant prompt)`,
        );
      }
      return null;
    },
    repairPrompt: `You did not deliver the extracted record. Call update_${kind} for "${entitySlug}" now with visualDescription and a base variant prompt; do not answer with prose only.`,
  };
}

async function extractPrecheck(slug: string, entity: EntityKind, args: TaskArgs): Promise<void> {
  await requireBookSession(slug);
  if (!args.target) throw invalid(`extract-${entity.kind} requires a target ${entity.kind} slug`);
  if (!(args.target in (await entity.records(slug)))) throw notFound(`${capitalize(entity.kind)} not registered: ${args.target}`);
}

async function* extractAllPlan(slug: string, entity: EntityKind): AsyncGenerator<TaskStep, void, void> {
  yield discoverStep(slug, entity, false);
  // Resumed after the discovery step, so records exist (or the task failed).
  for (const entitySlug of Object.keys(await entity.records(slug)).sort()) {
    yield extractStep(slug, entity, entitySlug, false);
  }
}

async function refinePrecheck(slug: string, entity: EntityKind, args: TaskArgs): Promise<void> {
  const { kind } = entity;
  await requireBookSession(slug);
  if (!args.target) throw invalid(`refine-${kind} requires a target ${kind} slug`);
  if (!(args.instructions ?? '').trim()) throw invalid(`refine-${kind} requires feedback instructions`);
  const record = (await entity.records(slug))[args.target];
  if (!record) throw notFound(`${capitalize(kind)} not registered: ${args.target}`);
  if (!entity.isExtracted(record)) throw conflict(`Extract ${args.target} before refining`);
}

async function* refinePlan(slug: string, entity: EntityKind, args: TaskArgs): AsyncGenerator<TaskStep, void, void> {
  const { kind } = entity;
  const entitySlug = args.target as string;
  const feedback = (args.instructions ?? '').trim();
  let contextBefore: string | null = null;
  yield {
    name: `refine ${kind} ${entitySlug}`,
    systemPrompt: buildSystemPrompt(entity.skills.refine),
    tools: [entity.tools.update(slug), entity.tools.list(slug)],
    seedBook: true,
    buildPrompt: async () => {
      const record = (await entity.records(slug))[entitySlug];
      if (!record) throw new Error(`${capitalize(kind)} not registered: ${entitySlug}`);
      contextBefore = entityRecordContext(kind, record);
      return [
        `Refine the ${kind} "${entitySlug}".`,
        '',
        `Current ${kind} record (revise it with update_${kind}):`,
        contextBefore,
        '',
        'User feedback (apply this):',
        feedback,
      ].join('\n') + '\n';
    },
    onSuccess: async () => {
      const record = (await entity.records(slug))[entitySlug];
      if (!record) throw new Error(`${capitalize(kind)} disappeared while refining: ${entitySlug}`);
      if (entityRecordContext(kind, record) === contextBefore) throw new Error(`Agent finished without calling update_${kind}`);
      return { [`${kind}Slug`]: entitySlug };
    },
    repairPrompt: `You did not call update_${kind}. Apply the user's feedback to "${entitySlug}" by calling update_${kind} now; do not answer with prose only.`,
  };
}

for (const entity of [CHARACTER, LOCATION]) {
  const { kind } = entity;
  registerProfile({
    id: `discover-${kind}s` as 'discover-characters' | 'discover-locations',
    title: () => (kind === 'character' ? 'Find characters' : 'Find locations'),
    acceptsTarget: false,
    acceptsInstructions: false,
    tools: [`register_${kind}`, `list_${kind}s`],
    precheck: (slug) => requireBookSession(slug),
    plan: async function* (slug, args) {
      yield discoverStep(slug, entity, args.force);
    },
  });
  registerProfile({
    id: `extract-${kind}` as 'extract-character' | 'extract-location',
    title: (target) => `Extract ${target}`,
    acceptsTarget: true,
    acceptsInstructions: false,
    tools: [`update_${kind}`, `list_${kind}s`],
    precheck: (slug, args) => extractPrecheck(slug, entity, args),
    plan: async function* (slug, args) {
      yield extractStep(slug, entity, args.target as string, args.force);
    },
  });
  registerProfile({
    id: `extract-all-${kind}s` as 'extract-all-characters' | 'extract-all-locations',
    title: () => (kind === 'character' ? 'Extract all characters' : 'Extract all locations'),
    acceptsTarget: false,
    acceptsInstructions: false,
    tools: [`register_${kind}`, `update_${kind}`, `list_${kind}s`],
    precheck: (slug) => requireBookSession(slug),
    plan: (slug) => extractAllPlan(slug, entity),
  });
  registerProfile({
    id: `refine-${kind}` as 'refine-character' | 'refine-location',
    title: (target) => (target ? `Refine ${target}` : `Refine ${kind}`),
    acceptsTarget: true,
    acceptsInstructions: true,
    tools: [`update_${kind}`, `list_${kind}s`],
    precheck: (slug, args) => refinePrecheck(slug, entity, args),
    plan: (slug, args) => refinePlan(slug, entity, args),
  });
}
