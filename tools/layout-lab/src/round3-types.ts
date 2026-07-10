import type { GraphNode } from '@listen-graphic/schema';

// 力 simulation 内部使用中心点坐标
export type CenterPos = { cx: number; cy: number };

// 自适应节点尺寸
export type NodeSize = { width: number; height: number };

// 力导向参数
export const FORCE_PARAMS = {
  REPULSION_K: 120,
  SPRING_LENGTH: 140,
  SPRING_K: 0.06,
  DAMPING: 0.82,
  MAX_DISPLACEMENT: 40,
  ITERATIONS: 250,
  OVERLAP_ROUNDS: 20,
} as const;

export const GRAVITY_STRENGTH = 0.015;
export const PENALTY_STRENGTH = 0.08;
export const TARGET_WIDTH = 600;
export const OUTER_TARGET_WIDTH = 800;

// 自适应节点尺寸计算参数
const CHAR_WIDTH = 12;
const PADDING = 12;
const MIN_WIDTH = 80;
const MAX_WIDTH = 200;
const MIN_HEIGHT = 50;
const TYPE_LABEL_HEIGHT = 16;
const LINE_HEIGHT = 18;
const DISPLAY_TEXT_MAX = 60;

export function truncateText(text: string, max = DISPLAY_TEXT_MAX): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function computeNodeSize(text: string): NodeSize {
  // 空文本：直接返回最小尺寸
  if (text.length === 0) return { width: MIN_WIDTH, height: MIN_HEIGHT };
  const displayText = truncateText(text);
  const textLen = displayText.length;
  const idealWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, textLen * CHAR_WIDTH + PADDING * 2));
  const charsPerLine = Math.floor((idealWidth - PADDING * 2) / CHAR_WIDTH);
  const lineCount = Math.max(1, Math.ceil(textLen / Math.max(1, charsPerLine)));
  const height = Math.max(MIN_HEIGHT, TYPE_LABEL_HEIGHT + lineCount * LINE_HEIGHT + PADDING * 2);
  return { width: idealWidth, height };
}

export function computeAllNodeSizes(nodes: GraphNode[]): Record<string, NodeSize> {
  const sizes: Record<string, NodeSize> = {};
  for (const n of nodes) {
    sizes[n.id] = computeNodeSize(n.text);
  }
  return sizes;
}
