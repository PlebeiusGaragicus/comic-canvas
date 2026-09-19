import { describe, expect, it } from 'vitest';
import { appendTurn, createSession, listSessions, patchSession, readChatBlob, readSession } from './chatSessions';
import { listAssets } from './assets';
import { deleteAsset } from './trash';
import { readCanvas } from './canvas';
import { isServiceError } from './errors';
import { chatTurnResultFromResponse, type ImageProvider, type SendChatTurnParams } from '../providers/gemini';
import { bytesToBase64 } from '../shared/base64';
import { FARM, importedDoc, pngBytes, seedAsset, seedProject } from '../test/fixtures';

describe('chat sessions', () => {
  it('creates sessions that protect the source asset, and archives', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HSOURCE', { title: 'Source' }));
    const session = await createSession(FARM, { sourceAssetId: '01HSOURCE', canvasNodeId: 'node_source', title: 'Jacket refinements' });
    expect(session.source.assetId).toBe('01HSOURCE');
    expect(session.protectedAssetIds).toEqual(['01HSOURCE']);
    expect(session.provider.history).toEqual([]);
    expect(session.defaults.model).toBe('gemini-3.1-flash-image');
    const assets = await listAssets(FARM);
    expect(assets[0].isProtected).toBe(true);
    await expect(deleteAsset(FARM, '01HSOURCE')).rejects.toSatisfy((e) => isServiceError(e, 'conflict') && (e.details?.chatSessionIds as string[]).includes(session.id));
    const archived = await patchSession(FARM, session.id, { archived: true });
    expect(archived.archivedAt).toBeTruthy();
    expect(await listSessions(FARM)).toEqual([]);
    expect((await listSessions(FARM, true)).length).toBe(1);
    await expect(appendTurn(FARM, session.id, { text: 'x', attachmentAssetIds: [] }, { name: 'google-genai' } as ImageProvider)).rejects.toSatisfy((e) => isServiceError(e, 'conflict'));
  });

  it('persists history with blob refs, generated assets, and attaches to the canvas', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HSOURCE', { title: 'Source' }));
    const sourceNodeId = Object.keys((await readCanvas(FARM)).nodes).find((id) => id.startsWith('node_'))!;
    const session = await createSession(FARM, { sourceAssetId: '01HSOURCE', canvasNodeId: sourceNodeId });
    const seen: SendChatTurnParams[] = [];
    const provider: ImageProvider = {
      name: 'google-genai',
      async generateImage() {
        throw new Error('unused');
      },
      async sendChatTurn(params) {
        seen.push(params);
        return chatTurnResultFromResponse({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { text: 'Done', thoughtSignature: 'sig-text' },
                  { inlineData: { mimeType: 'image/png', data: bytesToBase64(pngBytes(9)) }, thoughtSignature: 'sig-image' },
                ],
              },
            },
          ],
        });
      },
      async validateKey() {},
    };
    const response = await appendTurn(FARM, session.id, { text: 'make it cinematic', attachmentAssetIds: [] }, provider);
    expect(seen[0].history).toEqual([]);
    expect((seen[0].messageParts[0] as { text: string }).text).toBe('make it cinematic');
    expect((seen[0].messageParts[1] as { inlineData: { data: string } }).inlineData.data).toBeTruthy();
    expect(response.assets).toHaveLength(1);
    const asset = response.assets[0];
    expect(asset.generation?.chatSessionId).toBe(session.id);
    expect(asset.generation?.chatTurnId).toBe(response.session.turns[1].id);
    expect(asset.generation?.seed).toBeNull();
    const stripped = (asset.provider?.response as { response: { candidates: Array<{ content: { parts: Array<{ inlineData: { data: string } }> } }> } }).response.candidates[0].content.parts[1].inlineData.data;
    expect(stripped.startsWith('<inline-image-data:')).toBe(true);
    const stored = await readSession(FARM, session.id);
    expect(stored.turns).toHaveLength(2);
    const modelParts = stored.provider.history[1].parts as Array<Record<string, unknown>>;
    expect(modelParts[0].thoughtSignature).toBe('sig-text');
    expect(modelParts[1].thoughtSignature).toBe('sig-image');
    const dataRef = (modelParts[1].inlineData as { dataRef: string }).dataRef;
    expect(dataRef.startsWith('blobs/')).toBe(true);
    expect(Array.from((await readChatBlob(FARM, session.id, dataRef)).slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(stored.protectedAssetIds).toEqual(['01HSOURCE', asset.id]);
    const canvas = await readCanvas(FARM);
    const chatNodes = Object.values(canvas.nodes).filter((node) => node.assetIds.includes(asset.id));
    expect(chatNodes).toHaveLength(1);

    // Second turn expands the stored history back to base64 for the request.
    await appendTurn(FARM, session.id, { text: 'more', attachmentAssetIds: [] }, provider);
    const historyParts = seen[1].history[1].parts as Array<Record<string, unknown>>;
    expect(typeof (historyParts[1].inlineData as { data: string }).data).toBe('string');
    expect((historyParts[1].inlineData as { dataRef?: string }).dataRef).toBeUndefined();
  });
});
