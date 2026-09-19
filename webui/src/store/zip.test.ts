import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { collectProjectFiles, exportAllProjects, exportProject, importAllProjects, importProject, shouldSkipImportPath } from './zip';
import * as db from './db';
import { blobExists, readBlob, writeBlob } from './blobs';
import { assetPngPath, assetThumbPath } from '../services/assetBlobs';
import { listAssets, readAsset } from '../services/assets';
import { readStoredCanvas, writeCanvas } from '../services/canvas';
import { listProjects } from '../services/projects';
import { writeTagRegistry } from '../services/tags';
import { isServiceError } from '../services/errors';
import { FARM, STAMP, generatedDoc, importedDoc, pngBytes, seedAsset, seedProject } from '../test/fixtures';

async function bytesOf(path: string): Promise<Uint8Array> {
  return new Uint8Array(await (await readBlob(path)).arrayBuffer());
}

async function seedFullProject(slug = FARM) {
  await seedProject(slug, 'Farm Comic');
  await seedAsset(slug, importedDoc('01HIMP', { title: 'Imported', tags: ['mood'] }), { variant: 11 });
  await seedAsset(slug, generatedDoc('01HGEN', 'a prompt', ['01HIMP']), { variant: 12 });
  await writeTagRegistry(slug, { tags: [{ id: 'mood', name: 'Mood', color: '#123456' }] });
  const canvas = await readStoredCanvas(slug);
  canvas.nodes.board = { displayName: 'Board', x: 1, y: 2, tags: [], refs: ['01HIMP'], prompt: 'p', params: { batchCount: 2 }, assetIds: ['01HGEN'] };
  await writeCanvas(slug, canvas);
  await db.putScopedDoc('chatSessions', slug, 'sess1', { version: 1, id: 'sess1', projectSlug: slug, title: 'Chat', turns: [], protectedAssetIds: [], source: { assetId: '01HIMP' } });
  await writeBlob(`projects/${slug}/chat-sessions/sess1/blobs/01HBLOB.png`, pngBytes(21));
  await db.putProjectDoc('storyPanels', slug, { version: 1, bookSource: '', pages: [], panels: [] });
  await db.putProjectDoc('adaptation', slug, { version: 4, characters: {}, locations: {} });
  await writeBlob(`projects/${slug}/adaptation/book.txt`, 'Once upon a time.');
  await db.putProjectDoc('visualStyles', slug, [{ id: 'crayons', name: 'Crayons', prompt: 'crayon', default: true }]);
  await db.putScopedDoc('conceptCards', slug, 'card1', { version: 1, id: 'card1', projectSlug: slug, subjectKind: 'character', displayName: 'Card', prompt: '', assetIds: [], createdAt: STAMP, updatedAt: STAMP });
  await db.putScopedDoc('agentSessions', slug, 'agent1', { version: 1, id: 'agent1', projectSlug: slug, title: 'Extract', kind: 'extract-characters', status: 'succeeded', createdAt: STAMP, updatedAt: STAMP, source: {}, traceId: 'task1' });
  await db.putScopedDoc('agentTraces', slug, 'task1', { version: 1, taskId: 'task1', projectSlug: slug, steps: [] });
}

