import type { CSSProperties } from 'react';
import type { StoryPanel, StoryPanelTextStyle } from '../types';
import { isCaption } from './panelModel';

export type CaptionSpeechKind = 'dialogue' | 'narration';

export const CAPTION_COLOR_PRESETS = [
  '#111827',
  '#ffffff',
  '#eab308',
  '#1e40af',
  '#991b1b',
  '#166534',
  '#6d28d9',
] as const;

export const defaultDialogueCaptionStyle: StoryPanelTextStyle = {
  fontFamily: 'comic',
  fontSize: 7,
  align: 'center',
  speechKind: 'dialogue',
  background: 'white',
  color: '#111827',
  outlineColor: '#ffffff',
};

export const defaultNarrationCaptionStyle: StoryPanelTextStyle = {
  fontFamily: 'serif',
  fontSize: 7,
  align: 'center',
  speechKind: 'narration',
  background: 'transparent',
  color: '#111827',
  outlineColor: '#ffffff',
};

export const defaultCaptionTextStyle: StoryPanelTextStyle = { ...defaultDialogueCaptionStyle };

const textFontFamilies: Record<StoryPanelTextStyle['fontFamily'], string> = {
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  comic: '"Comic Sans MS", "Comic Sans", cursive',
};

export function captionSpeechKindFor(style: StoryPanelTextStyle): CaptionSpeechKind {
  return style.speechKind === 'narration' ? 'narration' : 'dialogue';
}

export function captionBackgroundForSpeech(speechKind: CaptionSpeechKind): 'transparent' | 'white' {
  return speechKind === 'narration' ? 'transparent' : 'white';
}

export function captionStyleForPanel(panel: StoryPanel): StoryPanelTextStyle {
  const speechKind = captionSpeechKindFor({ ...defaultCaptionTextStyle, ...(panel.textStyle ?? {}) });
  const defaults = speechKind === 'narration' ? defaultNarrationCaptionStyle : defaultDialogueCaptionStyle;
  const merged = { ...defaults, ...(panel.textStyle ?? {}), speechKind };
  return {
    ...merged,
    background: captionBackgroundForSpeech(speechKind),
  };
}

export function captionStyleForSpeechKind(speechKind: CaptionSpeechKind): StoryPanelTextStyle {
  return speechKind === 'narration' ? { ...defaultNarrationCaptionStyle } : { ...defaultDialogueCaptionStyle };
}

export function captionTextOutlineShadow(outlineColor: string): string {
  const outline = outlineColor || '#ffffff';
  return [
    `-1px -1px 0 ${outline}`,
    `1px -1px 0 ${outline}`,
    `-1px 1px 0 ${outline}`,
    `1px 1px 0 ${outline}`,
    `0 -1px 0 ${outline}`,
    `0 1px 0 ${outline}`,
    `-1px 0 0 ${outline}`,
    `1px 0 0 ${outline}`,
  ].join(', ');
}

export function captionPanelClassName(panel: StoryPanel): string {
  if (!isCaption(panel)) return '';
  const style = captionStyleForPanel(panel);
  const classes = [
    style.background === 'transparent' ? 'is-caption-bg-transparent' : '',
    captionSpeechKindFor(style) === 'dialogue' ? 'is-caption-dialogue' : 'is-caption-narration',
  ];
  return classes.filter(Boolean).join(' ');
}

export function captionPanelCssProperties(panel: StoryPanel): CSSProperties & Record<string, string> {
  const style = captionStyleForPanel(panel);
  const transparent = style.background === 'transparent';
  const dialogue = captionSpeechKindFor(style) === 'dialogue';
  const outlineShadow = captionTextOutlineShadow(style.outlineColor ?? '#ffffff');
  return {
    '--story-caption-color': style.color ?? '#111827',
    '--story-caption-bg': transparent ? 'transparent' : '#ffffff',
    '--story-caption-border-color': transparent ? 'transparent' : '#cbd5e1',
    '--story-caption-radius': dialogue ? '9999px' : '2px',
    '--story-caption-outline-shadow': transparent ? outlineShadow : 'none',
    color: style.color ?? '#111827',
    backgroundColor: transparent ? 'transparent' : '#ffffff',
    ...(transparent ? { textShadow: outlineShadow } : {}),
  };
}

