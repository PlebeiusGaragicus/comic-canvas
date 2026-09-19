/** Browser image operations: PNG normalisation, dimensions, thumbnails and
 *  hashing. The decode/encode work goes through `imageOps` so tests (jsdom has
 *  no `createImageBitmap`/`OffscreenCanvas`) can swap in a stub. */

export const THUMB_MAX_SIZE = 384;

export type ImageType = 'png' | 'jpeg' | 'webp';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImageOps {
  /** Re-encode any supported image as PNG. */
  normalizeToPng(blob: Blob): Promise<Blob>;
  imageDimensions(blob: Blob): Promise<ImageDimensions>;
  /** WebP thumbnail whose longest side is at most `maxSize` (never upscaled). */
  makeThumbnail(blob: Blob, maxSize?: number): Promise<Blob>;
}

const MIME_BY_TYPE: Record<ImageType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function mimeTypeFor(type: ImageType): string {
  return MIME_BY_TYPE[type];
}

/** Identify png/jpeg/webp by magic bytes; null for anything else. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    throw new Error('Could not decode image', { cause: error });
  }
}

function drawScaled(bitmap: ImageBitmap, width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

export const browserImageOps: ImageOps = {
  async normalizeToPng(blob) {
    const bitmap = await decode(blob);
    try {
      return await drawScaled(bitmap, bitmap.width, bitmap.height).convertToBlob({ type: 'image/png' });
    } finally {
      bitmap.close();
    }
  },
  async imageDimensions(blob) {
    const bitmap = await decode(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  },
  async makeThumbnail(blob, maxSize = THUMB_MAX_SIZE) {
    const bitmap = await decode(blob);
    try {
      const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height, 1));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      // Browsers without a WebP encoder (older Safari) return PNG bytes here;
      // <img> sniffs the content, so the `.thumb.webp` path still renders.
      return await drawScaled(bitmap, width, height).convertToBlob({ type: 'image/webp', quality: 0.82 });
    } finally {
      bitmap.close();
    }
  },
};

/** The active implementation. Mutated in place by `setImageOpsForTests`. */
export const imageOps: ImageOps = { ...browserImageOps };

export function setImageOpsForTests(ops: ImageOps | null): void {
  Object.assign(imageOps, ops ?? browserImageOps);
}

export function normalizeToPng(blob: Blob): Promise<Blob> {
  return imageOps.normalizeToPng(blob);
}

export function imageDimensions(blob: Blob): Promise<ImageDimensions> {
  return imageOps.imageDimensions(blob);
}

export function makeThumbnail(blob: Blob, maxSize = THUMB_MAX_SIZE): Promise<Blob> {
  return imageOps.makeThumbnail(blob, maxSize);
}
