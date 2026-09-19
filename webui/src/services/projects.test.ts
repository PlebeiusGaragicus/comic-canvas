import { describe, expect, it } from 'vitest';
import { createProject, getProject, getProjectDetail, listProjects, patchProjectCover } from './projects';
import { deleteAsset, deleteProject, listTrash } from './trash';
import { readCanvas, DEFAULT_STARTER_DRAFT_NODE_ID, listSeedDefaultPrompts } from './canvas';
import { getProjectDoc } from '../store/db';
import { blobExists } from '../store/blobs';
import { assetPngPath } from './assetBlobs';
import { isServiceError } from './errors';
import { FARM, importedDoc, seedAsset, seedProject } from '../test/fixtures';

describe('projects', () => {
  it('creates a project with a seeded canvas and lists it', async () => {
    await seedProject();
    const projects = await listProjects();
    expect(projects.map((project) => project.slug)).toEqual([FARM]);
    expect(projects[0].coverThumbnailUrl).toBeNull();

    const canvas = await readCanvas(FARM);
    const starter = canvas.nodes[DEFAULT_STARTER_DRAFT_NODE_ID];
    expect(starter.assetIds).toEqual([]);
    expect(starter.refs).toEqual([]);
    const prompts = new Set(listSeedDefaultPrompts().map((seed) => seed.prompt));
    expect(prompts.size).toBeGreaterThan(0);
    expect(prompts.has(starter.prompt)).toBe(true);
    expect(canvas.nodes.style_character.tags).toContain('character-style');
    expect(canvas.nodes.style_scene.tags).toContain('scene-style');
    expect(canvas.nodes.style_character.assetIds).toEqual([]);
  });

  it('refuses duplicate slugs, bad slugs and empty names', async () => {
    await seedProject();
    await expect(seedProject()).rejects.toSatisfy((error) => isServiceError(error, 'conflict'));
    await expect(createProject({ slug: 'Bad Slug', name: 'x' })).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    await expect(createProject({ slug: 'ok', name: '' })).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    await expect(getProject('missing')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });

  it('never persists the derived cover url and resolves it on read', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HCOVER', { title: 'Cover' }));
    const patched = await patchProjectCover(FARM, '01HCOVER');
    expect(patched.coverAssetId).toBe('01HCOVER');
    expect(patched.coverThumbnailUrl).toMatch(/^blob:/);
    const stored = await getProjectDoc<Record<string, unknown>>('projects', FARM);
    expect(stored).not.toHaveProperty('coverThumbnailUrl');
    expect((await listProjects())[0].coverThumbnailUrl).toMatch(/^blob:/);

    await deleteAsset(FARM, '01HCOVER');
    expect((await getProjectDetail(FARM)).project.coverAssetId).toBeNull();
  });

  it('rejects a cover without pixels', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HNOPIX'), { pixels: false });
    await expect(patchProjectCover(FARM, '01HNOPIX')).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    await expect(patchProjectCover(FARM, 'nope')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });

  it('returns assets and tags in the detail view', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HDETAIL', { archivedAt: '2026-01-02T00:00:00Z' }));
    expect((await getProjectDetail(FARM)).assets).toEqual([]);
    const detail = await getProjectDetail(FARM, true);
    expect(detail.assets.map((asset) => asset.id)).toEqual(['01HDETAIL']);
    expect(detail.tags).toEqual([]);
  });

  it('moves a deleted project to the trash and keeps its blobs until emptied', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HKEEP'));
    await deleteProject(FARM);
    expect(await listProjects()).toEqual([]);
    expect(await getProjectDoc('canvas', FARM)).toBeUndefined();
    expect(await blobExists(assetPngPath(FARM, '01HKEEP'))).toBe(true);
    const trash = await listTrash();
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ kind: 'project', id: FARM, slug: FARM, blobPaths: [`projects/${FARM}`] });
    await expect(deleteProject(FARM)).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
  });
});
