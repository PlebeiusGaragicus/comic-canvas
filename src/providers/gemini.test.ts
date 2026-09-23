import { describe, expect, it } from 'vitest';
import { chatTurnResultFromResponse, describeGenerationFailure, serializeResponseMetadata, toSdkPart } from './gemini';
import { bytesToBase64 } from '../shared/base64';

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('gemini serialization', () => {
  it('strips large payloads from provider metadata', () => {
    const response = {
      candidates: [
        {
          content: {
            parts: [{ inline_data: { data: 'abc123', mime_type: 'image/png' }, thought_signature: 'secret'.repeat(300) }],
          },
        },
      ],
    };
    const metadata = serializeResponseMetadata(response, 'generated.png');
    const part = (metadata.response as any).candidates[0].content.parts[0];
    expect(metadata.imageFile).toBe('generated.png');
    expect(part.inline_data.data).toBe('<inline-image-data:6 chars>');
    expect(part.thought_signature).toBe('<thought-signature:1800 chars>');
  });

  it('preserves image bytes for history and strips them from the capture', () => {
    const response = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'here', inlineData: { data: bytesToBase64(PNG_HEADER), mimeType: 'image/png' }, thoughtSignature: 'sig-image' }],
          },
        },
      ],
    };
    const result = chatTurnResultFromResponse(response);
    expect(result.text).toBe('here');
    expect(result.images).toHaveLength(1);
    expect(Array.from(result.images[0].data.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(result.images[0].thoughtSignature).toBe('sig-image');
    const historyPart = (result.modelContent.parts[0] as any).inlineData;
    expect(historyPart.data.startsWith('iVBOR')).toBe(true);
    expect((result.providerResponse as any).candidates[0].content.parts[0].inlineData.data).toMatch(/^<inline-image-data:/);
    expect((result.providerResponse as any).candidates[0].content.parts[0].thoughtSignature).toMatch(/^<thought-signature:/);
  });

  it('classifies failures', () => {
    expect(describeGenerationFailure({ promptFeedback: { blockReason: 'SAFETY' } }).category).toBe('safety');
    expect(describeGenerationFailure({ candidates: [{ finishReason: 'RECITATION' }] }).category).toBe('safety');
    expect(describeGenerationFailure({ candidates: [{ content: { parts: [{ text: 'no' }] } }] }).category).toBe('empty');
    expect(describeGenerationFailure({ promptFeedback: { blockReason: 'OTHER', blockReasonMessage: 'nope' } }).message).toContain(' nope');
  });

  it('normalises legacy snake_case parts to SDK field names', () => {
    expect(toSdkPart({ inline_data: { mime_type: 'image/png', data_ref: 'blobs/x.png' }, thought_signature: 's' })).toEqual({
      inlineData: { mimeType: 'image/png', dataRef: 'blobs/x.png' },
      thoughtSignature: 's',
    });
  });
});