export function fitCaptionHeightRows(
  caption: StoryPanel,
  text: string,
  gridElement: HTMLElement,
  pageRows: number,
  snapScale: number,
): number {
  const bounds = gridElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0 || pageRows <= 0) return caption.rect.h;
  const style = captionStyleForPanel(caption);
  const panelWidthPx = (caption.rect.w / 12) * bounds.width;
  const fontSizePx = (style.fontSize / 360) * bounds.width;
  const paddingPx = (1.388889 / 100) * bounds.width * 2;
  const measure = document.createElement('div');
  measure.style.position = 'absolute';
  measure.style.visibility = 'hidden';
  measure.style.pointerEvents = 'none';
  measure.style.left = '0';
  measure.style.top = '0';
  measure.style.width = `${Math.max(1, panelWidthPx - paddingPx)}px`;
  measure.style.fontFamily = textFontFamilies[style.fontFamily];
  measure.style.fontSize = `${fontSizePx}px`;
  measure.style.lineHeight = '1.2';
  measure.style.whiteSpace = 'pre-wrap';
  measure.style.wordBreak = 'break-word';
  measure.textContent = text.trim() || ' ';
  gridElement.appendChild(measure);
  const contentHeight = measure.scrollHeight;
  gridElement.removeChild(measure);
  const rowHeightPx = bounds.height / pageRows;
  const rows = Math.round(((contentHeight + paddingPx) / rowHeightPx) * snapScale) / snapScale;
  return Math.max(0.25, rows);
}

function measureCaptionTextHeight(
  caption: StoryPanel,
  text: string,
  gridElement: HTMLElement,
  fontSize: number,
): { contentHeight: number; paddingPx: number } | null {
  const bounds = gridElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const style = { ...captionStyleForPanel(caption), fontSize };
  const panelWidthPx = (caption.rect.w / 12) * bounds.width;
  const fontSizePx = (style.fontSize / 360) * bounds.width;
  const paddingPx = (1.388889 / 100) * bounds.width * 2;
  const measure = document.createElement('div');
  measure.style.position = 'absolute';
  measure.style.visibility = 'hidden';
  measure.style.pointerEvents = 'none';
  measure.style.left = '0';
  measure.style.top = '0';
  measure.style.width = `${Math.max(1, panelWidthPx - paddingPx)}px`;
  measure.style.fontFamily = textFontFamilies[style.fontFamily];
  measure.style.fontSize = `${fontSizePx}px`;
  measure.style.lineHeight = '1.2';
  measure.style.whiteSpace = 'pre-wrap';
  measure.style.wordBreak = 'break-word';
  measure.textContent = text.trim() || ' ';
  gridElement.appendChild(measure);
  const contentHeight = measure.scrollHeight;
  gridElement.removeChild(measure);
  return { contentHeight, paddingPx };
}

export function fitCaptionFontSize(
  caption: StoryPanel,
  text: string,
  gridElement: HTMLElement,
  pageRows: number,
): number {
  const bounds = gridElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0 || pageRows <= 0) return captionStyleForPanel(caption).fontSize;
  const targetHeight = (caption.rect.h / pageRows) * bounds.height;
  let bestSize = 6;
  for (let size = 6; size <= 48; size += 1) {
    const measured = measureCaptionTextHeight(caption, text, gridElement, size);
    if (!measured) return captionStyleForPanel(caption).fontSize;
    if (measured.contentHeight + measured.paddingPx > targetHeight) break;
    bestSize = size;
  }
  return bestSize;
}
