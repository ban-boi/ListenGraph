// ── 输入类型 ──

/** 节点位置（左上角坐标） */
export type Position = { x: number; y: number };

/** 节点尺寸 */
export type Size = { width: number; height: number };

/** 中心点坐标（力导向布局内部使用） */
export type CenterPos = { cx: number; cy: number };

/** 边的端点信息（用于指标计算） */
export type Edge = { source: string; target: string };

// ── 输出类型 ──

/** 硬约束指标：任何 case 都不能违反 */
export type HardConstraints = {
  /** 真实几何重叠对数（零 buffer） */
  physicalOverlapPairs: number;
  /** 净距不足指定阈值的对数 */
  clearanceViolationPairs: number;
  /** 坐标有效性（无 NaN/Infinity） */
  coordinateValidity: boolean;
};

/** 净距分析报告 */
export type ClearanceReport = {
  /** 净距不足阈值的对数 */
  violationPairs: number;
  /** 第 5 百分位净距（px） */
  p05: number;
  /** 最小净距（px） */
  minClearance: number;
  /** 最小净距对应的节点对 */
  minClearancePair: [string, string] | null;
};

/** 软目标指标：允许权衡，但不能明显回退 */
export type SoftTargets = {
  /** 边穿过无关节点的次数 */
  edgeNodeOcclusions: number;
  /** 边与边交叉的次数 */
  edgeEdgeCrossings: number;
  /** 平均边长（px） */
  avgEdgeLength: number;
  /** P95 边长（px） */
  p95EdgeLength: number;
  /** 长边比例（长度 > 画布对角线 30%） */
  longEdgeRatio: number;
  /** 画布宽度（px） */
  canvasWidth: number;
  /** 画布高度（px） */
  canvasHeight: number;
  /** 宽高比（width / height，越小越竖向） */
  aspectRatio: number;
  /** 净距详细报告 */
  clearance: ClearanceReport;
};

/** 增量稳定性指标 */
export type IncrementalStability = {
  /** 旧节点中位位移（px） */
  medianDisplacement: number;
  /** 旧节点最大位移（px） */
  maxDisplacement: number;
  /** 触发漂移上限的旧节点比例 */
  capHitRate: number;
  /** 旧节点数量 */
  oldNodeCount: number;
};

/** 生长形状指标（需要前一 revision 的状态） */
export type GrowthShape = {
  /** 顶部扩张量（px），理想值 = 0 */
  topExpansionPx: number;
  /** 新增空间中底部占比（0-1，理想值 > 0.7） */
  bottomGrowthShare: number;
};

/** 完整布局质量指标 */
export type LayoutQualityMetrics = {
  hard: HardConstraints;
  soft: SoftTargets;
  growth?: GrowthShape;
  stability?: IncrementalStability;
};

/** 画布尺寸指标 */
export type CanvasMetrics = {
  canvasWidth: number;
  canvasHeight: number;
  aspectRatio: number;
};

/** 边长统计 */
export type EdgeLengthStats = {
  avgEdgeLength: number;
  p95EdgeLength: number;
  longEdgeRatio: number;
};

const DEFAULT_SIZE: Size = { width: 220, height: 132 };

// ── 工具函数 ──

/**
 * 将中心点坐标转换为左上角坐标。
 * 力导向布局内部用中心点，指标计算用左上角。
 */
export function centerToTopLeft(
  positions: Record<string, CenterPos>,
  sizes: Record<string, Size>,
): Record<string, Position> {
  const result: Record<string, Position> = {};
  for (const [id, pos] of Object.entries(positions)) {
    const size = sizes[id] ?? DEFAULT_SIZE;
    result[id] = {
      x: pos.cx - size.width / 2,
      y: pos.cy - size.height / 2,
    };
  }
  return result;
}

/**
 * 统计真实几何重叠对数（零 buffer）。
 * 与旧 countOverlaps 不同：旧版带 10px gap，统计的是"间距不足10px"。
 * 此函数只统计真正的 AABB 重叠。
 */
export function countPhysicalOverlaps(
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
): number {
  const ids = Object.keys(positions);
  let overlaps = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = positions[ids[i]];
      const b = positions[ids[j]];
      const sa = sizes[ids[i]] ?? DEFAULT_SIZE;
      const sb = sizes[ids[j]] ?? DEFAULT_SIZE;
      const noOverlap =
        a.x + sa.width <= b.x ||
        b.x + sb.width <= a.x ||
        a.y + sa.height <= b.y ||
        b.y + sb.height <= a.y;
      if (!noOverlap) overlaps++;
    }
  }
  return overlaps;
}

