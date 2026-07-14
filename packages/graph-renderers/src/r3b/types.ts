import type { EdgeType } from '@listen-graphic/schema';
import type { CenterPos } from './force-core';
import type { NodeSize } from './node-size';

export const PIN_K_TIGHT = 0.10;
export const PIN_K_LOOSE = 0.025;
export const PIN_SOFTEN_RATIO = 0.30;
export const MAX_DRIFT_TIGHT = 50;
export const MAX_DRIFT_LOOSE = 100;

function computeU(changeRate: number): number {
  return Math.max(0, Math.min(1, changeRate / PIN_SOFTEN_RATIO));
}

export function computePinK(changeRate: number): number {
  const u = computeU(changeRate);
  return (1 - u) * PIN_K_TIGHT + u * PIN_K_LOOSE;
}

export function computeMaxDrift(changeRate: number): number {
  const u = computeU(changeRate);
  return (1 - u) * MAX_DRIFT_TIGHT + u * MAX_DRIFT_LOOSE;
}

export function computeOldMobility(changeRate: number): number {
  const u = computeU(changeRate);
  return 0.2 + 0.4 * u;
}

export function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

export type ClusterMatch = {
  newClusterId: string;
  predecessorIds: string[];
  isNew: boolean;
  isMerge: boolean;
};

export function matchClusters(
  newClusters: Array<{ id: string; nodeIds: string[] }>,
  oldClusters: Array<{ id: string; nodeIds: string[] }>,
): ClusterMatch[] {
  return newClusters.map((nc) => {
    const ncSet = new Set(nc.nodeIds);
    const predecessors = oldClusters
      .filter((oc) => oc.nodeIds.some((id) => ncSet.has(id)))
      .map((oc) => oc.id);
    return {
      newClusterId: nc.id,
      predecessorIds: predecessors,
      isNew: predecessors.length === 0,
      isMerge: predecessors.length > 1,
    };
  });
}

export type IncrementalState = {
  positions: Record<string, CenterPos>;
  /**
   * 上一轮的节点尺寸快照。注意：incremental 内核不读取此字段——
   * sizes 始终作为 computeIncrementalLayout 的参数由调用方按当前 revision 重新计算传入
   *（见 incremental.ts:58）。保留此字段供调试/外部消费方读取，但不要假设内核会继承它。
   * 修复 M4（review finding）：原无注释，易让人误以为增量会自动沿用上一轮尺寸。
   */
  sizes: Record<string, NodeSize>;
  clusterOrigins: Record<string, { x: number; y: number }>;
  prevClusters: Array<{ id: string; nodeIds: string[]; type: 'major' | 'minor' }>;
  appliedSessionId?: string;   // Task 5 用
  geometryKey?: string;        // Task 5 用
};

export function createEmptyIncrementalState(): IncrementalState {
  return { positions: {}, sizes: {}, clusterOrigins: {}, prevClusters: [] };
}

// 簇分区结果（partition.ts 产出）
export type ClusterPartition = {
  clusters: Array<{
    id: string;
    nodeIds: string[];
    edges: Array<{ source: string; target: string; type: EdgeType }>;
    type: 'major' | 'minor';
  }>;
  danglingEdges: Array<{ source: string; target: string; type: EdgeType }>;
  selfLoopNodes: string[];
};
