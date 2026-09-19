import { describe, expect, it } from 'vitest';
import { deleteAsset, deleteProject, emptyTrash, listTrash } from './trash';
import { listProjects } from './projects';
import { blobExists, listDir } from '../store/blobs';
import { listAllScopedDocs } from '../store/db';
import { cachedUrl, urlFor } from '../store/objectUrls';
import { assetPngPath, assetThumbPath } from './assetBlobs';
import { FARM, importedDoc, seedAsset, seedProject } from '../test/fixtures';

describe('trash', () => {
  it('lists newest first across projects and empties blobs, directories and rows', async () => {
    await seedProject();
    await seedProject('other', 'Other');
    await seedAsset(FARM, importedDoc('01HFIRST'));
    await seedAsset(FARM, importedDoc('01HSECOND'));
    await seedAsset('other', importedDoc('01HOTHER'));
    await urlFor(assetPngPath(FARM, '01HFIRST'));

    await deleteAsset(FARM, '01HFIRST');
    await deleteAsset(FARM, '01HSECOND');
    await deleteProject('other');
    const entries = await listTrash();
    expect(entries.map((entry) => `${entry.kind}:${entry.id}`).sort()).toEqual(['asset:01HFIRST', 'asset:01HSECOND', 'project:other']);
    expect(entries.every((entry) => entry.deletedAt)).toBe(true);
    expect(await blobExists(assetPngPath(FARM, '01HFIRST'))).toBe(true);
    expect(await blobExists(assetPngPath('other', '01HOTHER'))).toBe(true);

    await emptyTrash();
    expect(await listTrash()).toEqual([]);
    expect(await listAllScopedDocs('trash')).toEqual([]);
    expect(await blobExists(assetPngPath(FARM, '01HFIRST'))).toBe(false);
    expect(await blobExists(assetThumbPath(FARM, '01HFIRST'))).toBe(false);
    expect(await blobExists(assetPngPath(FARM, '01HSECOND'))).toBe(false);
    expect(await listDir('projects/other')).toEqual([]);
    expect(cachedUrl(assetPngPath(FARM, '01HFIRST'))).toBeNull();
    expect((await listProjects()).map((project) => project.slug)).toEqual([FARM]);
    // Emptying an empty trash is fine.
    await emptyTrash();
  });

  it('deleting a project also discards its earlier asset trash entries (the directory covers them)', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HX'));
    await deleteAsset(FARM, '01HX');
    await deleteProject(FARM);
    const entries = await listTrash();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'project', id: FARM });
    await emptyTrash();
    expect(await blobExists(assetPngPath(FARM, '01HX'))).toBe(false);
  });
});
