import { describe, expect, it } from 'vitest';
import {
  createCharacter,
  createLocation,
  deleteCharacter,
  deleteLocation,
  draftCharacterVariantToCanvas,
  draftLocationVariantToCanvas,
  entityFlatKeys,
  importBook,
  listCharacters,
  optionalBookText,
  readBook,
  readMetadata,
  resetCharacterData,
  status,
  updateCharacter,
  updateLocation,
  writeMetadata,
} from './adaptation';
import { listProjectTags } from './tags';
import { isServiceError } from './errors';
import { FARM, importedDoc, seedAsset, seedProject } from '../test/fixtures';

async function tagIds(): Promise<string[]> {
  return (await listProjectTags(FARM)).map((tag) => tag.id);
}

async function extractedCharacter(slug: string, variantKey?: string) {
  await createCharacter(FARM, { name: slug.charAt(0).toUpperCase() + slug.slice(1), summary: `The ${slug}.` });
  const variants: Record<string, { prompt: string; label?: string }> = { base: { prompt: `Full body sheet for ${slug}.` } };
  if (variantKey) variants[variantKey] = { prompt: `Variant sheet for ${slug}.`, label: variantKey.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
  return updateCharacter(FARM, slug, { visualDescription: 'Tall.', variants });
}

describe('adaptation records', () => {
  it('registers characters and locations, patches, lists sorted, and feeds status', async () => {
    await seedProject();
    const character = await createCharacter(FARM, { name: 'Hero', summary: 'The farm hero.' });
    expect(character.slug).toBe('hero');
    const location = await createLocation(FARM, { name: 'Barn', summary: 'The red barn.' });
    expect(location.slug).toBe('barn');
    const updated = await updateCharacter(FARM, 'hero', { slug: 'hero-primary', userTags: ['farm', 'protagonist'] });
    expect(updated.slug).toBe('hero-primary');
    expect((await listCharacters(FARM)).map((r) => r.slug)).toEqual(['hero-primary']);
    const payload = await status(FARM);
    expect(payload.hasBook).toBe(false);
    expect(payload.hasBookSession).toBe(false);
    expect(payload.characters['hero-primary'].userTags).toEqual(['farm', 'protagonist']);
    expect(payload.counts).toMatchObject({ characters: 1, charactersExtracted: 0, locations: 1, locationsExtracted: 0, conceptArt: 0 });
    const afterDelete = await deleteCharacter(FARM, 'hero-primary');
    expect(afterDelete.characters['hero-primary']).toBeUndefined();
    await expect(deleteCharacter(FARM, 'hero-primary')).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
  });

  it('handles fields, variants, removal, and conflicts', async () => {
    await seedProject();
    const created = await createCharacter(FARM, { name: 'Hero', summary: 'The farm hero.' });
    expect(created.createdAt).toBeTruthy();
    await expect(createCharacter(FARM, { name: 'Hero' })).rejects.toSatisfy((e) => isServiceError(e, 'conflict'));
    const updated = await updateCharacter(FARM, 'hero', {
      summary: 'Updated summary.',
      visualDescription: 'Tall.',
      performanceNotes: 'Brave.',
      continuityNotes: 'Keep the hat.',
      variants: {
        base: { prompt: 'Updated base prompt.' },
        'winter-coat': { prompt: 'Updated winter prompt.', label: 'Winter Coat', storyContext: 'During the blizzard chapters.' },
      },
    });
    expect(updated.summary).toBe('Updated summary.');
    expect(updated.performanceNotes).toBe('Brave.');
    expect(updated.variants.base.prompt).toBe('Updated base prompt.');
    expect(updated.variants['winter-coat'].storyContext).toBe('During the blizzard chapters.');
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
    const payload = await status(FARM);
    expect(payload.characters.hero.variants['winter-coat'].label).toBe('Winter Coat');
    expect(payload.counts.charactersExtracted).toBe(1);
    const removed = await updateCharacter(FARM, 'hero', { removeVariants: ['winter-coat'] });
    expect(Object.keys(removed.variants)).toEqual(['base']);
    await expect(updateCharacter(FARM, 'nobody', { summary: 'x' })).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
    await createCharacter(FARM, { name: 'Villain' });
    await expect(updateCharacter(FARM, 'villain', { slug: 'hero' })).rejects.toSatisfy((e) => isServiceError(e, 'conflict'));
    await expect(updateCharacter(FARM, 'villain', { variants: { 'Bad Key': { prompt: 'x' } } })).rejects.toSatisfy((e) => isServiceError(e, 'invalid'));
  });

  it('syncs entity tags on rename and removal, and reset clears characters and tags', async () => {
    await seedProject();
    await createCharacter(FARM, { name: 'New Character 1', summary: 'A new character.' });
    expect(await tagIds()).toEqual(['character-style', 'new-character-1', 'scene-style']);
    const renamed = await updateCharacter(FARM, 'new-character-1', { slug: 'hero', name: 'The Hero' });
    expect(renamed.slug).toBe('hero');
    const tags = Object.fromEntries((await listProjectTags(FARM)).map((tag) => [tag.id, tag]));
    expect(Object.keys(tags).sort()).toEqual(['character-style', 'hero', 'scene-style']);
    expect(tags.hero.name).toBe('The Hero');
    const reset = await resetCharacterData(FARM);
    expect(reset.characters).toEqual({});
    expect(await tagIds()).toEqual(['character-style', 'scene-style']);
    expect(await listCharacters(FARM)).toEqual([]);
  });

  it('gives each variant its own entity tag, drafts variants to canvas, and seeds canonicals', async () => {
    await seedProject();
    await extractedCharacter('hero', 'post-duel');
    let tags = Object.fromEntries((await listProjectTags(FARM)).map((tag) => [tag.id, tag]));
    expect(tags['hero-post-duel'].entityKind).toBe('character');
    expect(tags['hero-post-duel'].name).toBe('Hero (Post Duel)');
    await updateCharacter(FARM, 'hero', { removeVariants: ['post-duel'] });
    expect(await tagIds()).not.toContain('hero-post-duel');
    await updateCharacter(FARM, 'hero', { variants: { 'post-duel': { prompt: 'Variant sheet, add the scar.', label: 'Post-duel' } } });
    const drafted = await draftCharacterVariantToCanvas(FARM, 'hero', 'post-duel');
    const node = drafted.canvas.nodes[drafted.nodeId as string];
    expect(new Set(node.tags)).toContain('hero');
    expect(node.tags).toContain('hero-post-duel');
    expect(node.tags).toContain('character-sheet');
    expect(node.displayName).toBe('Hero (Post-duel)');
    await expect(draftCharacterVariantToCanvas(FARM, 'hero', 'nope')).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
    await expect(draftCharacterVariantToCanvas(FARM, 'nobody', 'base')).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
    await updateCharacter(FARM, 'hero', { variants: { 'empty-look': { label: 'Empty' } } });
    await expect(draftCharacterVariantToCanvas(FARM, 'hero', 'empty-look')).rejects.toSatisfy((e) => isServiceError(e, 'invalid'));

    await seedAsset(FARM, importedDoc('01HVARIANTIMG', { title: 'Post duel sheet' }));
    const metadata = await readMetadata(FARM);
    metadata.characters.hero.variants['post-duel'] = { ...metadata.characters.hero.variants['post-duel'], assetIds: ['01HVARIANTIMG'], activeAssetId: '01HVARIANTIMG' };
    await writeMetadata(FARM, metadata);
    await status(FARM);
    tags = Object.fromEntries((await listProjectTags(FARM)).map((tag) => [tag.id, tag]));
    expect(tags['hero-post-duel'].canonicalAssetId).toBe('01HVARIANTIMG');
  });

  it('drops variant assets whose pixels are gone (stale artifact cleanup)', async () => {
    await seedProject();
    await extractedCharacter('hero');
    const metadata = await readMetadata(FARM);
    metadata.characters.hero.variants.base = { ...metadata.characters.hero.variants.base, assetIds: ['missing'], activeAssetId: 'missing' };
    await writeMetadata(FARM, metadata);
    const payload = await status(FARM);
    expect(payload.characters.hero.variants.base.assetIds).toEqual([]);
    expect(payload.characters.hero.variants.base.activeAssetId).toBeNull();
  });

  it('manages locations the same way', async () => {
    await seedProject();
    await createLocation(FARM, { name: 'Barn', summary: 'The red barn.' });
    await expect(createLocation(FARM, { name: 'Barn' })).rejects.toSatisfy((e) => isServiceError(e, 'conflict'));
    const updated = await updateLocation(FARM, 'barn', {
      summary: 'Updated summary.',
      visualDescription: 'Weathered red planks.',
      continuityNotes: 'Keep the rooster weathervane.',
      variants: {
        base: { prompt: 'Wide establishing shot of the barn.' },
        'after-the-fire': { prompt: 'Same barn, charred and half-collapsed.', label: 'After the fire', storyContext: 'After the fire in chapter 5.' },
      },
    });
    expect(updated.variants['after-the-fire'].storyContext).toBe('After the fire in chapter 5.');
    const payload = await status(FARM);
    expect(payload.locations.barn.continuityNotes).toBe('Keep the rooster weathervane.');
    expect(payload.counts.locationsExtracted).toBe(1);
    const tags = Object.fromEntries((await listProjectTags(FARM)).map((tag) => [tag.id, tag]));
    expect(tags['barn-after-the-fire'].entityKind).toBe('location');
    expect(tags['barn-after-the-fire'].name).toBe('Barn (After the fire)');
    const drafted = await draftLocationVariantToCanvas(FARM, 'barn', 'after-the-fire');
    const node = drafted.canvas.nodes[drafted.nodeId as string];
    expect(node.tags).toEqual(expect.arrayContaining(['barn', 'barn-after-the-fire', 'location-prompt', 'comic-adaptation']));
    expect(node.assetIds).toEqual([]);
    const baseDraft = await draftLocationVariantToCanvas(FARM, 'barn', 'base');
    expect(baseDraft.canvas.nodes[baseDraft.nodeId as string].tags).not.toContain('barn-after-the-fire');
    const removed = await updateLocation(FARM, 'barn', { removeVariants: ['after-the-fire'] });
    expect(Object.keys(removed.variants)).toEqual(['base']);
    expect(await tagIds()).not.toContain('barn-after-the-fire');
    await createLocation(FARM, { name: 'Field' });
    await expect(updateLocation(FARM, 'field', { slug: 'barn' })).rejects.toSatisfy((e) => isServiceError(e, 'conflict'));
    const deleted = await deleteLocation(FARM, 'field');
    expect(deleted.locations.field).toBeUndefined();
    expect(entityFlatKeys(deleted.locations)).toEqual(new Set(['barn']));
  });

  it('imports and reads the book, clearing any prepared context', async () => {
    await seedProject();
    await expect(readBook(FARM)).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
    expect(await optionalBookText(FARM)).toBeNull();
    const metadata = await readMetadata(FARM);
    await writeMetadata(FARM, { ...metadata, bookContext: { bookHash: 'x', tokenEstimate: 1, preparedAt: 'now', fits: true, modelId: 'm', contextWindow: 1 } });
    expect((await status(FARM)).hasBookSession).toBe(true);
    const payload = await importBook(FARM, new File(['Once upon a farm.'], 'book.txt', { type: 'text/plain' }));
    expect(payload.hasBook).toBe(true);
    expect(payload.hasBookSession).toBe(false);
    expect(await readBook(FARM)).toBe('Once upon a farm.');
    await importBook(FARM, new File(['Line one.\r\nLine two.\rLine three.'], 'book.txt', { type: 'text/plain' }));
    expect(await readBook(FARM)).toBe('Line one.\nLine two.\nLine three.');
    await expect(importBook(FARM, new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toSatisfy((e) => isServiceError(e, 'invalid'));
  });
});