/**
 * 计算净距分析报告。
 * 净距 = 两个节点 AABB 之间的距离（可为负数，表示重叠）。
 */
export function computeClearance(
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
  violationThreshold: number,
): ClearanceReport {
  const ids = Object.keys(positions);
  if (ids.length < 2) {
    return {
      violationPairs: 0,
      p05: Infinity,
      minClearance: Infinity,
      minClearancePair: null,
    };
  }

  const clearances: Array<{ clearance: number; pair: [string, string] }> = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = positions[ids[i]];
      const b = positions[ids[j]];
      const sa = sizes[ids[i]] ?? DEFAULT_SIZE;
      const sb = sizes[ids[j]] ?? DEFAULT_SIZE;

      const gapRight = b.x - (a.x + sa.width);
      const gapLeft = a.x - (b.x + sb.width);
      const gapBottom = b.y - (a.y + sa.height);
      const gapTop = a.y - (b.y + sb.height);

      const dx = Math.max(gapRight, gapLeft);
      const dy = Math.max(gapBottom, gapTop);

      let clearance: number;
      if (dx > 0 && dy > 0) {
        clearance = Math.sqrt(dx * dx + dy * dy);
      } else if (dx > 0) {
        clearance = dx;
      } else if (dy > 0) {
        clearance = dy;
      } else {
        const overlapX = Math.min(a.x + sa.width, b.x + sb.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + sa.height, b.y + sb.height) - Math.max(a.y, b.y);
        clearance = -Math.min(overlapX, overlapY);
      }

      clearances.push({ clearance, pair: [ids[i], ids[j]] });
    }
  }

  clearances.sort((a, b) => a.clearance - b.clearance);

  const violationPairs = clearances.filter((c) => c.clearance < violationThreshold).length;
  const minEntry = clearances[0];
  const p05Index = Math.max(0, Math.floor(clearances.length * 0.05));
  const p05 = clearances[p05Index]?.clearance ?? Infinity;

  return {
    violationPairs,
    p05,
    minClearance: minEntry?.clearance ?? Infinity,
    minClearancePair: minEntry?.pair ?? null,
  };
}

/**
 * 线段与轴对齐矩形的相交检测。
 */
function lineIntersectsRect(
  p1: Position,
  p2: Position,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  if (p1.x >= rx && p1.x <= rx + rw && p1.y >= ry && p1.y <= ry + rh) return true;
  if (p2.x >= rx && p2.x <= rx + rw && p2.y >= ry && p2.y <= ry + rh) return true;

  const r1 = { x: rx, y: ry };
  const r2 = { x: rx + rw, y: ry };
  const r3 = { x: rx + rw, y: ry + rh };
  const r4 = { x: rx, y: ry + rh };

  return (
    segmentsIntersect(p1, p2, r1, r2) ||
    segmentsIntersect(p1, p2, r2, r3) ||
    segmentsIntersect(p1, p2, r3, r4) ||
    segmentsIntersect(p1, p2, r4, r1)
  );
}

/** 两条线段是否相交（共端点不算，但共线重叠算） */
function segmentsIntersect(
  p1: Position,
  p2: Position,
  p3: Position,
  p4: Position,
): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }

  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;

  return false;
}

function direction(p1: Position, p2: Position, p3: Position): number {
  return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
}

function onSegment(p1: Position, p2: Position, p3: Position): boolean {
  return (
    Math.min(p1.x, p2.x) <= p3.x &&
    p3.x <= Math.max(p1.x, p2.x) &&
    Math.min(p1.y, p2.y) <= p3.y &&
    p3.y <= Math.max(p1.y, p2.y)
  );
}

/**
 * 获取节点中心点坐标。
 * 所有边相关指标统一使用中心点，避免混用左上角/中心点。
 */
function getCenter(
  id: string,
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
): Position {
  const p = positions[id];
  const s = sizes[id] ?? DEFAULT_SIZE;
  return { x: p.x + s.width / 2, y: p.y + s.height / 2 };
}

/**
 * 统计边穿过无关节点的次数。
 */
