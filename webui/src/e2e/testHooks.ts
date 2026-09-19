/** Test-only hooks exposed on `window` when the app runs under Playwright
 *  (`VITE_E2E=1`). Seeds the fixture project through the services. */
import { createProject } from '../services/projects';
import { importAsset } from '../services/assets';
import { base64ToBytes } from '../shared/base64';

export const E2E_SLUG = 'e2e-fixture';

const PNGS: Array<{ name: string; base64: string; x: number; y: number }> = [
  {
    name: 'blue.png',
    base64:
      'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAf0lEQVR4nNXOMREAIBDAsFJbuEM0MyJ+4BoFWftcyiRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4vwdmHo+YQIz9DYGkAAAAABJRU5ErkJggg==',
    x: 120,
    y: 160,
  },
  {
    name: 'rose.png',
    base64:
      'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAgUlEQVR4nNXOQREAIAzAsFJjOMG/AAQgYg+uUZB196FM4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iTO34GpB9cNAhGEYbJfAAAAAElFTkSuQmCC',
    x: 520,
    y: 160,
  },
  {
    name: 'amber.png',
    base64:
      'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAgElEQVR4nNXOMREAIBDAsNIV/ysu2RHxA9coyLpnUyZxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEufvwNQDSrQCHh48z58AAAAASUVORK5CYII=',
    x: 920,
    y: 380,
  },
];

export interface SeededFixture {
  slug: string;
  assetIds: string[];
}

export async function seedFixture(): Promise<SeededFixture> {
  await createProject({ slug: E2E_SLUG, name: 'E2E Fixture', settings: {} });
  const assetIds: string[] = [];
  for (const png of PNGS) {
    const file = new File([base64ToBytes(png.base64)], png.name, { type: 'image/png' });
    const asset = await importAsset(E2E_SLUG, file, { title: png.name.replace('.png', ''), canvasX: png.x, canvasY: png.y });
    assetIds.push(asset.id);
  }
  const { createPanel } = await import('../services/storyPanels');
  for (const [index, text] of ['A quiet morning on the farm.', 'The hen bolts for the fence.'].entries()) {
    await createPanel(E2E_SLUG, { title: `Panel ${index + 1}`, storyText: text, visibleText: text });
  }
  return { slug: E2E_SLUG, assetIds };
}

declare global {
  interface Window {
    __comicCanvas?: { seedFixture: typeof seedFixture };
  }
}

export function installTestHooks(): void {
  if (import.meta.env.VITE_E2E !== '1') return;
  window.__comicCanvas = { seedFixture };
}
