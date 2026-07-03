import { detectHierarchyLayoutPattern } from '../../../packages/graph-renderers/src/hierarchy.ts';
import type { MergedGraph } from '@listen-graphic/schema';
import type { DetectorCheck } from './types';

// 只用于"detector 说了什么"对照列，绝不参与 metrics 判断（见 spec 3.5）
export function whatDetectorSays(graph: MergedGraph): DetectorCheck {
  const result = detectHierarchyLayoutPattern(graph);
  return {
    pattern: result?.pattern ?? '(未匹配)',
    ...(result?.rootNodeId ? { rootNodeId: result.rootNodeId } : {}),
  };
}