export function countEdgeNodeOcclusions(
  edges: Edge[],
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
): number {
  const validIds = new Set(Object.keys(positions));
  const validEdges = edges.filter(
    (e) => validIds.has(e.source) && validIds.has(e.target) && e.source !== e.target,
  );

  let occlusions = 0;
  for (const edge of validEdges) {
    const s = getCenter(edge.source, positions, sizes);
    const t = getCenter(edge.target, positions, sizes);
    for (const nodeId of validIds) {
      if (nodeId === edge.source || nodeId === edge.target) continue;
      const np = positions[nodeId];
      const ns = sizes[nodeId] ?? DEFAULT_SIZE;
      if (lineIntersectsRect(s, t, np.x, np.y, ns.width, ns.height)) {
        occlusions++;
      }
    }
  }
  return occlusions;
}

/**
 * 统计边与边交叉的次数。
 * 共享端点的边不算交叉。
 */
export function countEdgeEdgeCrossings(
  edges: Edge[],
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
): number {
  const validIds = new Set(Object.keys(positions));
  const validEdges = edges.filter(
    (e) => validIds.has(e.source) && validIds.has(e.target) && e.source !== e.target,
  );

  let crossings = 0;
  for (let i = 0; i < validEdges.length; i++) {
    for (let j = i + 1; j < validEdges.length; j++) {
      const e1 = validEdges[i];
      const e2 = validEdges[j];

      if (
        e1.source === e2.source ||
        e1.source === e2.target ||
        e1.target === e2.source ||
        e1.target === e2.target
      ) {
        continue;
      }

      const p1 = getCenter(e1.source, positions, sizes);
      const p2 = getCenter(e1.target, positions, sizes);
      const p3 = getCenter(e2.source, positions, sizes);
      const p4 = getCenter(e2.target, positions, sizes);

      if (segmentsIntersect(p1, p2, p3, p4)) {
        crossings++;
      }
    }
  }
  return crossings;
}

/**
 * 计算画布尺寸和宽高比。
 */
