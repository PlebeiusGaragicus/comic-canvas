import { describe, expect, it } from 'vitest';
import { conceptCardTag, createCard, deleteCard, draftCardToCanvas, existingConceptSummaries, listCards, readCard, updateCard, uploadCardImage } from './conceptCards';
import { readAsset } from './assets';
import { readStoredCanvas } from './canvas';
import { status } from './adaptation';
import { isServiceError } from './errors';
import { FARM, pngFile, seedProject } from '../test/fixtures';

describe('concept cards', () => {
  it('creates cards with default prompts, lists newest first, updates and deletes', async () => {
    await seedProject();
    const character = await createCard(FARM, { subjectKind: 'character', displayName: 'Night Pony' });
    expect(character.prompt.startsWith('Character reference sheet')).toBe(true);
    expect(character.prompt).toContain('Layout: top row');
    const location = await createCard(FARM, { subjectKind: 'location', prompt: 'A misty pier.' });
    expect(location.prompt).toBe('A misty pier.');
    await updateCard(FARM, character.id, { prompt: 'Revised.' });
    expect((await listCards(FARM)).map((card) => card.id)).toEqual([character.id, location.id]);
    expect((await status(FARM)).counts.conceptArt).toBe(2);
    await updateCard(FARM, location.id, { archived: true });
    expect((await listCards(FARM)).map((card) => card.id)).toEqual([character.id]);
    expect((await listCards(FARM, true)).length).toBe(2);
    expect(await existingConceptSummaries(FARM)).toEqual(['character: Revised.']);
    await deleteCard(FARM, character.id);
    await expect(readCard(FARM, character.id)).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
    await expect(updateCard(FARM, 'nope', { prompt: 'x' })).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
  });

  it('drafts to canvas with an origin and uploads images with subject retagging', async () => {
    await seedProject();
    const card = await createCard(FARM, { subjectKind: 'character', displayName: 'Pony', prompt: 'Pony sheet.' });
    const drafted = await draftCardToCanvas(FARM, card.id);
    const node = drafted.canvas.nodes[drafted.nodeId];
    expect(node.origin).toEqual({ kind: 'conceptCard', id: card.id });
    expect(node.tags).toEqual(expect.arrayContaining(['concept', 'concept-character', conceptCardTag(card.id)]));
    expect(node.prompt).toBe('Pony sheet.');

    const uploaded = await uploadCardImage(FARM, card.id, pngFile('pony.png', 7));
    expect(uploaded.assetIds).toHaveLength(1);
    expect(uploaded.activeAssetId).toBe(uploaded.assetIds[0]);
    const asset = await readAsset(FARM, uploaded.assetIds[0]);
    expect(asset.tags).toEqual(['comic-adaptation', 'concept', 'concept-character', conceptCardTag(card.id)]);

    await updateCard(FARM, card.id, { subjectKind: 'location' });
    expect((await readAsset(FARM, uploaded.assetIds[0])).tags).toContain('concept-location');
    expect((await readAsset(FARM, uploaded.assetIds[0])).tags).not.toContain('concept-character');
    const canvas = await readStoredCanvas(FARM);
    expect(canvas.nodes[drafted.nodeId].tags).toContain('concept-location');
  });
});
