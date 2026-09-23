import { beforeEach, describe, expect, it } from 'vitest';
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { INTERRUPTED_ERROR, TaskManager, taskManager } from './runtime';
import { taskArgs } from './profiles/types';
import { PROFILES } from './profiles';
import { createCharacter, importBook, readMetadata, updateCharacter } from '../services/adaptation';
import { createPanel, readDocument } from '../services/storyPanels';
import { createSession, listSessions, readSession, readTraceDocument } from '../services/agentSessions';
import { resetSettingsCacheForTests, setDefaultTextModel, upsertEndpoint, writeSettings } from '../services/settings';
import { isServiceError } from '../services/errors';
import { FARM, seedProject } from '../test/fixtures';
import type { PiTaskEvent } from '../types';

type Faux = ReturnType<typeof createFauxCore>;

async function configureModel(contextWindow = 200_000): Promise<void> {
  await upsertEndpoint({ id: 'ep', name: 'Local', baseUrl: 'http://localhost:1234/v1', apiKey: '', models: [{ id: 'm1', name: 'M1', reasoning: false, contextWindow }] });
  await setDefaultTextModel({ endpointId: 'ep', modelId: 'm1' });
}

async function seedBook(text = 'Once upon a farm, Hero met Villain in the red barn. '.repeat(20)): Promise<void> {
  await importBook(FARM, new File([text], 'book.txt', { type: 'text/plain' }));
}

function useFaux(manager: TaskManager): Faux {
  const faux = createFauxCore({});
  manager.streamFnFactory = () => faux.streamSimple;
  return faux;
}

async function run(manager: TaskManager, profile: string, options: Parameters<typeof taskArgs>[0] = {}) {
  const events: PiTaskEvent[] = [];
  const status = await manager.startTask(FARM, profile, taskArgs(options));
  const unsubscribe = manager.subscribe(FARM, status.taskId, (record) => events.push(record));
  const final = await manager.waitForTask(status.taskId);
  unsubscribe();
  return { status: final, events, taskId: status.taskId };
}

beforeEach(async () => {
  resetSettingsCacheForTests();
  taskManager.resetForTests();
  await seedProject();
});

describe('task manager: arguments and prechecks', () => {
  it('rejects unknown profiles and misused targets/instructions', async () => {
    await configureModel();
    await expect(taskManager.startTask(FARM, 'nope', taskArgs())).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
    await expect(taskManager.startTask(FARM, 'discover-characters', taskArgs({ target: 'x' }))).rejects.toSatisfy((e) => isServiceError(e, 'invalid'));
    await expect(taskManager.startTask(FARM, 'extract-character', taskArgs({ target: 'x', instructions: 'y' }))).rejects.toSatisfy((e) => isServiceError(e, 'invalid'));
  });

  it('requires a prepared book for book tasks and a registered target for extract/refine', async () => {
    await configureModel();
    await expect(taskManager.startTask(FARM, 'discover-characters', taskArgs())).rejects.toThrow(/Load book session/);
    await seedBook();
    await run(taskManager, 'read-book');
    await expect(taskManager.startTask(FARM, 'extract-character', taskArgs())).rejects.toSatisfy((e) => isServiceError(e, 'invalid'));
    await expect(taskManager.startTask(FARM, 'extract-character', taskArgs({ target: 'ghost' }))).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
    await createCharacter(FARM, { name: 'Hero' });
    await expect(taskManager.startTask(FARM, 'refine-character', taskArgs({ target: 'hero' }))).rejects.toThrow(/requires feedback/);
    await expect(taskManager.startTask(FARM, 'refine-character', taskArgs({ target: 'hero', instructions: 'more hat' }))).rejects.toThrow(/Extract hero before refining/);
    await expect(taskManager.startTask(FARM, 'refine-panel-prompt', taskArgs({ target: 'panel-001', instructions: 'x' }))).rejects.toThrow(/panelId:promptId/);
  });
});

describe('read-book', () => {
  it('fails without a default model, then prepares the book context', async () => {
    await seedBook();
    const noModel = await run(taskManager, 'read-book');
    expect(noModel.status.state).toBe('failed');
    expect(noModel.status.error).toMatch(/default text model/);
    await configureModel();
    const { status, taskId } = await run(taskManager, 'read-book');
    expect(status.state).toBe('done');
    const metadata = await readMetadata(FARM);
    expect(metadata.bookContext?.fits).toBe(true);
    expect(metadata.bookContext?.tokenEstimate).toBeGreaterThan(0);
    const session = await readSession(FARM, taskId);
    expect(session.status).toBe('succeeded');
    expect(session.source.bookTokenEstimate).toBe(metadata.bookContext?.tokenEstimate);
  });

  it('refuses when the book does not fit the model window', async () => {
    await seedBook();
    await configureModel(2000);
    const { status } = await run(taskManager, 'read-book');
    expect(status.state).toBe('failed');
    expect(status.error).toMatch(/context window/);
    expect((await readMetadata(FARM)).bookContext?.fits).toBe(false);
    await expect(taskManager.startTask(FARM, 'discover-characters', taskArgs())).rejects.toThrow(/Load book session/);
  });
});