export function computeCanvasMetrics(
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
): CanvasMetrics {
  const ids = Object.keys(positions);
  if (ids.length === 0) {
    return { canvasWidth: 0, canvasHeight: 0, aspectRatio: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    const s = sizes[id] ?? DEFAULT_SIZE;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.width);
    maxY = Math.max(maxY, p.y + s.height);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  return {
    canvasWidth: width,
    canvasHeight: height,
    aspectRatio: height > 0 ? width / height : 0,
  };
}

/**
 * 验证坐标有效性（无 NaN、无 Infinity）。
 */
export function validateCoordinates(positions: Record<string, Position>): boolean {
  for (const p of Object.values(positions)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  return true;
}

/**
 * 计算边长统计。
 * 长边定义：长度 > 画布对角线 * 0.3。
 */
export function computeEdgeLengthStats(
  edges: Edge[],
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
): EdgeLengthStats {
  const validIds = new Set(Object.keys(positions));
  const validEdges = edges.filter(
    (e) => validIds.has(e.source) && validIds.has(e.target) && e.source !== e.target,
  );

  if (validEdges.length === 0) {
    return { avgEdgeLength: 0, p95EdgeLength: 0, longEdgeRatio: 0 };
  }

  const lengths = validEdges.map((e) => {
    const s = getCenter(e.source, positions, sizes);
    const t = getCenter(e.target, positions, sizes);
    return Math.sqrt((s.x - t.x) ** 2 + (s.y - t.y) ** 2);
  });

  lengths.sort((a, b) => a - b);

  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const p95Index = Math.min(lengths.length - 1, Math.floor(lengths.length * 0.95));
  const p95 = lengths[p95Index];

  const canvas = computeCanvasMetrics(positions, sizes);
  const diagonal = Math.sqrt(canvas.canvasWidth ** 2 + canvas.canvasHeight ** 2);
  const longThreshold = diagonal * 0.3;
  const longCount = lengths.filter((l) => l > longThreshold).length;

  return {
    avgEdgeLength: Math.round(avg),
    p95EdgeLength: Math.round(p95),
    longEdgeRatio: Math.round((longCount / lengths.length) * 100) / 100,
  };
}

/**
 * 从前后两个 revision 的中心点坐标计算增量位移统计。
 */
export function computeDisplacement(
  prevPositions: Record<string, CenterPos>,
  positions: Record<string, CenterPos>,
  oldNodeIds: Set<string>,
  maxDrift: number = 100,
): IncrementalStability {
  const displacements: number[] = [];
  let capHits = 0;

  for (const id of oldNodeIds) {
    const prev = prevPositions[id];
    const curr = positions[id];
    if (!prev || !curr) continue;
    const dist = Math.sqrt((curr.cx - prev.cx) ** 2 + (curr.cy - prev.cy) ** 2);
    displacements.push(dist);
    if (dist > maxDrift) capHits++;
  }

  if (displacements.length === 0) {
    return { medianDisplacement: 0, maxDisplacement: 0, capHitRate: 0, oldNodeCount: 0 };
  }

  displacements.sort((a, b) => a - b);
  const mid = Math.floor(displacements.length / 2);
  const median =
    displacements.length % 2 === 0
      ? (displacements[mid - 1] + displacements[mid]) / 2
      : displacements[mid];

  return {
    medianDisplacement: Math.round(median),
    maxDisplacement: Math.round(displacements[displacements.length - 1]),
    capHitRate: Math.round((capHits / displacements.length) * 100) / 100,
    oldNodeCount: displacements.length,
  };
}

/**
 * 计算完整的布局质量指标。
 * 这是主要的入口函数，聚合所有子指标。
 */
export function computeLayoutQuality(
  edges: Edge[],
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
  options?: {
    prevPositions?: Record<string, Position>;
    prevCenterPositions?: Record<string, CenterPos>;
    currentCenterPositions?: Record<string, CenterPos>;
    oldNodeIds?: Set<string>;
    maxDrift?: number;
    clearanceThreshold?: number;
  },
): LayoutQualityMetrics {
  const threshold = options?.clearanceThreshold ?? 16;

  const hard: HardConstraints = {
    physicalOverlapPairs: countPhysicalOverlaps(positions, sizes),
    clearanceViolationPairs: computeClearance(positions, sizes, threshold).violationPairs,
    coordinateValidity: validateCoordinates(positions),
  };

  const canvas = computeCanvasMetrics(positions, sizes);
  const clearance = computeClearance(positions, sizes, threshold);
  const edgeStats = computeEdgeLengthStats(edges, positions, sizes);

  const soft: SoftTargets = {
    edgeNodeOcclusions: countEdgeNodeOcclusions(edges, positions, sizes),
    edgeEdgeCrossings: countEdgeEdgeCrossings(edges, positions, sizes),
    avgEdgeLength: edgeStats.avgEdgeLength,
    p95EdgeLength: edgeStats.p95EdgeLength,
    longEdgeRatio: edgeStats.longEdgeRatio,
    canvasWidth: canvas.canvasWidth,
    canvasHeight: canvas.canvasHeight,
    aspectRatio: canvas.aspectRatio,
    clearance,
  };

  let growth: GrowthShape | undefined;
  if (options?.prevPositions) {
    const prevIds = Object.keys(options.prevPositions);
    const currIds = Object.keys(positions);
    if (prevIds.length > 0 && currIds.length > 0) {
      let prevMinY = Infinity;
      let prevMaxY = -Infinity;
      for (const id of prevIds) {
        const p = options.prevPositions[id];
        const s = sizes[id] ?? DEFAULT_SIZE;
        prevMinY = Math.min(prevMinY, p.y);
        prevMaxY = Math.max(prevMaxY, p.y + s.height);
      }
      let currMinY = Infinity;
      let currMaxY = -Infinity;
      for (const id of currIds) {
        const p = positions[id];
        const s = sizes[id] ?? DEFAULT_SIZE;
        currMinY = Math.min(currMinY, p.y);
        currMaxY = Math.max(currMaxY, p.y + s.height);
      }

      const topExpansion = Math.max(0, prevMinY - currMinY);
      const bottomExpansion = Math.max(0, currMaxY - prevMaxY);
      const totalGrowth = topExpansion + bottomExpansion;

      growth = {
        topExpansionPx: topExpansion,
        bottomGrowthShare: totalGrowth > 0 ? bottomExpansion / totalGrowth : 0,
      };
    }
  }

  let stability: IncrementalStability | undefined;
  if (
    options?.prevCenterPositions &&
    options?.currentCenterPositions &&
    options?.oldNodeIds
  ) {
    stability = computeDisplacement(
      options.prevCenterPositions,
      options.currentCenterPositions,
      options.oldNodeIds,
      options?.maxDrift,
    );
  }

  return { hard, soft, growth, stability };
}
