/** Project export/import in the old `~/.comic-canvas/projects/<slug>` layout:
 *
 *    project.json  canvas.json  tags.json
 *    assets/<id>.json  assets/<id>.png
 *    chat-sessions/<id>/session.json  chat-sessions/<id>/blobs/*
 *    story-panels/panels.json
 *    adaptation/adaptation.json  adaptation/book.txt
 *    adaptation/style-refs/visual-styles.json
 *    adaptation/concept-art/cards.json
 *    adaptation/sessions/agent-sessions/<id>/session.json
 *    adaptation/sessions/agent-traces/<taskId>.json   (browser-era addition)
 *
 *  Thumbnails, `panels.json.bak-*`, pi session files and `pi-tasks` are never
 *  exported and are ignored on import. */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import * as db from './db';
import { deleteDir, listDir, readBlobOrNull, writeBlob } from './blobs';
import { notifyChange } from './changes';
import { SLUG_RE } from '../services/common';
import { ServiceError, conflict, invalid } from '../services/errors';
import { assetPngPath, ensureThumbnail, projectBlobDir } from '../services/assetBlobs';
import { toAssetMetadata, validateAssetMetadata } from '../services/assets';
import { normalizeCanvasDocument } from '../services/canvas';
import { coerceTagDefinition, uniqueTags } from '../services/tags';
import type { AssetMetadata, ProjectMetadata, TagDefinition, TagRegistryDocument } from '../types';

// ---------------------------------------------------------------------------
// Export

type FileMap = Record<string, Uint8Array>;

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

async function blobBytes(path: string): Promise<Uint8Array | null> {
  const file = await readBlobOrNull(path);
  return file ? new Uint8Array(await file.arrayBuffer()) : null;
}

function chatSessionDir(slug: string, sessionId: string): string {
  return `${projectBlobDir(slug)}/chat-sessions/${sessionId}`;
}

function bookPath(slug: string): string {
  return `${projectBlobDir(slug)}/adaptation/book.txt`;
}

/** Every file of one project, keyed by path relative to the project folder. */
export async function collectProjectFiles(slug: string): Promise<FileMap> {
  const project = await db.getProjectDoc<ProjectMetadata>('projects', slug);
  if (!project) throw new ServiceError(`Project not found: ${slug}`, { code: 'not-found' });
  const files: FileMap = { 'project.json': jsonBytes(project) };

  const canvas = await db.getProjectDoc('canvas', slug);
  if (canvas !== undefined) files['canvas.json'] = jsonBytes(canvas);
  const tags = await db.getProjectDoc('tags', slug);
  if (tags !== undefined) files['tags.json'] = jsonBytes(tags);

  for (const { id, doc } of await db.listScopedDocs<AssetMetadata>('assets', slug)) {
    files[`assets/${id}.json`] = jsonBytes(doc);
    const png = await blobBytes(assetPngPath(slug, id));
    if (png) files[`assets/${id}.png`] = png;
  }

  for (const { id, doc } of await db.listScopedDocs('chatSessions', slug)) {
    files[`chat-sessions/${id}/session.json`] = jsonBytes(doc);
    for (const entry of await listDir(`${chatSessionDir(slug, id)}/blobs`)) {
      if (entry.kind !== 'file') continue;
      const bytes = await blobBytes(`${chatSessionDir(slug, id)}/blobs/${entry.name}`);
      if (bytes) files[`chat-sessions/${id}/blobs/${entry.name}`] = bytes;
    }
  }

  const storyPanels = await db.getProjectDoc('storyPanels', slug);
  if (storyPanels !== undefined) files['story-panels/panels.json'] = jsonBytes(storyPanels);
  const adaptation = await db.getProjectDoc('adaptation', slug);
  if (adaptation !== undefined) files['adaptation/adaptation.json'] = jsonBytes(adaptation);
  const book = await blobBytes(bookPath(slug));
  if (book) files['adaptation/book.txt'] = book;
  const visualStyles = await db.getProjectDoc('visualStyles', slug);
  if (visualStyles !== undefined) files['adaptation/style-refs/visual-styles.json'] = jsonBytes(visualStyles);

  const cards = await db.listScopedDocs('conceptCards', slug);
  if (cards.length) files['adaptation/concept-art/cards.json'] = jsonBytes(cards.map((row) => row.doc));
  for (const { id, doc } of await db.listScopedDocs('agentSessions', slug)) {
    files[`adaptation/sessions/agent-sessions/${id}/session.json`] = jsonBytes(doc);
  }
  for (const { id, doc } of await db.listScopedDocs('agentTraces', slug)) {
    files[`adaptation/sessions/agent-traces/${id}.json`] = jsonBytes(doc);
  }
  return files;
}

