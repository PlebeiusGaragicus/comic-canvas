/** The one module that touches OPFS. Paths are POSIX-style and mirror the old
 *  on-disk layout (`projects/<slug>/assets/<id>.png`). Writes use
 *  `createWritable()` from the main thread, which is atomic on close(). */
import { ServiceError } from '../services/errors';

export function isBlobStoreSupported(): boolean {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
    return false;
  }
  const proto = (globalThis as { FileSystemFileHandle?: { prototype: unknown } }).FileSystemFileHandle?.prototype as
    | { createWritable?: unknown }
    | undefined;
  return typeof proto?.createWritable === 'function';
}

function splitPath(path: string): string[] {
  const parts = path.split('/').filter((part) => part.length > 0);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new ServiceError(`Invalid blob path: ${path}`, { code: 'invalid' });
  }
  return parts;
}

async function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function directoryFor(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
  let dir = await root();
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part, { create });
    } catch (error) {
      if (!create && (error as DOMException)?.name === 'NotFoundError') return null;
      throw error;
    }
  }
  return dir;
}

export type BlobInput = Blob | ArrayBuffer | Uint8Array | string;

export async function writeBlob(path: string, data: BlobInput): Promise<void> {
  const parts = splitPath(path);
  const name = parts.pop();
  if (!name) throw new ServiceError('Blob path is empty', { code: 'invalid' });
  const dir = await directoryFor(parts, true);
  if (!dir) throw new ServiceError(`Cannot create directory for ${path}`, { code: 'storage' });
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data as FileSystemWriteChunkType);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // abort after a failed close throws; the original error is what matters
    }
    throw new ServiceError(`Failed to write ${path}`, { code: 'storage', cause: error });
  }
}

async function fileHandleFor(path: string): Promise<FileSystemFileHandle | null> {
  const parts = splitPath(path);
  const name = parts.pop();
  if (!name) return null;
  const dir = await directoryFor(parts, false);
  if (!dir) return null;
  try {
    return await dir.getFileHandle(name);
  } catch (error) {
    if ((error as DOMException)?.name === 'NotFoundError') return null;
    throw error;
  }
}

export async function readBlob(path: string): Promise<File> {
  const handle = await fileHandleFor(path);
  if (!handle) throw new ServiceError(`Missing file: ${path}`, { code: 'not-found' });
  return handle.getFile();
}

export async function readBlobOrNull(path: string): Promise<File | null> {
  const handle = await fileHandleFor(path);
  return handle ? handle.getFile() : null;
}

export async function readText(path: string): Promise<string> {
  const file = await readBlob(path);
  return file.text();
}

export async function blobExists(path: string): Promise<boolean> {
  return (await fileHandleFor(path)) !== null;
}

export async function deleteBlob(path: string): Promise<void> {
  const parts = splitPath(path);
  const name = parts.pop();
  if (!name) return;
  const dir = await directoryFor(parts, false);
  if (!dir) return;
  try {
    await dir.removeEntry(name);
  } catch (error) {
    if ((error as DOMException)?.name !== 'NotFoundError') throw error;
  }
}

/** Names of the entries directly under `path` (files and directories). */
export async function listDir(path: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
  const dir = await directoryFor(splitPath(path), false);
  if (!dir) return [];
  const out: Array<{ name: string; kind: 'file' | 'directory' }> = [];
  for await (const [name, handle] of dir.entries()) {
    out.push({ name, kind: handle.kind });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteDir(path: string): Promise<void> {
  const parts = splitPath(path);
  const name = parts.pop();
  if (!name) return;
  const parent = await directoryFor(parts, false);
  if (!parent) return;
  try {
    await parent.removeEntry(name, { recursive: true });
  } catch (error) {
    if ((error as DOMException)?.name !== 'NotFoundError') throw error;
  }
}

export async function wipeAllBlobs(): Promise<void> {
  const dir = await root();
  const names: string[] = [];
  for await (const name of dir.keys()) names.push(name);
  for (const name of names) await dir.removeEntry(name, { recursive: true });
}
