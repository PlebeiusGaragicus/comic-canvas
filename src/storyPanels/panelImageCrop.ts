import type { CSSProperties } from 'react';
import type { StoryPanel, StoryPanelImageCrop } from '../types';

export const DEFAULT_IMAGE_CROP: StoryPanelImageCrop = {
  focalX: 0.5,
  focalY: 0.5,
  scale: 1,
};

export function imageCropForPanel(panel: StoryPanel): StoryPanelImageCrop {
  return panel.imageCrop ?? DEFAULT_IMAGE_CROP;
}

export function isDefaultImageCrop(crop: StoryPanelImageCrop | null | undefined): boolean {
  if (!crop) return true;
  return crop.focalX === DEFAULT_IMAGE_CROP.focalX
    && crop.focalY === DEFAULT_IMAGE_CROP.focalY
    && crop.scale === DEFAULT_IMAGE_CROP.scale;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function focalFromPanDelta(
  crop: StoryPanelImageCrop,
  deltaX: number,
  deltaY: number,
  panelWidth: number,
  panelHeight: number,
): Pick<StoryPanelImageCrop, 'focalX' | 'focalY'> {
  const width = Math.max(panelWidth, 1);
  const height = Math.max(panelHeight, 1);
  const factor = 0.5 / crop.scale;
  return {
    focalX: clamp01(crop.focalX - (deltaX / width) * factor),
    focalY: clamp01(crop.focalY - (deltaY / height) * factor),
  };
}

export function panelImageCropStyle(crop: StoryPanelImageCrop): CSSProperties {
  const focalXPercent = `${crop.focalX * 100}%`;
  const focalYPercent = `${crop.focalY * 100}%`;
  return {
    objectFit: 'cover',
    objectPosition: `${focalXPercent} ${focalYPercent}`,
    ...(crop.scale > 1
      ? {
          transform: `scale(${crop.scale})`,
          transformOrigin: `${focalXPercent} ${focalYPercent}`,
        }
      : {}),
  };
}

export function computeSourceCropBox(
  crop: StoryPanelImageCrop,
  sourceW: number,
  sourceH: number,
  targetRatio: number,
): { left: number; top: number; right: number; bottom: number } {
  const sourceRatio = sourceW / sourceH;
  let cropW: number;
  let cropH: number;
  if (sourceRatio > targetRatio) {
    cropH = sourceH;
    cropW = sourceH * targetRatio;
  } else {
    cropW = sourceW;
    cropH = sourceW / targetRatio;
  }
  cropW /= crop.scale;
  cropH /= crop.scale;
  const left = Math.max(0, Math.min(sourceW - cropW, crop.focalX * (sourceW - cropW)));
  const top = Math.max(0, Math.min(sourceH - cropH, crop.focalY * (sourceH - cropH)));
  return {
    left: Math.round(left),
    top: Math.round(top),
    right: Math.round(left + cropW),
    bottom: Math.round(top + cropH),
  };
}
