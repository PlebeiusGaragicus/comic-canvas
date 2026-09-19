/** The one module that touches IndexedDB. Documents are stored as plain JSON
 *  records; blobs live in OPFS (see blobs.ts). Feature modules go through the
 *  functions here, never through `idb` directly. */
import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const DB_NAME = 'comic-canvas';
export const DB_VERSION = 1;

/** Stores keyed by project slug: one document per project. */
export type ProjectDocStore = 'projects' | 'canvas' | 'tags' | 'storyPanels' | 'adaptation' | 'visualStyles';
/** Stores keyed by `[slug, id]`: many documents per project. */
export type ScopedDocStore = 'assets' | 'chatSessions' | 'conceptCards' | 'agentSessions' | 'agentTraces' | 'trash';

export const PROJECT_DOC_STORES: readonly ProjectDocStore[] = ['projects', 'canvas', 'tags', 'storyPanels', 'adaptation', 'visualStyles'];
export const SCOPED_DOC_STORES: readonly ScopedDocStore[] = ['assets', 'chatSessions', 'conceptCards', 'agentSessions', 'agentTraces', 'trash'];

interface ProjectRecord {
  slug: string;
  doc: unknown;
}

interface ScopedRecord {
  slug: string;
  id: string;
  doc: unknown;
}

interface SettingRecord {
  key: string;
  value: unknown;
}

type ProjectStores = { [K in ProjectDocStore]: { key: string; value: ProjectRecord } };
type ScopedStores = { [K in ScopedDocStore]: { key: [string, string]; value: ScopedRecord; indexes: { slug: string } } };

interface ComicCanvasSchema extends DBSchema, ProjectStores, ScopedStores {
  settings: { key: string; value: SettingRecord };
}

let dbPromise: Promise<IDBPDatabase<ComicCanvasSchema>> | null = null;

function open(): Promise<IDBPDatabase<ComicCanvasSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<ComicCanvasSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const store of PROJECT_DOC_STORES) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'slug' });
        }
        for (const store of SCOPED_DOC_STORES) {
          if (!db.objectStoreNames.contains(store)) {
            const os = db.createObjectStore(store, { keyPath: ['slug', 'id'] });
            os.createIndex('slug', 'slug');
          }
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      },
      blocked() {
        console.error('comic-canvas: database upgrade blocked by another tab');
      },
    });
  }
  return dbPromise;
}

export async function getProjectDoc<T>(store: ProjectDocStore, slug: string): Promise<T | undefined> {
  const db = await open();
  const record = await db.get(store, slug);
  return record?.doc as T | undefined;
}

export async function putProjectDoc<T>(store: ProjectDocStore, slug: string, doc: T): Promise<void> {
  const db = await open();
  await db.put(store, { slug, doc });
}

export async function deleteProjectDoc(store: ProjectDocStore, slug: string): Promise<void> {
  const db = await open();
  await db.delete(store, slug);
}

export async function listProjectDocs<T>(store: ProjectDocStore): Promise<Array<{ slug: string; doc: T }>> {
  const db = await open();
  const records = await db.getAll(store);
  return records.map((record) => ({ slug: record.slug, doc: record.doc as T }));
}

export async function getScopedDoc<T>(store: ScopedDocStore, slug: string, id: string): Promise<T | undefined> {
  const db = await open();
  const record = await db.get(store, [slug, id]);
  return record?.doc as T | undefined;
}

export async function putScopedDoc<T>(store: ScopedDocStore, slug: string, id: string, doc: T): Promise<void> {
  const db = await open();
  await db.put(store, { slug, id, doc });
}

export async function deleteScopedDoc(store: ScopedDocStore, slug: string, id: string): Promise<void> {
  const db = await open();
  await db.delete(store, [slug, id]);
}

export async function listScopedDocs<T>(store: ScopedDocStore, slug: string): Promise<Array<{ id: string; doc: T }>> {
  const db = await open();
  const records = await db.getAllFromIndex(store, 'slug', slug);
  return records.map((record) => ({ id: record.id, doc: record.doc as T }));
}

/** Remove every row for a project across all stores (one transaction). */
export async function deleteProjectRows(slug: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([...PROJECT_DOC_STORES, ...SCOPED_DOC_STORES], 'readwrite');
  for (const store of PROJECT_DOC_STORES) {
    await tx.objectStore(store).delete(slug);
  }
  for (const store of SCOPED_DOC_STORES) {
    const keys = await tx.objectStore(store).index('slug').getAllKeys(slug);
    for (const key of keys) await tx.objectStore(store).delete(key);
  }
  await tx.done;
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await open();
  const record = await db.get('settings', key);
  return record?.value as T | undefined;
}

export async function putSetting<T>(key: string, value: T): Promise<void> {
  const db = await open();
  await db.put('settings', { key, value });
}

/** Delete the whole database (settings included). Blobs are wiped separately. */
export async function wipeDatabase(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await deleteDB(DB_NAME);
}

/** Test hook: drop the cached connection so the next call reopens. */
export function resetDbConnectionForTests(): void {
  dbPromise = null;
}
