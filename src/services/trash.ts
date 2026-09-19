/** Soft deletion. Deleted documents move to the `trash` store with the blob
 *  paths they own; the bytes stay in OPFS until `emptyTrash()`. */
import { deleteProjectRows, deleteScopedDoc, listAllScopedDocs, putScopedDoc } from '../store/db';
import { deleteBlob, deleteDir } from '../store/blobs';
import { invalidateUrl, releaseProject } from '../store/objectUrls';
import { notifyChange } from '../store/changes';
import { utcNow } from './common';
import { conflict, notFound } from './errors';
import { assetPngPath, assetThumbPath, projectBlobDir } from './assetBlobs';
import { readAssetMetadataOrNull } from './assets';
import { detachAssetFromProject } from './canvas';
import { blockingSessionIds } from './chatSessions';
import { readProjectMetadata } from './projectDocs';
import type { TrashEntry } from '../types';

export interface TrashRow extends TrashEntry {
  /** The project the entry belonged to. */
  slug: string;
}

function trashKey(kind: TrashEntry['kind'], id: string): string {
  return `${kind}:${id}`;
}

/** Move an asset to the trash. Refuses when a chat session's history references it. */
export async function deleteAsset(slug: string, assetId: string): Promise<void> {
  await readProjectMetadata(slug);
  const metadata = await readAssetMetadataOrNull(slug, assetId);
  if (!metadata) throw notFound(`Asset not found: ${assetId}`);
  const blockers = await blockingSessionIds(slug, assetId);
  if (blockers.length) {
    throw conflict('Asset is protected by chat session history. Archive it instead.', { chatSessionIds: blockers });
  }
  const entry: TrashEntry = {
    kind: 'asset',
    id: assetId,
    deletedAt: utcNow(),
    doc: metadata,
    blobPaths: [assetPngPath(slug, assetId), assetThumbPath(slug, assetId)],
  };
  await putScopedDoc('trash', slug, trashKey('asset', assetId), entry);
  await deleteScopedDoc('assets', slug, assetId);
  notifyChange('assets', slug);
  notifyChange('trash', slug);
  await detachAssetFromProject(slug, assetId);
}

/** Move a whole project to the trash: every document row goes, the blob directory stays until emptied. */
export async function deleteProject(slug: string): Promise<void> {
  const project = await readProjectMetadata(slug);
  await deleteProjectRows(slug);
  const entry: TrashEntry = {
    kind: 'project',
    id: slug,
    deletedAt: utcNow(),
    doc: project,
    blobPaths: [projectBlobDir(slug)],
  };
  await putScopedDoc('trash', slug, trashKey('project', slug), entry);
  releaseProject(slug);
  notifyChange('projects', slug);
  notifyChange('trash', slug);
}

export async function listTrash(): Promise<TrashRow[]> {
  const rows = await listAllScopedDocs<TrashEntry>('trash');
  return rows
    .map((row) => ({ ...row.doc, slug: row.slug }))
    .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0));
}

/** Permanently delete every trashed blob and drop the entries. */
export async function emptyTrash(): Promise<void> {
  const rows = await listAllScopedDocs<TrashEntry>('trash');
  for (const row of rows) {
    for (const path of row.doc.blobPaths) {
      if (row.doc.kind === 'project') {
        await deleteDir(path);
        releaseProject(row.slug);
      } else {
        await deleteBlob(path);
        invalidateUrl(path);
      }
    }
    await deleteScopedDoc('trash', row.slug, row.id);
  }
  notifyChange('trash', null);
}
