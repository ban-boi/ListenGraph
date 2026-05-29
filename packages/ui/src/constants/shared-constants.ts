import type { ViewType } from '@listen-graphic/schema';

/** 所有支持的视图类型 */
export const VIEW_TYPES: ViewType[] = [
  'causal',
  'timeline',
  'comparison',
  'hierarchy',
];

/** 视图类型 → 中文标签 */
export const VIEW_LABELS: Record<ViewType, string> = {
  causal: '因果',
  timeline: '时间线',
  comparison: '对比',
  hierarchy: '层级',
};
