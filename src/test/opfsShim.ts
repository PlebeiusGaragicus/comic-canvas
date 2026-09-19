/** In-memory OPFS for vitest (jsdom has no navigator.storage.getDirectory). */

class MemoryWritable {
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  constructor(private readonly commit: (bytes: Uint8Array<ArrayBuffer>) => void) {}
  async write(chunk: unknown): Promise<void> {
    if (chunk instanceof Blob) {
      this.chunks.push(new Uint8Array(await chunk.arrayBuffer()));
    } else if (typeof chunk === 'string') {
      this.chunks.push(new TextEncoder().encode(chunk));
    } else if (chunk instanceof ArrayBuffer) {
      this.chunks.push(new Uint8Array(chunk));
    } else if (ArrayBuffer.isView(chunk)) {
      this.chunks.push(Uint8Array.from(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
    } else if (chunk && typeof chunk === 'object' && 'data' in chunk) {
      await this.write((chunk as { data: unknown }).data);
    } else {
      throw new TypeError('Unsupported write chunk');
    }
  }
  async truncate(): Promise<void> {
    this.chunks = [];
  }
  async close(): Promise<void> {
    const total = this.chunks.reduce((n, c) => n + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.commit(out);
  }
  async abort(): Promise<void> {
    this.chunks = [];
  }
}

function notFound(name: string): DOMException {
  return new DOMException(`Not found: ${name}`, 'NotFoundError');
}

export class MemoryFileHandle {
  readonly kind = 'file' as const;
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  constructor(readonly name: string) {}
  async getFile(): Promise<File> {
    return new File([this.bytes], this.name, { lastModified: Date.now() });
  }
  async createWritable(): Promise<MemoryWritable> {
    return new MemoryWritable((bytes) => {
      this.bytes = bytes;
    });
  }
  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this;
  }
}

export class MemoryDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, MemoryDirectoryHandle | MemoryFileHandle>();
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing instanceof MemoryDirectoryHandle) return existing;
    if (existing) throw new DOMException(`Not a directory: ${name}`, 'TypeMismatchError');
    if (!options?.create) throw notFound(name);
    const dir = new MemoryDirectoryHandle(name);
    this.children.set(name, dir);
    return dir;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFileHandle> {
    const existing = this.children.get(name);
    if (existing instanceof MemoryFileHandle) return existing;
    if (existing) throw new DOMException(`Not a file: ${name}`, 'TypeMismatchError');
    if (!options?.create) throw notFound(name);
    const file = new MemoryFileHandle(name);
    this.children.set(name, file);
    return file;
  }
  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const existing = this.children.get(name);
    if (!existing) throw notFound(name);
    if (existing instanceof MemoryDirectoryHandle && existing.children.size > 0 && !options?.recursive) {
      throw new DOMException(`Directory not empty: ${name}`, 'InvalidModificationError');
    }
    this.children.delete(name);
  }
  async *keys(): AsyncGenerator<string> {
    for (const key of [...this.children.keys()]) yield key;
  }
  async *values(): AsyncGenerator<MemoryDirectoryHandle | MemoryFileHandle> {
    for (const value of [...this.children.values()]) yield value;
  }
  async *entries(): AsyncGenerator<[string, MemoryDirectoryHandle | MemoryFileHandle]> {
    for (const entry of [...this.children.entries()]) yield entry;
  }
  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this;
  }
}

let rootHandle = new MemoryDirectoryHandle('');

export function installOpfsShim(): void {
  const storage = {
    getDirectory: async () => rootHandle,
    persist: async () => true,
    persisted: async () => true,
    estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
  };
  Object.defineProperty(globalThis.navigator, 'storage', { value: storage, configurable: true });
  (globalThis as Record<string, unknown>).FileSystemFileHandle = MemoryFileHandle;
  (globalThis as Record<string, unknown>).FileSystemDirectoryHandle = MemoryDirectoryHandle;
}

export function resetOpfsShim(): void {
  rootHandle = new MemoryDirectoryHandle('');
}
