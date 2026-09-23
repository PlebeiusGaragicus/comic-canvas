/** Project document access and existence checks. Leaf module so that every
 *  feature service can `requireProject` without importing `projects.ts`
 *  (which sits above canvas/assets/tags). */
import { getProjectDoc, putProjectDoc } from '../store/db';
import { notifyChange } from '../store/changes';
import { notFound } from './errors';
import type { Project, ProjectMetadata } from '../types';

export async function projectExists(slug: string): Promise<boolean> {
  return (await getProjectDoc<ProjectMetadata>('projects', slug)) !== undefined;
}

export async function requireProject(slug: string): Promise<void> {
  if (!(await projectExists(slug))) throw notFound(`Project not found: ${slug}`);
}

export async function readProjectMetadata(slug: string): Promise<ProjectMetadata> {
  const doc = await getProjectDoc<ProjectMetadata>('projects', slug);
  if (!doc) throw notFound(`Project not found: ${slug}`);
  return doc;
}

/** Persist the project document, stripping the derived cover URL. */
export async function writeProjectMetadata(slug: string, project: ProjectMetadata | Project): Promise<ProjectMetadata> {
  const { coverThumbnailUrl: _derived, ...doc } = project as Project;
  await putProjectDoc('projects', slug, doc);
  notifyChange('projects', slug);
  return doc;
}
