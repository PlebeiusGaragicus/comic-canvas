/** Persistent-storage grant and usage estimates. */

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (error) {
    console.error('comic-canvas: persistent storage request failed', error);
    return false;
  }
}

export async function isStoragePersisted(): Promise<boolean> {
  try {
    return Boolean(await navigator.storage?.persisted?.());
  } catch {
    return false;
  }
}

export interface StorageUsage {
  usage: number;
  quota: number;
}

export async function storageUsage(): Promise<StorageUsage | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
