import {
  computeClearance,
  countEdgeEdgeCrossings,
  countPhysicalOverlaps,
  computeEdgeLengthStats,
  type Edge,
  type Position,
  type Size,
} from './layout-metrics-v2';

export type DomRect = {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type DomLayoutMetrics = {
  nodeCount: number;
  edgeCount: number;
  pairCount: number;
  avgEdgeLength: number;
  p95EdgeLength: number;
  longEdgeRatio: number;
  overlapPairs: number;
  clearanceViolationPairs: number;
  minClearance: number;
  edgeEdgeCrossings: number;
};

function nodeIdFromTestId(testId: string): string {
  const prefix = 'graph-node-card-';
  return testId.startsWith(prefix) ? testId.slice(prefix.length) : testId;
}

export function computeDomLayoutMetrics(
  rects: DomRect[],
  edges: Edge[],
  opts: { clearanceThreshold?: number } = {},
): DomLayoutMetrics {
  const clearanceThreshold = opts.clearanceThreshold ?? 16;
  const positions: Record<string, Position> = {};
  const sizes: Record<string, Size> = {};

  for (const r of rects) {
    const id = nodeIdFromTestId(r.id);
    positions[id] = { x: r.left, y: r.top };
    sizes[id] = { width: r.right - r.left, height: r.bottom - r.top };
  }

  const edgeStats = computeEdgeLengthStats(edges, positions, sizes);
  const clearance = computeClearance(positions, sizes, clearanceThreshold);
  const pairCount = (rects.length * (rects.length - 1)) / 2;

  return {
    nodeCount: rects.length,
    edgeCount: edges.filter((e) => positions[e.source] && positions[e.target]).length,
    pairCount,
    avgEdgeLength: edgeStats.avgEdgeLength,
    p95EdgeLength: edgeStats.p95EdgeLength,
    longEdgeRatio: edgeStats.longEdgeRatio,
    overlapPairs: countPhysicalOverlaps(positions, sizes),
    clearanceViolationPairs: clearance.violationPairs,
    minClearance: clearance.minClearance,
    edgeEdgeCrossings: countEdgeEdgeCrossings(edges, positions, sizes),
  };
}
