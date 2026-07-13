import type { NodeType } from '@listen-graphic/schema';
import { truncateText } from './node-size';

export type NodeGeometry = {
  position: { x: number; y: number };
  size: { width: number; height: number };
};

export type NodeDisplayMode = 'readable' | 'compact';

export function computeRealNodeSize(
  text: string,
  nodeType: NodeType,
  hasSpeaker: boolean,
  hasTimestamp: boolean,
  displayMode: NodeDisplayMode = 'readable',
): { width: number; height: number } {
  const isCompact = displayMode === 'compact';
  const maxTextChars = isCompact ? 56 : 80;
  const displayText = truncateText(text, maxTextChars);
  const charWidth = isCompact ? 7 : 12;
  const padding = isCompact ? 8 : 16;
  const maxWidth = isCompact ? 200 : 220;
  const minWidth = isCompact ? 140 : 80;

  const idealWidth = Math.min(maxWidth, Math.max(minWidth, displayText.length * charWidth + padding * 2));
  const charsPerLine = Math.max(1, Math.floor((idealWidth - padding * 2) / charWidth));
  const lineCount = Math.max(1, Math.ceil(displayText.length / charsPerLine));
  const lineHeight = isCompact ? 16 : 18;

  const typeLabelH = 16;
  const textH = lineCount * lineHeight;
  const speakerH = hasSpeaker ? 14 : 0;
  const timestampH = hasTimestamp ? 14 : 0;
  const height = Math.max(isCompact ? 50 : 60, typeLabelH + textH + speakerH + timestampH + padding * 2);

  return { width: idealWidth, height };
}
