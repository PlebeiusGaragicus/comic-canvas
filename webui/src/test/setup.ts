import 'fake-indexeddb/auto';
import { afterEach, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { installOpfsShim, resetOpfsShim } from './opfsShim';
import { resetDbConnectionForTests } from '../store/db';
import { releaseAllUrls } from '../store/objectUrls';
import { setImageOpsForTests } from '../shared/images';

installOpfsShim();

// jsdom has no createImageBitmap/OffscreenCanvas: bytes pass through as the
// PNG, every image is 64x64, and the thumbnail is a tiny WebP-headed blob.
const THUMB_STUB = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x0c, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
setImageOpsForTests({
  normalizeToPng: async (blob) => new Blob([await blob.arrayBuffer()], { type: 'image/png' }),
  imageDimensions: async () => ({ width: 64, height: 64 }),
  makeThumbnail: async () => new Blob([THUMB_STUB], { type: 'image/webp' }),
});

// jsdom's createObjectURL cannot wrap the shim's File objects; stub it.
let objectUrlCounter = 0;
URL.createObjectURL = () => `blob:test/${(objectUrlCounter += 1)}`;
URL.revokeObjectURL = () => undefined;

beforeEach(() => {
  // Fresh database and OPFS root per test.
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  resetDbConnectionForTests();
  resetOpfsShim();
});

afterEach(() => {
  releaseAllUrls();
});