describe('discover-characters', () => {
  async function ready(): Promise<Faux> {
    await configureModel();
    await seedBook();
    const faux = useFaux(taskManager);
    await run(taskManager, 'read-book');
    return faux;
  }

  it('seeds the book, registers characters through the tool, and records events + trace', async () => {
    const faux = await ready();
    faux.setResponses([
      fauxAssistantMessage([fauxText('Looking at the cast.'), fauxToolCall('register_character', { name: 'Hero', summary: 'The farm hero.' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('Registered 1 characters.')]),
    ]);
    const { status, events, taskId } = await run(taskManager, 'discover-characters');
    expect(status.state).toBe('done');
    expect(Object.keys((await readMetadata(FARM)).characters)).toEqual(['hero']);
    const types = events.map((record) => record.event.type);
    expect(types[0]).toBe('task_start');
    expect(types).toEqual(expect.arrayContaining(['book_context', 'assistant_text', 'tool_start', 'tool_end', 'agent_end']));
    expect(types[types.length - 1]).toBe('task_state');
    expect(events[events.length - 1].event.state).toBe('done');
    expect(events.find((r) => r.event.type === 'tool_start')?.event.args).toContain('"name":"Hero"');
    const session = await readSession(FARM, taskId);
    expect(session.status).toBe('succeeded');
    expect(session.source.registeredSlugs).toEqual(['hero']);
    const trace = await readTraceDocument(FARM, taskId);
    expect(trace?.steps[0].seededMessages).toBe(2);
    expect(trace?.steps[0].messages.length).toBeGreaterThan(3);
    expect(faux.state.callCount).toBe(2);
  });

  it('sends up to two repair prompts, then fails naming the missing tool', async () => {
    const faux = await ready();
    faux.setResponses([
      fauxAssistantMessage([fauxText('I would register Hero.')]),
      fauxAssistantMessage([fauxText('Still just talking.')]),
      fauxAssistantMessage([fauxText('Nope.')]),
    ]);
    const { status, events, taskId } = await run(taskManager, 'discover-characters');
    expect(status.state).toBe('failed');
    expect(status.error).toBe('Agent finished without calling register_character');
    expect(faux.state.callCount).toBe(3);
    expect(events.filter((r) => r.event.type === 'task_progress').map((r) => r.event.label)).toEqual([
      'discover characters',
      'repair attempt 1: discover characters',
      'repair attempt 2: discover characters',
    ]);
    expect((await readSession(FARM, taskId)).status).toBe('failed');
  });

  it('skips when records exist unless forced, and lists them in the prompt', async () => {
    const faux = await ready();
    await createCharacter(FARM, { name: 'Hero', summary: 'Already here.' });
    const skipped = await run(taskManager, 'discover-characters');
    expect(skipped.status.state).toBe('done');
    expect(faux.state.callCount).toBe(0);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('register_character', { name: 'Villain', summary: 'The rival.' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('Registered 1 characters.')]),
    ]);
    const forced = await run(taskManager, 'discover-characters', { force: true });
    expect(forced.status.state).toBe('done');
    const trace = await readTraceDocument(FARM, forced.taskId);
    const userPrompt = trace?.steps[0].messages[2] as { content: Array<{ text: string }> };
    expect(userPrompt.content[0].text).toContain('do NOT register these again');
    expect(userPrompt.content[0].text).toContain('- Hero: Already here.');
  });

  it('refuses a duplicate task for the same profile and target, and cancels on abort', async () => {
    const faux = await ready();
    faux.setResponses([fauxAssistantMessage([fauxText('slow '.repeat(400))])]);
    const slow = createFauxCore({ tokensPerSecond: 20 });
    slow.setResponses([fauxAssistantMessage([fauxText('slow '.repeat(400))])]);
    taskManager.streamFnFactory = () => slow.streamSimple;
    const status = await taskManager.startTask(FARM, 'discover-characters', taskArgs());
    await expect(taskManager.startTask(FARM, 'discover-characters', taskArgs())).rejects.toSatisfy((e) => isServiceError(e, 'conflict'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(taskManager.abort(FARM, status.taskId)).toBe(true);
    const final = await taskManager.waitForTask(status.taskId);
    expect(final.state).toBe('cancelled');
    expect(taskManager.abort(FARM, status.taskId)).toBe(false);
    expect((await readSession(FARM, status.taskId)).status).toBe('failed');
    expect((await taskManager.listStatuses(FARM, { active: true })).length).toBe(0);
  });
});

describe('extract-all-characters', () => {
  it('discovers then extracts each registered character with resumed steps', async () => {
    await configureModel();
    await seedBook();
    const faux = useFaux(taskManager);
    await run(taskManager, 'read-book');
    const sheet = (slug: string) => ({ slug, visualDescription: `${slug} look`, variants: { base: { prompt: `${slug} sheet` } } });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('register_character', { name: 'Hero', summary: 'h' }), fauxToolCall('register_character', { name: 'Villain', summary: 'v' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('Registered 2 characters.')]),
      fauxAssistantMessage([fauxToolCall('update_character', sheet('hero'))], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('Updated hero.')]),
      fauxAssistantMessage([fauxToolCall('update_character', sheet('villain'))], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('Updated villain.')]),
    ]);
    const { status, events, taskId } = await run(taskManager, 'extract-all-characters');
    expect(status.state).toBe('done');
    const labels = events.filter((r) => r.event.type === 'task_progress').map((r) => [r.event.index, r.event.label]);
    expect(labels).toEqual([[1, 'discover characters'], [2, 'extract character hero'], [3, 'extract character villain']]);
    const metadata = await readMetadata(FARM);
    expect(metadata.characters.hero.variants.base.prompt).toBe('hero sheet');
    expect(metadata.characters.villain.visualDescription).toBe('villain look');
    expect((await readTraceDocument(FARM, taskId))?.steps.map((s) => s.name)).toEqual(['discover characters', 'extract character hero', 'extract character villain']);
  });
});

