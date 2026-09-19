import { describe, expect, it } from 'vitest';
import * as db from './db';
import * as blobs from './blobs';
import { urlFor, cachedUrl, releaseProject } from './objectUrls';
import { newUlid, newSeed } from '../services/ids';
import { slugify, utcNow } from '../services/common';

describe('db', () => {
  it('round-trips project and scoped docs and deletes by slug', async () => {
    await db.putProjectDoc('projects', 'p1', { slug: 'p1', name: 'One' });
    await db.putScopedDoc('assets', 'p1', 'a1', { id: 'a1' });
    await db.putScopedDoc('assets', 'p1', 'a2', { id: 'a2' });
    await db.putScopedDoc('assets', 'p2', 'a3', { id: 'a3' });
    expect(await db.getProjectDoc('projects', 'p1')).toEqual({ slug: 'p1', name: 'One' });
    expect((await db.listScopedDocs('assets', 'p1')).map((r) => r.id).sort()).toEqual(['a1', 'a2']);
    await db.deleteProjectRows('p1');
    expect(await db.getProjectDoc('projects', 'p1')).toBeUndefined();
    expect(await db.listScopedDocs('assets', 'p1')).toEqual([]);
    expect((await db.listScopedDocs('assets', 'p2')).map((r) => r.id)).toEqual(['a3']);
  });

  it('stores settings by key', async () => {
    await db.putSetting('settings', { geminiApiKey: 'x' });
    expect(await db.getSetting('settings')).toEqual({ geminiApiKey: 'x' });
  });
});

describe('blobs', () => {
  it('writes, reads, lists and deletes', async () => {
    await blobs.writeBlob('projects/p1/assets/a.png', new Uint8Array([1, 2, 3]));
    await blobs.writeBlob('projects/p1/adaptation/book.txt', 'hello');
    expect(await blobs.blobExists('projects/p1/assets/a.png')).toBe(true);
    expect(new Uint8Array(await (await blobs.readBlob('projects/p1/assets/a.png')).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(await blobs.readText('projects/p1/adaptation/book.txt')).toBe('hello');
    expect((await blobs.listDir('projects/p1')).map((e) => e.name)).toEqual(['adaptation', 'assets']);
    await blobs.deleteBlob('projects/p1/assets/a.png');
    expect(await blobs.blobExists('projects/p1/assets/a.png')).toBe(false);
    await blobs.deleteDir('projects/p1');
    expect(await blobs.listDir('projects')).toEqual([]);
  });

  it('rejects path traversal', async () => {
    await expect(blobs.writeBlob('projects/../x', 'y')).rejects.toThrow(/Invalid blob path/);
  });

  it('caches object urls per path and releases per project', async () => {
    await blobs.writeBlob('projects/p1/assets/a.png', new Uint8Array([1]));
    const url = await urlFor('projects/p1/assets/a.png');
    expect(url).toMatch(/^blob:/);
    expect(await urlFor('projects/p1/assets/a.png')).toBe(url);
    expect(await urlFor('projects/p1/assets/missing.png')).toBeNull();
    releaseProject('p1');
    expect(cachedUrl('projects/p1/assets/a.png')).toBeNull();
  });
});

describe('ids and common', () => {
  it('makes 26-char sortable ids', () => {
    const a = newUlid();
    const b = newUlid();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.slice(0, 10) <= b.slice(0, 10)).toBe(true);
  });
  it('makes seeds in range', () => {
    for (let i = 0; i < 50; i += 1) {
      const seed = newSeed();
      expect(seed).toBeGreaterThanOrEqual(1);
      expect(seed).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });
  it('formats time without fractional seconds', () => {
    expect(utcNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
  it('slugifies like the backend', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('***', 'fallback')).toBe('fallback');
  });
});
