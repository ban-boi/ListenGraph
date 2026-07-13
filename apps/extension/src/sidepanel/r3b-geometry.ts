import type { MergedGraph } from '@listen-graphic/schema';
import {
  computeIncrementalLayout,
  computeRealNodeSize,
  createEmptyIncrementalState,
  type IncrementalState,
  type NodeSize,
} from '@listen-graphic/graph-renderers';

export type R3bGeometry = {
  // center 格式坐标
  positions: Record<string, { cx: number; cy: number }>;
  // 唯一尺寸来源（力计算 + 碰撞 + React Flow + handles + auto-tour 全用这份）
  sizes: Record<string, NodeSize>;
  // top-left 格式（React Flow 需要的）
  geometries: Record<string, { position: { x: number; y: number }; size: NodeSize }>;
  // 下一个 revision 的状态
  nextState: IncrementalState;
  // geometry key（幂等用）
  geometryKey: string;
};

function computeSizes(graph: MergedGraph): Record<string, NodeSize> {
  const sizes: Record<string, NodeSize> = {};
  for (const n of graph.nodes) {
    sizes[n.id] = computeRealNodeSize(n.text, n.type, !!n.speaker, true, 'readable');
  }
  return sizes;
}

// 算 geometry key：节点 ID 集合 + 尺寸签名 + revision
function computeGeometryKey(graph: MergedGraph, sizes: Record<string, NodeSize>): string {
  const ids = graph.nodes.map((n) => n.id).sort().join(',');
  const sizeSig = graph.nodes
    .map((n) => {
      const s = sizes[n.id];
      return `${n.id}:${Math.round(s?.width ?? 0)}x${Math.round(s?.height ?? 0)}`;
    })
    .sort()
    .join(',');
  return `${graph.sessionId}:${graph.revision}:${ids}:${sizeSig}`;
}

function buildGeometries(
  graph: MergedGraph,
  positions: Record<string, { cx: number; cy: number }>,
  sizes: Record<string, NodeSize>,
): Record<string, { position: { x: number; y: number }; size: NodeSize }> {
  const geometries: Record<string, { position: { x: number; y: number }; size: NodeSize }> = {};
  for (const n of graph.nodes) {
    const cp = positions[n.id];
    const s = sizes[n.id];
    if (cp && s) {
      geometries[n.id] = { position: { x: cp.cx - s.width / 2, y: cp.cy - s.height / 2 }, size: s };
    }
  }
  return geometries;
}

export function buildR3bGeometry(
  graph: MergedGraph,
  previousState: IncrementalState,
): R3bGeometry {
  const sizes = computeSizes(graph);
  const key = computeGeometryKey(graph, sizes);

  // 幂等：相同 session + 相同 geometry key → 返回已有 positions
  if (
    previousState.appliedSessionId === graph.sessionId &&
    previousState.geometryKey === key &&
    previousState.positions &&
    Object.keys(previousState.positions).length > 0
  ) {
    const geometries = buildGeometries(graph, previousState.positions, sizes);
    return {
      positions: previousState.positions,
      sizes,
      geometries,
      nextState: previousState,
      geometryKey: key,
    };
  }

  // 跑增量布局，传入 sizes（力计算 + 碰撞用同一份）
  const result = computeIncrementalLayout(graph, previousState, 'R3b', sizes);
  const geometries = buildGeometries(graph, result.positions, sizes);

  const nextState: IncrementalState = {
    ...result.state,
    appliedSessionId: graph.sessionId,
    geometryKey: key,
  };

  return { positions: result.positions, sizes, geometries, nextState, geometryKey: key };
}

export { createEmptyIncrementalState };
