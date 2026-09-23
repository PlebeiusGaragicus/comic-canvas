import type { CanvasDocument } from '../types';

export const emptyCanvas: CanvasDocument = {
  version: 2,
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: {},
};