function zipBlob(files: Zippable): Blob {
  const bytes = zipSync(files, { level: 6 });
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
}

export async function exportProject(slug: string): Promise<Blob> {
  return zipBlob(await collectProjectFiles(slug));
}

/** One zip with a top-level folder per project slug. */
export async function exportAllProjects(): Promise<Blob> {
  const files: Zippable = {};
  for (const { slug } of await db.listProjectDocs('projects')) {
    const projectFiles = await collectProjectFiles(slug);
    for (const [path, bytes] of Object.entries(projectFiles)) files[`${slug}/${path}`] = bytes;
  }
  return zipBlob(files);
}

// ---------------------------------------------------------------------------
// Import

export type ImportSource = File | Blob | FileSystemDirectoryHandle;

export interface ImportOptions {
  /** `fail` (default) refuses a slug that already exists; `rename` picks `<slug>-2`, `<slug>-3`, ... */
  onConflict?: 'fail' | 'rename';
}

interface ArchiveReader {
  paths: string[];
  read(path: string): Promise<Uint8Array>;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

async function zipReader(source: Blob): Promise<ArchiveReader> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await source.arrayBuffer()));
  } catch (error) {
    throw new ServiceError('Not a valid zip archive', { code: 'invalid', cause: error });
  }
  const byPath = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/')) continue;
    byPath.set(normalizePath(path), bytes);
  }
  return {
    paths: [...byPath.keys()],
    read: async (path) => {
      const bytes = byPath.get(path);
      if (!bytes) throw new ServiceError(`Missing archive entry: ${path}`, { code: 'invalid' });
      return bytes;
    },
  };
}

async function directoryReader(root: FileSystemDirectoryHandle): Promise<ArchiveReader> {
  const handles = new Map<string, FileSystemFileHandle>();
  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    for await (const [name, handle] of dir.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, path);
      else handles.set(path, handle as FileSystemFileHandle);
    }
  }
  await walk(root, '');
  return {
    paths: [...handles.keys()],
    read: async (path) => {
      const handle = handles.get(path);
      if (!handle) throw new ServiceError(`Missing file: ${path}`, { code: 'invalid' });
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    },
  };
}

async function readerFor(source: ImportSource): Promise<ArchiveReader> {
  if (source instanceof Blob) return zipReader(source);
  return directoryReader(source);
}

/** Directories (relative prefixes, '' for the archive root) that hold a project.json. */
function projectRoots(paths: string[]): string[] {
  const roots = paths
    .filter((path) => path === 'project.json' || path.endsWith('/project.json'))
    .map((path) => path.slice(0, -'project.json'.length).replace(/\/$/, ''));
  // Keep only the outermost roots (a nested project.json inside another project is data, not a project).
  return roots.filter((root) => !roots.some((other) => other !== root && root.startsWith(other ? `${other}/` : '')));
}

