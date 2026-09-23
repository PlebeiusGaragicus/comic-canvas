/** Object URLs for blobs, cached per path for as long as a project is open.
 *  Views render `<img src>` from these; they are never persisted. */
import { readBlobOrNull } from './blobs';

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export async function urlFor(path: string): Promise<string | null> {
  const cached = urls.get(path);
  if (cached) return cached;
  const inflight = pending.get(path);
  if (inflight) return inflight;
  const task = (async () => {
    const file = await readBlobOrNull(path);
    if (!file) return null;
    const url = URL.createObjectURL(file);
    urls.set(path, url);
    return url;
  })().finally(() => pending.delete(path));
  pending.set(path, task);
  return task;
}

export function cachedUrl(path: string): string | null {
  return urls.get(path) ?? null;
}

/** Drop a path after its bytes changed or were deleted. */
export function invalidateUrl(path: string): void {
  const url = urls.get(path);
  if (url) {
    URL.revokeObjectURL(url);
    urls.delete(path);
  }
}

export function releasePrefix(prefix: string): void {
  for (const [path, url] of [...urls]) {
    if (path.startsWith(prefix)) {
      URL.revokeObjectURL(url);
      urls.delete(path);
    }
  }
}

export function releaseProject(slug: string): void {
  releasePrefix(`projects/${slug}/`);
}

export function releaseAllUrls(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}
