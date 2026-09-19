import { describe, expect, it } from 'vitest';
import { createVisualStyle, deleteVisualStyle, readVisualStyles, resolveDefaultVisualStyleId, updateVisualStyle, visualStylePrompt } from './visualStyles';
import { status } from './adaptation';
import { isServiceError } from './errors';
import { FARM, seedProject } from '../test/fixtures';

describe('visual styles', () => {
  it('seeds the crayons default and resolves the default id', async () => {
    await seedProject();
    const payload = await status(FARM);
    expect(payload.visualStyles.map((style) => style.id)).toEqual(['crayons']);
    expect(payload.defaultVisualStyleId).toBe('crayons');
    expect(resolveDefaultVisualStyleId([])).toBeNull();
    expect(resolveDefaultVisualStyleId([{ id: 'a', name: 'a', prompt: '' }, { id: 'b', name: 'b', prompt: '' }])).toBe('a');
    expect(resolveDefaultVisualStyleId([{ id: 'a', name: 'a', prompt: '', default: true }, { id: 'b', name: 'b', prompt: '', default: true }])).toBe('a');
  });

  it('creates unique ids, normalises prompts, updates defaults and deletes', async () => {
    await seedProject();
    let payload = await createVisualStyle(FARM, { name: 'Ink Wash', prompt: 'Style: ink\nLighting: soft  \n\n' });
    expect(payload.visualStyles.map((style) => style.id)).toEqual(['crayons', 'ink-wash']);
    expect(payload.visualStyles[1].prompt).toBe('Style: ink\nLighting: soft\n');
    expect(payload.visualStyles[1].default).toBe(false);
    payload = await createVisualStyle(FARM, { name: 'Ink Wash' });
    expect(payload.visualStyles[2].id).toBe('ink-wash-2');
    expect(payload.visualStyles[2].prompt).toBe('Style:\nColor palette:\nRealism:\nLighting:\n');
    payload = await updateVisualStyle(FARM, 'ink-wash', { name: ' Wash ', default: true });
    expect(payload.defaultVisualStyleId).toBe('ink-wash');
    expect(payload.visualStyles.find((s) => s.id === 'ink-wash')?.name).toBe('Wash');
    expect(payload.visualStyles.filter((s) => s.default)).toHaveLength(1);
    expect(await visualStylePrompt(FARM, 'ink-wash')).toBe('Style: ink\nLighting: soft\n');
    await expect(visualStylePrompt(FARM, 'nope')).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
    payload = await deleteVisualStyle(FARM, 'ink-wash');
    expect(payload.visualStyles.map((s) => s.id)).toEqual(['crayons', 'ink-wash-2']);
    expect(payload.defaultVisualStyleId).toBe('crayons');
    expect((await readVisualStyles(FARM))[0].default).toBe(true);
    await expect(deleteVisualStyle(FARM, 'nope')).rejects.toSatisfy((e) => isServiceError(e, 'not-found'));
  });
});
