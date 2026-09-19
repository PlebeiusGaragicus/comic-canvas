import { describe, expect, it } from 'vitest';
import {
  ENTITY_TAG_COLORS,
  canonicalRefsForTags,
  ensureStyleEntityTags,
  listProjectTags,
  normalizeTagId,
  setTagCanonical,
  syncEntityTags,
  updateEntityTagCanonicals,
  upsertTag,
  writeTagRegistry,
} from './tags';
import { patchDisplay, readAsset } from './assets';
import { deleteAsset } from './trash';
import { getProjectDetail } from './projects';
import { isServiceError } from './errors';
import { FARM, importedDoc, seedAsset, seedProject } from '../test/fixtures';

async function tagsById(slug = FARM) {
  return Object.fromEntries((await listProjectTags(slug)).map((tag) => [tag.id, tag]));
}

describe('tag registry', () => {
  it('normalizes ids and rejects bad slugs', () => {
    expect(normalizeTagId('  Red Repo! ')).toBe('red-repo');
    expect(() => normalizeTagId('***')).toThrow(/Invalid tag slug/);
  });

  it('writes, lists and assigns tags to assets', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HTAGS', { title: 'Tagged image' }));
    const registry = await writeTagRegistry(FARM, { tags: [{ id: 'red4repo', name: 'Red4Repo', color: '#ef4444' }] });
    expect(registry.tags[0]).toMatchObject({ id: 'red4repo', name: 'Red4Repo', color: '#ef4444' });
    expect((await listProjectTags(FARM))[0]).toMatchObject({ id: 'red4repo', name: 'Red4Repo', color: '#ef4444' });

    const patched = await patchDisplay(FARM, '01HTAGS', { title: 'Tagged image', tags: ['red4repo'] });
    expect(patched.tags).toEqual(['red4repo']);
    const detail = await getProjectDetail(FARM);
    expect(detail.tags[0]).toMatchObject({ id: 'red4repo', name: 'Red4Repo', color: '#ef4444' });
    expect(detail.assets[0].tags).toEqual(['red4repo']);
  });

  it('rejects invalid definitions', async () => {
    await seedProject();
    await expect(writeTagRegistry(FARM, { tags: [{ id: 'ok', name: 'Ok', color: 'red' }] })).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    await expect(writeTagRegistry(FARM, { tags: [{ id: 'ok', name: '', color: '#ef4444' }] })).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
    await expect(writeTagRegistry(FARM, { tags: [{ id: 'Bad Id', name: 'x', color: '#ef4444' }] })).rejects.toSatisfy((error) => isServiceError(error, 'invalid'));
  });

  it('renaming keeps asset assignments; deleting clears them on the next display patch', async () => {
    await seedProject();
    await seedAsset(FARM, importedDoc('01HTAG2', { tags: ['red4repo'] }));
    await writeTagRegistry(FARM, { tags: [{ id: 'red4repo', name: 'Red4Repo', color: '#ef4444' }] });
    const renamed = await writeTagRegistry(FARM, { tags: [{ id: 'red4repo', name: 'Renamed Tag', color: '#22c55e' }] });
    expect(renamed.tags[0]).toMatchObject({ id: 'red4repo', name: 'Renamed Tag', color: '#22c55e' });
    expect((await readAsset(FARM, '01HTAG2')).tags).toEqual(['red4repo']);

    expect((await writeTagRegistry(FARM, { tags: [] })).tags).toEqual([]);
    expect((await patchDisplay(FARM, '01HTAG2', { title: 'Tagged image', tags: [] })).tags).toEqual([]);
  });

  it('keeps locked tags, preserves orphans, dedupes and sorts by name', async () => {
    await seedProject();
    await writeTagRegistry(FARM, {
      tags: [
        { id: 'hero', name: 'Hero', color: ENTITY_TAG_COLORS.character, locked: true, entityKind: 'character', canonicalAssetId: null },
        { id: 'zeta', name: 'Zeta', color: '#111111' },
      ],
    });
    // A non-locked rewrite of a locked tag is ignored; the orphan locked tag survives.
    const next = await writeTagRegistry(FARM, {
      tags: [
        { id: 'hero', name: 'Not Hero', color: '#000000' },
        { id: 'alpha', name: 'Alpha', color: '#222222' },
        { id: 'alpha', name: 'Alpha Dup', color: '#333333' },
      ],
    });
    // Unlocked tags left out of the rewrite (zeta) are gone; only locked orphans survive.
    expect(next.tags.map((tag) => tag.id)).toEqual(['alpha', 'hero']);
    expect(next.tags.find((tag) => tag.id === 'hero')).toMatchObject({ name: 'Hero', locked: true, entityKind: 'character' });
    expect(next.tags.find((tag) => tag.id === 'alpha')?.name).toBe('Alpha');

    const dropped = await writeTagRegistry(FARM, { tags: [] }, { preserveOrphanLockedEntityTags: false });
    expect(dropped.tags).toEqual([]);
  });

  it('upserts a single tag', async () => {
    await seedProject();
    await upsertTag(FARM, { id: 'one', name: 'One', color: '#111111' });
    const registry = await upsertTag(FARM, { id: 'one', name: 'Uno', color: '#222222' });
    expect(registry.tags).toHaveLength(1);
    expect(registry.tags[0]).toMatchObject({ id: 'one', name: 'Uno', color: '#222222' });
  });

  it('syncs entity tags from record keys with colours, names and canonicals', async () => {
    await seedProject();
    await writeTagRegistry(FARM, { tags: [{ id: 'mood', name: 'Mood', color: '#123456' }] });
    await ensureStyleEntityTags(FARM);
    await syncEntityTags(FARM, { characterKeys: ['hero', 'hero-armored'], locationKeys: ['barn'], entityNames: { hero: 'The Hero' } });
    let tags = await tagsById();
    expect(tags.hero).toMatchObject({ name: 'The Hero', color: '#3b82f6', locked: true, entityKind: 'character' });
    expect(tags['hero-armored']).toMatchObject({ name: 'Hero Armored', entityKind: 'character' });
    expect(tags.barn).toMatchObject({ name: 'Barn', color: '#f59e0b', entityKind: 'location' });
    expect(tags['character-style']).toMatchObject({ color: '#c084fc', entityKind: 'style' });
    expect(tags.mood).toMatchObject({ locked: false });

    await seedAsset(FARM, importedDoc('01HHERO'));
    await setTagCanonical(FARM, 'hero', '01HHERO');
    // Re-sync without the location keeps the canonical and drops the stale entity tag.
    await syncEntityTags(FARM, { characterKeys: ['hero'], locationKeys: [] });
    tags = await tagsById();
    expect(tags.hero.canonicalAssetId).toBe('01HHERO');
    expect(tags.barn).toBeUndefined();
    expect(tags['hero-armored']).toBeUndefined();
    expect(tags.mood).toBeDefined();
  });

  it('defaultOnly canonical updates never overwrite an explicit choice', async () => {
    await seedProject();
    await syncEntityTags(FARM, { characterKeys: ['hero'], locationKeys: [] });
    await seedAsset(FARM, importedDoc('01HA'));
    await seedAsset(FARM, importedDoc('01HB'));
    await updateEntityTagCanonicals(FARM, { hero: '01HA' }, { defaultOnly: true });
    expect((await tagsById()).hero.canonicalAssetId).toBe('01HA');
    await updateEntityTagCanonicals(FARM, { hero: '01HB' }, { defaultOnly: true });
    expect((await tagsById()).hero.canonicalAssetId).toBe('01HA');
    await updateEntityTagCanonicals(FARM, { hero: '01HB' });
    expect((await tagsById()).hero.canonicalAssetId).toBe('01HB');
    // Non-entity tags are never touched.
    await writeTagRegistry(FARM, { tags: [{ id: 'plain', name: 'Plain', color: '#000000' }] });
    await updateEntityTagCanonicals(FARM, { plain: '01HA' });
    expect((await tagsById()).plain.canonicalAssetId ?? null).toBeNull();
  });

  it('seeds style tags and manages their canonical (cleared when the asset is deleted)', async () => {
    await seedProject();
    await ensureStyleEntityTags(FARM);
    let tags = await tagsById();
    expect(tags['character-style']).toMatchObject({ entityKind: 'style', canonicalAssetId: null });
    expect(tags['scene-style']).toMatchObject({ entityKind: 'style' });

    await seedAsset(FARM, importedDoc('01HSTYLECANON', { title: 'Style anchor' }));
    const updated = await setTagCanonical(FARM, 'character-style', '01HSTYLECANON');
    expect(updated.find((tag) => tag.id === 'character-style')?.canonicalAssetId).toBe('01HSTYLECANON');
    await expect(setTagCanonical(FARM, 'no-such-tag', '01HSTYLECANON')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));
    await expect(setTagCanonical(FARM, 'character-style', 'missing-asset')).rejects.toSatisfy((error) => isServiceError(error, 'not-found'));

    await deleteAsset(FARM, '01HSTYLECANON');
    tags = await tagsById();
    expect(tags['character-style'].canonicalAssetId).toBeNull();
  });

  it('resolves canonical refs for entity tags that have pixels', async () => {
    await seedProject();
    await syncEntityTags(FARM, { characterKeys: ['hero', 'ghost'], locationKeys: [] });
    await seedAsset(FARM, importedDoc('01HHERO'));
    await seedAsset(FARM, importedDoc('01HGHOST'), { pixels: false });
    await setTagCanonical(FARM, 'hero', '01HHERO');
    await setTagCanonical(FARM, 'ghost', '01HGHOST');
    await writeTagRegistry(FARM, { tags: [{ id: 'plain', name: 'Plain', color: '#000000' }] });
    expect(await canonicalRefsForTags(FARM, ['hero', 'hero', 'ghost', 'plain', 'unknown'])).toEqual(['01HHERO']);
  });
});