/** Paths that never come back from an export: pi session files, tasks, backups, thumbnails, OS junk. */
export function shouldSkipImportPath(relative: string): boolean {
  const name = relative.split('/').pop() ?? relative;
  if (name === '.DS_Store' || name.endsWith('.tmp') || name.endsWith('.upload')) return true;
  if (/\.bak-/.test(name)) return true;
  if (name.endsWith('.thumb.webp')) return true;
  if (relative.startsWith('pi-tasks/') || relative.includes('/pi-tasks/')) return true;
  if (/^adaptation\/sessions\/pi[^/]*(\/|$)/.test(relative)) return true;
  return false;
}

function parseJson<T>(bytes: Uint8Array, path: string): T {
  try {
    return JSON.parse(strFromU8(bytes)) as T;
  } catch (error) {
    throw new ServiceError(`Invalid JSON: ${path}`, { code: 'invalid', cause: error });
  }
}

const DROPPED_AGENT_SESSION_FIELDS = ['piSessionId', 'piSessionFile', 'logFiles'] as const;

function stripAgentSession(doc: Record<string, unknown>, slug: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...doc, projectSlug: slug };
  for (const field of DROPPED_AGENT_SESSION_FIELDS) delete next[field];
  return next;
}

async function resolveSlug(requested: string, onConflict: 'fail' | 'rename'): Promise<string> {
  if (!SLUG_RE.test(requested)) throw invalid(`Invalid project slug in archive: ${requested}`);
  const exists = (await db.getProjectDoc('projects', requested)) !== undefined;
  if (!exists) return requested;
  if (onConflict !== 'rename') throw conflict(`Project already exists: ${requested}`);
  for (let counter = 2; ; counter += 1) {
    const candidate = `${requested}-${counter}`;
    if ((await db.getProjectDoc('projects', candidate)) === undefined) return candidate;
  }
}

