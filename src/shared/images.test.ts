import { describe, expect, it } from 'vitest';
import { THUMB_MAX_SIZE, imageOps, makeThumbnail, normalizeToPng, sha256Hex, sniffImageType } from './images';
import { jpegBytes, pngBytes } from '../test/fixtures';

describe('images', () => {
  it('sniffs png, jpeg and webp by magic bytes', () => {
    expect(sniffImageType(pngBytes())).toBe('png');
    expect(sniffImageType(jpegBytes())).toBe('jpeg');
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('webp');
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });

  it('hashes bytes with sha-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(new Uint8Array([]).buffer)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('routes the top-level helpers through the swappable imageOps', async () => {
    expect(THUMB_MAX_SIZE).toBe(384);
    const input = new Blob([pngBytes(7)], { type: 'image/png' });
    const png = await normalizeToPng(input);
    expect(png.type).toBe('image/png');
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(pngBytes(7));
    const thumb = await makeThumbnail(input);
    expect(thumb.type).toBe('image/webp');
    expect(await imageOps.imageDimensions(input)).toEqual({ width: 64, height: 64 });
  });
});
