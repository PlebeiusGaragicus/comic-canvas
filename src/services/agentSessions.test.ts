import { describe, expect, it } from 'vitest';
import { createSession, listSessions, patchSession, readSession, readTraceDocument, updateSession, writeTraceDocument } from './agentSessions';
import { isServiceError } from './errors';
import { FARM, seedProject } from '../test/fixtures';

// Time-sortable id that sorts before any ULID minted during the test.
const T1 = '00000000000000000000000001';

describe('agent sessions ledger', () => {
  it('creates, updates, lists newest first, and archives with the unarchive rule', async () => {
    await seedProject();
    const first = await createSession(FARM, { kind: 'read-book', title: 'Read book', sessionId: T1, source: { type: 'pi-task' } });
    expect(first.traceId).toBe(T1);
    await expect(createSession(FARM, { kind: 'read-book', title: 'x', sessionId: T1 })).rejects.toSatisfy((e) => isServiceError(e, 'conflict'));
    const second = await createSession(FARM, { kind: 'discover-characters', title: 'Find characters' });
    expect((await listSessions(FARM)).map((s) => s.id)).toEqual([second.id, T1]);
    const updated = await updateSession(FARM, T1, { status: 'succeeded', source: { registeredSlugs: ['hero'] } });
    expect(updated?.completedAt).toBeTruthy();
    expect(updated?.source).toEqual({ type: 'pi-task', registeredSlugs: ['hero'] });
    expect(await updateSession(FARM, 'missing', { status: 'failed' })).toBeNull();
    const archived = await patchSession(FARM, T1, { archived: true, title: 'Renamed' });
    expect(archived.status).toBe('archived');
    expect(archived.title).toBe('Renamed');
    expect((await listSessions(FARM)).map((s) => s.id)).toEqual([second.id]);
    expect((await listSessions(FARM, true)).length).toBe(2);
    expect((await patchSession(FARM, T1, { archived: false })).status).toBe('succeeded');
    expect((await patchSession(FARM, second.id, { archived: true })).status).toBe('archived');
    expect((await patchSession(FARM, second.id, { archived: false })).status).toBe('running');
    await expect(readSession(FARM, 'nope')).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
  });

  it('stores raw traces by task id', async () => {
    await seedProject();
    expect(await readTraceDocument(FARM, T1)).toBeNull();
    await writeTraceDocument(FARM, { version: 1, taskId: T1, projectSlug: FARM, steps: [{ name: 'a', model: 'm', messages: [{ role: 'user', content: 'x' }] }] });
    expect((await readTraceDocument(FARM, T1))?.steps[0].name).toBe('a');
  });
});