describe('draft-panel-prompt', () => {
  it('gates on extracted characters and delivers via set_panel_image_prompt', async () => {
    await configureModel();
    const faux = useFaux(taskManager);
    await createPanel(FARM, { title: 'P1', storyText: 'Hero walks into the barn.' });
    const panelId = (await readDocument(FARM)).panels.find((p) => p.title === 'P1')!.id;
    await expect(taskManager.startTask(FARM, 'draft-panel-prompt', taskArgs({ target: panelId }))).rejects.toThrow(/Extract characters/);
    await createCharacter(FARM, { name: 'Hero' });
    await updateCharacter(FARM, 'hero', { visualDescription: 'Tall.', variants: { base: { prompt: 'Hero sheet.' } } });
    await expect(taskManager.startTask(FARM, 'draft-panel-prompt', taskArgs({ target: 'panel-999' }))).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('set_panel_image_prompt', { panelId, prompt: 'Hero, tall, walking into a red barn at dawn.', characterSlugs: ['hero'] })], { stopReason: 'toolUse' }),
    ]);
    const { status, taskId } = await run(taskManager, 'draft-panel-prompt', { target: panelId, instructions: 'Make it dawn.' });
    expect(status.state).toBe('done');
    expect(faux.state.callCount).toBe(1);
    const panel = (await readDocument(FARM)).panels.find((p) => p.id === panelId)!;
    expect(panel.imagePrompts).toHaveLength(1);
    expect(panel.characterSlugs).toEqual(['hero']);
    const session = await readSession(FARM, taskId);
    expect(session.source).toMatchObject({ panelId, promptId: panel.imagePrompts[0].id });
    const trace = await readTraceDocument(FARM, taskId);
    const userPrompt = trace?.steps[0].messages[0] as { content: Array<{ text: string }> };
    expect(userPrompt.content[0].text).toContain('User guidance');
    expect(userPrompt.content[0].text).toContain('- hero: Hero sheet.');
    expect(trace?.steps[0].seededMessages).toBe(0);
  });
});

describe('reload sweep', () => {
  it('marks ledger rows still running from a previous page load as failed', async () => {
    await createSession(FARM, { kind: 'discover-characters', title: 'Find characters', sessionId: 'stale' });
    const fresh = new TaskManager();
    expect(await fresh.listStatuses(FARM)).toEqual([]);
    const session = (await listSessions(FARM, true)).find((s) => s.id === 'stale')!;
    expect(session.status).toBe('failed');
    expect(session.error).toBe(INTERRUPTED_ERROR);
    expect(session.completedAt).toBeTruthy();
  });

  it('registers all thirteen profiles', () => {
    expect(Object.keys(PROFILES).sort()).toEqual([
      'discover-characters', 'discover-locations', 'draft-panel-prompt', 'extract-all-characters', 'extract-all-locations',
      'extract-character', 'extract-location', 'read-book', 'refine-character', 'refine-location', 'refine-panel-prompt',
      'suggest-concept-character', 'suggest-concept-location',
    ]);
  });
});