describe('zip export', () => {
  it('writes the old library layout without thumbnails', async () => {
    await seedFullProject();
    await readAsset(FARM, '01HIMP'); // generates the thumbnail
    expect(await blobExists(assetThumbPath(FARM, '01HIMP'))).toBe(true);
    const files = await collectProjectFiles(FARM);
    expect(Object.keys(files).sort()).toEqual(
      [
        'project.json',
        'canvas.json',
        'tags.json',
        'assets/01HIMP.json',
        'assets/01HIMP.png',
        'assets/01HGEN.json',
        'assets/01HGEN.png',
        'chat-sessions/sess1/session.json',
        'chat-sessions/sess1/blobs/01HBLOB.png',
        'story-panels/panels.json',
        'adaptation/adaptation.json',
        'adaptation/book.txt',
        'adaptation/style-refs/visual-styles.json',
        'adaptation/concept-art/cards.json',
        'adaptation/sessions/agent-sessions/agent1/session.json',
        'adaptation/sessions/agent-traces/task1.json',
      ].sort(),
    );
    expect(JSON.parse(strFromU8(files['project.json']))).toMatchObject({ slug: FARM, name: 'Farm Comic' });
    expect(JSON.parse(strFromU8(files['assets/01HIMP.json']))).not.toHaveProperty('thumbnailUrl');
    expect(files['assets/01HIMP.png']).toEqual(pngBytes(11));
    expect(JSON.parse(strFromU8(files['adaptation/concept-art/cards.json']))).toHaveLength(1);

    const zip = await exportProject(FARM);
    expect(zip.type).toBe('application/zip');
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(Object.keys(files).sort());
  });

  it('exports every project under its slug', async () => {
    await seedProject('a', 'A');
    await seedProject('b', 'B');
    const entries = unzipSync(new Uint8Array(await (await exportAllProjects()).arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['a/canvas.json', 'a/project.json', 'a/tags.json', 'b/canvas.json', 'b/project.json', 'b/tags.json']);
  });
});

describe('zip import', () => {
  it('round-trips into a fresh database with equal documents and bytes', async () => {
    await seedFullProject();
    const before = {
      project: await db.getProjectDoc('projects', FARM),
      canvas: await db.getProjectDoc('canvas', FARM),
      tags: await db.getProjectDoc('tags', FARM),
      assets: await db.listScopedDocs('assets', FARM),
      chat: await db.listScopedDocs('chatSessions', FARM),
      panels: await db.getProjectDoc('storyPanels', FARM),
      adaptation: await db.getProjectDoc('adaptation', FARM),
      styles: await db.getProjectDoc('visualStyles', FARM),
      cards: await db.listScopedDocs('conceptCards', FARM),
      agents: await db.listScopedDocs('agentSessions', FARM),
      traces: await db.listScopedDocs('agentTraces', FARM),
    };
    const zip = await exportProject(FARM);

    // Fresh database and blob root.
    await db.wipeDatabase();
    (globalThis as Record<string, unknown>).indexedDB = new (await import('fake-indexeddb')).IDBFactory();
    db.resetDbConnectionForTests();
    const { resetOpfsShim } = await import('../test/opfsShim');
    resetOpfsShim();
    expect(await listProjects()).toEqual([]);

    const { slug } = await importProject(new File([zip], 'farm.zip', { type: 'application/zip' }));
    expect(slug).toBe(FARM);
    expect(await db.getProjectDoc('projects', FARM)).toEqual(before.project);
    expect(await db.getProjectDoc('canvas', FARM)).toEqual(before.canvas);
    expect(await db.getProjectDoc('tags', FARM)).toEqual(before.tags);
    expect(await db.listScopedDocs('assets', FARM)).toEqual(before.assets);
    expect(await db.listScopedDocs('chatSessions', FARM)).toEqual(before.chat);
    expect(await db.getProjectDoc('storyPanels', FARM)).toEqual(before.panels);
    expect(await db.getProjectDoc('adaptation', FARM)).toEqual(before.adaptation);
    expect(await db.getProjectDoc('visualStyles', FARM)).toEqual(before.styles);
    expect(await db.listScopedDocs('conceptCards', FARM)).toEqual(before.cards);
    expect(await db.listScopedDocs('agentSessions', FARM)).toEqual(before.agents);
    expect(await db.listScopedDocs('agentTraces', FARM)).toEqual(before.traces);
    expect(await bytesOf(assetPngPath(FARM, '01HIMP'))).toEqual(pngBytes(11));
    expect(await bytesOf(assetPngPath(FARM, '01HGEN'))).toEqual(pngBytes(12));
    expect(await bytesOf(`projects/${FARM}/chat-sessions/sess1/blobs/01HBLOB.png`)).toEqual(pngBytes(21));
    expect(strFromU8(await bytesOf(`projects/${FARM}/adaptation/book.txt`))).toBe('Once upon a time.');
    // Thumbnails were regenerated on import.
    expect(await blobExists(assetThumbPath(FARM, '01HIMP'))).toBe(true);
    expect((await listAssets(FARM)).map((asset) => asset.id)).toEqual(['01HGEN', '01HIMP']);
  });

  it('refuses slug collisions unless renaming, and rewrites projectSlug fields', async () => {
    await seedFullProject();
    const zip = await exportProject(FARM);
    await expect(importProject(zip)).rejects.toSatisfy((error) => isServiceError(error, 'conflict'));
    const { slug } = await importProject(zip, { onConflict: 'rename' });
    expect(slug).toBe(`${FARM}-2`);
    expect((await db.getProjectDoc<{ slug: string }>('projects', slug))?.slug).toBe(slug);
    expect((await db.listScopedDocs<{ projectSlug: string }>('chatSessions', slug))[0].doc.projectSlug).toBe(slug);
    expect((await db.listScopedDocs<{ projectSlug: string }>('agentSessions', slug))[0].doc.projectSlug).toBe(slug);
    expect(await blobExists(assetPngPath(slug, '01HIMP'))).toBe(true);
    expect((await listProjects()).map((project) => project.slug)).toEqual([FARM, slug]);
  });

  it('ignores pi files, backups and thumbnails, strips ledger fields and reads folders or nested archives', async () => {
    const files: Record<string, Uint8Array> = {
      'wrapper/project.json': strToU8(JSON.stringify({ slug: 'legacy', name: 'Legacy', createdAt: STAMP, settings: {}, coverThumbnailUrl: '/api/x' })),
      'wrapper/canvas.json': strToU8(JSON.stringify({ version: 2, viewport: { x: 0, y: 0, zoom: 1 }, nodes: { n: { displayName: 'n', x: 0, y: 0, assetIds: ['01HA'] } } })),
      'wrapper/assets/01HA.json': strToU8(JSON.stringify({ ...importedDoc('01HA'), thumbnailUrl: '/api/thumb', hasPixels: true })),
      'wrapper/assets/01HA.png': pngBytes(5),
      'wrapper/assets/01HA.thumb.webp': new Uint8Array([1, 2, 3]),
      'wrapper/story-panels/panels.json': strToU8(JSON.stringify({ version: 1, panels: [] })),
      'wrapper/story-panels/panels.json.bak-2026': strToU8('{}'),
      'wrapper/adaptation/sessions/pi-sessions/x.jsonl': strToU8('{}'),
      'wrapper/adaptation/sessions/pi-tasks/t.json': strToU8('{}'),
      'wrapper/pi-tasks/t.json': strToU8('{}'),
      'wrapper/adaptation/sessions/agent-sessions/s1/session.json': strToU8(
        JSON.stringify({ version: 1, id: 's1', projectSlug: 'legacy', piSessionId: 'pi', piSessionFile: '/tmp/x', logFiles: ['a'], status: 'failed' }),
      ),
      'wrapper/.DS_Store': new Uint8Array([0]),
    };
    expect(shouldSkipImportPath('adaptation/sessions/pi-sessions/x.jsonl')).toBe(true);
    expect(shouldSkipImportPath('adaptation/sessions/agent-sessions/s1/session.json')).toBe(false);
    expect(shouldSkipImportPath('assets/a.thumb.webp')).toBe(true);
    expect(shouldSkipImportPath('story-panels/panels.json.bak-2026')).toBe(true);

    const zip = new Blob([zipSync(files) as BlobPart]);
    const { slug } = await importProject(zip);
    expect(slug).toBe('legacy');
    expect(await db.getProjectDoc('projects', 'legacy')).toEqual({ slug: 'legacy', name: 'Legacy', createdAt: STAMP, settings: {}, coverAssetId: null });
    const asset = (await db.getScopedDoc<Record<string, unknown>>('assets', 'legacy', '01HA'))!;
    expect(asset).not.toHaveProperty('thumbnailUrl');
    expect(asset).not.toHaveProperty('hasPixels');
    expect(await bytesOf(assetPngPath('legacy', '01HA'))).toEqual(pngBytes(5));
    expect(await bytesOf(assetThumbPath('legacy', '01HA'))).not.toEqual(new Uint8Array([1, 2, 3]));
    const agent = (await db.getScopedDoc<Record<string, unknown>>('agentSessions', 'legacy', 's1'))!;
    expect(agent).toEqual({ version: 1, id: 's1', projectSlug: 'legacy', status: 'failed' });
    expect((await db.getProjectDoc<{ nodes: Record<string, { activeAssetId: string | null }> }>('canvas', 'legacy'))?.nodes.n.activeAssetId).toBe('01HA');
    expect(await db.getProjectDoc('tags', 'legacy')).toEqual({ tags: [] });

    // Directory import through a FileSystemDirectoryHandle (the OPFS shim provides one).
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('picked', { create: true });
    for (const [path, bytes] of Object.entries(files)) {
      const parts = path.split('/').slice(1);
      let dir = folder;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes as FileSystemWriteChunkType);
      await writable.close();
    }
    const fromDir = await importProject(folder, { onConflict: 'rename' });
    expect(fromDir.slug).toBe('legacy-2');
    expect(await bytesOf(assetPngPath('legacy-2', '01HA'))).toEqual(pngBytes(5));
  });

  it('imports every project of an export-all archive and rejects archives without one', async () => {
    await seedProject('a', 'A');
    await seedProject('b', 'B');
    const all = await exportAllProjects();
    await expect(importProject(all)).rejects.toSatisfy((error) => isServiceError(error, 'invalid') && /2 projects/.test(error.message));
    const { slugs } = await importAllProjects(all, { onConflict: 'rename' });
    expect(slugs).toEqual(['a-2', 'b-2']);
    await expect(importProject(new Blob([zipSync({ 'readme.txt': strToU8('x') }) as BlobPart]))).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    await expect(importProject(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
  });

  it('rolls back a half-imported project when a document is invalid', async () => {
    const files = {
      'project.json': strToU8(JSON.stringify({ slug: 'broken', name: 'Broken' })),
      'assets/01HBAD.json': strToU8(JSON.stringify({ ...importedDoc('01HBAD'), prompt: { text: 'not allowed on imported' } })),
      'assets/01HBAD.png': pngBytes(1),
    };
    await expect(importProject(new Blob([zipSync(files) as BlobPart]))).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    expect(await db.getProjectDoc('projects', 'broken')).toBeUndefined();
    expect(await blobExists(assetPngPath('broken', '01HBAD'))).toBe(false);
  });
});