async function importOne(reader: ArchiveReader, root: string, onConflict: 'fail' | 'rename'): Promise<string> {
  const prefix = root ? `${root}/` : '';
  const relativePaths = reader.paths
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .filter((path) => path && !shouldSkipImportPath(path));
  const read = (relative: string) => reader.read(`${prefix}${relative}`);
  const readJson = async <T>(relative: string): Promise<T> => parseJson<T>(await read(relative), relative);

  const rawProject = await readJson<Partial<ProjectMetadata> & { coverThumbnailUrl?: unknown }>('project.json');
  if (!rawProject || typeof rawProject.slug !== 'string' || typeof rawProject.name !== 'string') {
    throw invalid('project.json must have a slug and a name');
  }
  const slug = await resolveSlug(rawProject.slug, onConflict);
  const project: ProjectMetadata = {
    slug,
    name: rawProject.name,
    createdAt: typeof rawProject.createdAt === 'string' ? rawProject.createdAt : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    settings: rawProject.settings && typeof rawProject.settings === 'object' ? rawProject.settings : {},
    coverAssetId: typeof rawProject.coverAssetId === 'string' ? rawProject.coverAssetId : null,
  };

  try {
    await db.putProjectDoc('projects', slug, project);

    const tagsDoc = relativePaths.includes('tags.json') ? await readJson<Partial<TagRegistryDocument>>('tags.json') : { tags: [] };
    const tags = Array.isArray(tagsDoc?.tags) ? uniqueTags((tagsDoc.tags as TagDefinition[]).map(coerceTagDefinition)) : [];
    await db.putProjectDoc('tags', slug, { tags });

    const canvas = relativePaths.includes('canvas.json') ? normalizeCanvasDocument(await readJson('canvas.json')) : null;
    if (canvas) await db.putProjectDoc('canvas', slug, canvas);

    for (const relative of relativePaths) {
      const assetDoc = /^assets\/[^/]+\.json$/.exec(relative);
      if (assetDoc) {
        const metadata = validateAssetMetadata(toAssetMetadata(await readJson<AssetMetadata>(relative)));
        await db.putScopedDoc('assets', slug, metadata.id, metadata);
        continue;
      }
      const assetPng = /^assets\/([^/]+)\.png$/.exec(relative);
      if (assetPng) {
        await writeBlob(assetPngPath(slug, assetPng[1]), await read(relative));
        continue;
      }
      const chatSession = /^chat-sessions\/([^/]+)\/session\.json$/.exec(relative);
      if (chatSession) {
        const doc = await readJson<Record<string, unknown>>(relative);
        await db.putScopedDoc('chatSessions', slug, chatSession[1], { ...doc, projectSlug: slug });
        continue;
      }
      const chatBlob = /^chat-sessions\/([^/]+)\/blobs\/([^/]+)$/.exec(relative);
      if (chatBlob) {
        await writeBlob(`${chatSessionDir(slug, chatBlob[1])}/blobs/${chatBlob[2]}`, await read(relative));
        continue;
      }
      if (relative === 'story-panels/panels.json') {
        await db.putProjectDoc('storyPanels', slug, await readJson(relative));
        continue;
      }
      if (relative === 'adaptation/adaptation.json') {
        await db.putProjectDoc('adaptation', slug, await readJson(relative));
        continue;
      }
      if (relative === 'adaptation/book.txt') {
        await writeBlob(bookPath(slug), await read(relative));
        continue;
      }
      if (relative === 'adaptation/style-refs/visual-styles.json') {
        await db.putProjectDoc('visualStyles', slug, await readJson(relative));
        continue;
      }
      if (relative === 'adaptation/concept-art/cards.json') {
        const raw = await readJson<unknown>(relative);
        const cards = Array.isArray(raw) ? raw : ((raw as { cards?: unknown[] })?.cards ?? []);
        for (const card of cards as Array<Record<string, unknown>>) {
          if (typeof card?.id !== 'string') throw invalid('concept card without an id');
          await db.putScopedDoc('conceptCards', slug, card.id, { ...card, projectSlug: slug });
        }
        continue;
      }
      const agentSession = /^adaptation\/sessions\/agent-sessions\/([^/]+)\/session\.json$/.exec(relative);
      if (agentSession) {
        const doc = stripAgentSession(await readJson<Record<string, unknown>>(relative), slug);
        await db.putScopedDoc('agentSessions', slug, agentSession[1], doc);
        continue;
      }
      const agentTrace = /^adaptation\/sessions\/agent-traces\/([^/]+)\.json$/.exec(relative);
      if (agentTrace) {
        const doc = await readJson<Record<string, unknown>>(relative);
        await db.putScopedDoc('agentTraces', slug, agentTrace[1], { ...doc, projectSlug: slug });
        continue;
      }
      // Anything else (unknown files, old scratch data) is left out on purpose.
    }

    for (const { id } of await db.listScopedDocs('assets', slug)) await ensureThumbnail(slug, id);
  } catch (error) {
    await db.deleteProjectRows(slug);
    await deleteDir(projectBlobDir(slug));
    throw error;
  }
  notifyChange('projects', slug);
  return slug;
}

/** Import exactly one project from a zip or a picked directory. */
export async function importProject(source: ImportSource, options: ImportOptions = {}): Promise<{ slug: string }> {
  const reader = await readerFor(source);
  const roots = projectRoots(reader.paths);
  if (!roots.length) throw invalid('No project.json found in the archive');
  if (roots.length > 1) throw invalid(`Archive contains ${roots.length} projects; use importAllProjects`);
  return { slug: await importOne(reader, roots[0], options.onConflict ?? 'fail') };
}

/** Import every project found in the archive (the `exportAllProjects` layout). */
export async function importAllProjects(source: ImportSource, options: ImportOptions = {}): Promise<{ slugs: string[] }> {
  const reader = await readerFor(source);
  const roots = projectRoots(reader.paths);
  if (!roots.length) throw invalid('No project.json found in the archive');
  const slugs: string[] = [];
  for (const root of roots.sort()) slugs.push(await importOne(reader, root, options.onConflict ?? 'fail'));
  return { slugs };
}
