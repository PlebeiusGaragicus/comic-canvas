/** Projects (ported from api/library.py). Sits above canvas/assets/tags; the
 *  low-level document helpers live in `projectDocs.ts` and are re-exported. */
import { listProjectDocs, putProjectDoc } from '../store/db';
import { notifyChange } from '../store/changes';
import { requestPersistentStorage } from '../store/persist';
import { SLUG_RE, utcNow } from './common';
import { conflict, invalid } from './errors';
import { assetHasPixels, assetThumbnailUrl } from './assetBlobs';
import { listAssets, readAsset, readAssetMetadataOrNull } from './assets';
import { defaultCanvasForNewProject } from './canvas';
import { projectExists, readProjectMetadata, requireProject, writeProjectMetadata } from './projectDocs';
import { listProjectTags } from './tags';
import type { Project, ProjectCreatePayload, ProjectDetail, ProjectMetadata } from '../types';

export { projectExists, readProjectMetadata, requireProject, writeProjectMetadata } from './projectDocs';
export { deleteProject } from './trash';

/** Resolve the derived cover thumbnail URL (never persisted). */
export async function enrichProject(slug: string, project: ProjectMetadata): Promise<Project> {
  const coverId = project.coverAssetId ?? null;
  let coverThumbnailUrl: string | null = null;
  if (coverId && (await readAssetMetadataOrNull(slug, coverId)) && (await assetHasPixels(slug, coverId))) {
    coverThumbnailUrl = await assetThumbnailUrl(slug, coverId);
  }
  return { ...project, coverThumbnailUrl };
}

export async function listProjects(): Promise<Project[]> {
  const rows = await listProjectDocs<ProjectMetadata>('projects');
  rows.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const projects: Project[] = [];
  for (const row of rows) projects.push(await enrichProject(row.slug, row.doc));
  return projects;
}

export async function createProject(payload: ProjectCreatePayload): Promise<Project> {
  if (typeof payload.slug !== 'string' || !SLUG_RE.test(payload.slug)) throw invalid(`Invalid project slug: ${String(payload.slug)}`);
  if (typeof payload.name !== 'string' || !payload.name.length) throw invalid('Project name is required');
  if (await projectExists(payload.slug)) throw conflict(`Project already exists: ${payload.slug}`);
  const firstProject = (await listProjectDocs('projects')).length === 0;
  const project: ProjectMetadata = {
    slug: payload.slug,
    name: payload.name,
    createdAt: utcNow(),
    settings: payload.settings ?? {},
    coverAssetId: null,
  };
  await putProjectDoc('projects', payload.slug, project);
  await putProjectDoc('tags', payload.slug, { tags: [] });
  await putProjectDoc('canvas', payload.slug, defaultCanvasForNewProject());
  notifyChange('projects', payload.slug);
  if (firstProject) await requestPersistentStorage();
  return enrichProject(payload.slug, project);
}

export async function getProject(slug: string): Promise<Project> {
  return enrichProject(slug, await readProjectMetadata(slug));
}

export async function patchProjectCover(slug: string, coverAssetId: string | null): Promise<Project> {
  const project = await readProjectMetadata(slug);
  if (coverAssetId !== null) {
    const asset = await readAsset(slug, coverAssetId);
    if (!asset.hasPixels) throw invalid('Cover asset must have image pixels');
  }
  const saved = await writeProjectMetadata(slug, { ...project, coverAssetId });
  return enrichProject(slug, saved);
}

export async function getProjectDetail(slug: string, includeArchived = false): Promise<ProjectDetail> {
  return {
    project: await getProject(slug),
    assets: await listAssets(slug, includeArchived),
    tags: await listProjectTags(slug),
  };
}
