/** Storage seam. `OpfsStore` is the shipping implementation (IndexedDB
 *  documents + OPFS blobs). A `DirectoryStore` mirroring a real folder via the
 *  File System Access API can implement the same interface later. */
import * as db from './db';
import * as blobs from './blobs';

export interface DocStore {
  getProjectDoc: typeof db.getProjectDoc;
  putProjectDoc: typeof db.putProjectDoc;
  deleteProjectDoc: typeof db.deleteProjectDoc;
  listProjectDocs: typeof db.listProjectDocs;
  getScopedDoc: typeof db.getScopedDoc;
  putScopedDoc: typeof db.putScopedDoc;
  deleteScopedDoc: typeof db.deleteScopedDoc;
  listScopedDocs: typeof db.listScopedDocs;
  deleteProjectRows: typeof db.deleteProjectRows;
}

export interface BlobStore {
  writeBlob: typeof blobs.writeBlob;
  readBlob: typeof blobs.readBlob;
  readBlobOrNull: typeof blobs.readBlobOrNull;
  readText: typeof blobs.readText;
  blobExists: typeof blobs.blobExists;
  deleteBlob: typeof blobs.deleteBlob;
  listDir: typeof blobs.listDir;
  deleteDir: typeof blobs.deleteDir;
}

export interface ProjectStore {
  readonly kind: 'opfs' | 'directory';
  readonly docs: DocStore;
  readonly blobs: BlobStore;
}

export const opfsStore: ProjectStore = {
  kind: 'opfs',
  docs: db,
  blobs,
};

let active: ProjectStore = opfsStore;

export function projectStore(): ProjectStore {
  return active;
}

export function setProjectStore(store: ProjectStore): void {
  active = store;
}
