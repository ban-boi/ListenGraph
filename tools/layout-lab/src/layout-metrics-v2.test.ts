import { describe, expect, it } from 'vitest';
import {
  centerToTopLeft,
  countPhysicalOverlaps,
  computeClearance,
  countEdgeNodeOcclusions,
  countEdgeEdgeCrossings,
  computeCanvasMetrics,
  validateCoordinates,
  computeEdgeLengthStats,
  computeLayoutQuality,
  type Position,
  type Size,
  type CenterPos,
} from './layout-metrics-v2';

// ── 测试夹具辅助函数 ──

/** 创建简单的节点位置和尺寸（左上角坐标） */
function makePositions(
  entries: Array<{ id: string; x: number; y: number; w: number; h: number }>,
): { positions: Record<string, Position>; sizes: Record<string, Size> } {
  const positions: Record<string, Position> = {};
  const sizes: Record<string, Size> = {};
  for (const e of entries) {
    positions[e.id] = { x: e.x, y: e.y };
    sizes[e.id] = { width: e.w, height: e.h };
  }
  return { positions, sizes };
}

describe('centerToTopLeft', () => {
  it('将中心点正确转换为左上角', () => {
    const centers: Record<string, CenterPos> = {
      a: { cx: 100, cy: 100 },
    };
    const sizes: Record<string, Size> = {
      a: { width: 80, height: 60 },
    };
    const result = centerToTopLeft(centers, sizes);
    expect(result.a).toEqual({ x: 60, y: 70 });
  });

  it('缺少尺寸时使用默认值 220x132', () => {
    const centers: Record<string, CenterPos> = {
      a: { cx: 100, cy: 100 },
    };
    const result = centerToTopLeft(centers, {});
    expect(result.a).toEqual({ x: -10, y: 34 });
  });

  it('空输入返回空对象', () => {
    expect(centerToTopLeft({}, {})).toEqual({});
  });
});

describe('countPhysicalOverlaps', () => {
  it('无重叠时返回 0', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 100, y: 0, w: 80, h: 60 },
    ]);
    expect(countPhysicalOverlaps(positions, sizes)).toBe(0);
  });

  it('检测真实几何重叠（零 buffer）', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 70, y: 0, w: 80, h: 60 },
    ]);
    expect(countPhysicalOverlaps(positions, sizes)).toBe(1);
  });

  it('恰好相邻不算重叠', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 80, y: 0, w: 80, h: 60 },
    ]);
    expect(countPhysicalOverlaps(positions, sizes)).toBe(0);
  });

  it('有 10px 间隙不算重叠（修正旧 countOverlaps 的 buffer 问题）', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 90, y: 0, w: 80, h: 60 },
    ]);
    expect(countPhysicalOverlaps(positions, sizes)).toBe(0);
  });

  it('多对重叠正确计数', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 40, y: 0, w: 80, h: 60 },
      { id: 'c', x: 50, y: 0, w: 80, h: 60 },
    ]);
    expect(countPhysicalOverlaps(positions, sizes)).toBe(3);
  });

  it('空输入返回 0', () => {
    expect(countPhysicalOverlaps({}, {})).toBe(0);
  });
});

describe('computeClearance', () => {
  it('无节点时返回零值', () => {
    const result = computeClearance({}, {}, 16);
    expect(result.violationPairs).toBe(0);
    expect(result.minClearance).toBe(Infinity);
    expect(result.minClearancePair).toBeNull();
  });

  it('单节点无配对', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
    ]);
    const result = computeClearance(positions, sizes, 16);
    expect(result.violationPairs).toBe(0);
  });

  it('净距 >= 阈值不算违规', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 100, y: 0, w: 80, h: 60 },
    ]);
    const result = computeClearance(positions, sizes, 16);
    expect(result.violationPairs).toBe(0);
    expect(result.minClearance).toBe(20);
    expect(result.minClearancePair).toEqual(['a', 'b']);
  });

  it('净距 < 阈值算违规', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 90, y: 0, w: 80, h: 60 },
    ]);
    const result = computeClearance(positions, sizes, 16);
    expect(result.violationPairs).toBe(1);
    expect(result.minClearance).toBe(10);
  });

  it('重叠时净距为负数', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 70, y: 0, w: 80, h: 60 },
    ]);
    const result = computeClearance(positions, sizes, 16);
    expect(result.violationPairs).toBe(1);
    expect(result.minClearance).toBe(-10);
  });

  it('多对时 p05 取第 5 百分位', () => {
    const entries: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    let xPos = 0;
    for (let i = 0; i < 20; i++) {
      entries.push({ id: `n${i}`, x: xPos, y: 0, w: 60, h: 40 });
      xPos += 60 + (i + 1) * 10;
    }
    const { positions, sizes } = makePositions(entries);
    const result = computeClearance(positions, sizes, 16);
    // 最小净距来自第一对相邻节点；p05 是全量配对第 5 百分位（含远距对），会明显高于 min
    expect(result.minClearance).toBe(10);
    expect(result.p05).toBeGreaterThanOrEqual(result.minClearance);
    expect(result.violationPairs).toBeGreaterThan(0);
  });
});

describe('countEdgeNodeOcclusions', () => {
  it('无穿越时返回 0', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 0, w: 80, h: 60 },
    ]);
    const edges = [{ source: 'a', target: 'b' }];
    expect(countEdgeNodeOcclusions(edges, positions, sizes)).toBe(0);
  });

  it('检测边穿过节点', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 25, w: 80, h: 60 },
      { id: 'b', x: 300, y: 25, w: 80, h: 60 },
      { id: 'c', x: 140, y: 25, w: 80, h: 60 },
    ]);
    const edges = [{ source: 'a', target: 'b' }];
    expect(countEdgeNodeOcclusions(edges, positions, sizes)).toBe(1);
  });

  it('边端点不算穿越', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 0, w: 80, h: 60 },
    ]);
    const edges = [{ source: 'a', target: 'b' }];
    expect(countEdgeNodeOcclusions(edges, positions, sizes)).toBe(0);
  });

  it('空边列表返回 0', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
    ]);
    expect(countEdgeNodeOcclusions([], positions, sizes)).toBe(0);
  });
});

describe('countEdgeEdgeCrossings', () => {
  it('无交叉时返回 0', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 0, w: 80, h: 60 },
      { id: 'c', x: 0, y: 200, w: 80, h: 60 },
      { id: 'd', x: 200, y: 200, w: 80, h: 60 },
    ]);
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
    ];
    expect(countEdgeEdgeCrossings(edges, positions, sizes)).toBe(0);
  });

  it('检测两条边交叉', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 200, w: 80, h: 60 },
      { id: 'c', x: 0, y: 200, w: 80, h: 60 },
      { id: 'd', x: 200, y: 0, w: 80, h: 60 },
    ]);
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
    ];
    expect(countEdgeEdgeCrossings(edges, positions, sizes)).toBe(1);
  });

  it('共享端点的边不算交叉', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 0, w: 80, h: 60 },
      { id: 'c', x: 100, y: 200, w: 80, h: 60 },
    ]);
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
    ];
    expect(countEdgeEdgeCrossings(edges, positions, sizes)).toBe(0);
  });

  it('空边列表返回 0', () => {
    expect(countEdgeEdgeCrossings([], {}, {})).toBe(0);
  });
});

describe('computeCanvasMetrics', () => {
  it('计算画布尺寸和宽高比', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 100, w: 80, h: 60 },
    ]);
    const result = computeCanvasMetrics(positions, sizes);
    expect(result.canvasWidth).toBe(280);
    expect(result.canvasHeight).toBe(160);
    expect(result.aspectRatio).toBeCloseTo(280 / 160);
  });

  it('空输入返回零值', () => {
    const result = computeCanvasMetrics({}, {});
    expect(result.canvasWidth).toBe(0);
    expect(result.canvasHeight).toBe(0);
    expect(result.aspectRatio).toBe(0);
  });

  it('单节点', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 10, y: 20, w: 80, h: 60 },
    ]);
    const result = computeCanvasMetrics(positions, sizes);
    expect(result.canvasWidth).toBe(80);
    expect(result.canvasHeight).toBe(60);
    expect(result.aspectRatio).toBeCloseTo(80 / 60);
  });
});

describe('validateCoordinates', () => {
  it('正常坐标返回 true', () => {
    const positions: Record<string, Position> = {
      a: { x: 0, y: 0 },
      b: { x: 100, y: 200 },
    };
    expect(validateCoordinates(positions)).toBe(true);
  });

  it('NaN 坐标返回 false', () => {
    const positions: Record<string, Position> = {
      a: { x: NaN, y: 0 },
    };
    expect(validateCoordinates(positions)).toBe(false);
  });

  it('Infinity 坐标返回 false', () => {
    const positions: Record<string, Position> = {
      a: { x: Infinity, y: 0 },
    };
    expect(validateCoordinates(positions)).toBe(false);
  });

  it('空输入返回 true', () => {
    expect(validateCoordinates({})).toBe(true);
  });
});

describe('computeEdgeLengthStats', () => {
  it('计算平均边长和 P95', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 0, w: 80, h: 60 },
      { id: 'c', x: 400, y: 0, w: 80, h: 60 },
    ]);
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ];
    const result = computeEdgeLengthStats(edges, positions, sizes);
    // 画布约 480x60，对角线 ~484，长边阈值 ~145；边长 200 应计为长边
    expect(result.avgEdgeLength).toBe(200);
    expect(result.p95EdgeLength).toBe(200);
    expect(result.longEdgeRatio).toBe(1);
  });

  it('空边列表返回零值', () => {
    const result = computeEdgeLengthStats([], {}, {});
    expect(result.avgEdgeLength).toBe(0);
    expect(result.p95EdgeLength).toBe(0);
    expect(result.longEdgeRatio).toBe(0);
  });
});

describe('computeLayoutQuality', () => {
  it('返回完整的布局质量指标', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 0, w: 80, h: 60 },
    ]);
    const edges = [{ source: 'a', target: 'b' }];
    const result = computeLayoutQuality(edges, positions, sizes);

    expect(result.hard.physicalOverlapPairs).toBe(0);
    expect(result.hard.clearanceViolationPairs).toBe(0);
    expect(result.hard.coordinateValidity).toBe(true);

    expect(result.soft.edgeNodeOcclusions).toBe(0);
    expect(result.soft.edgeEdgeCrossings).toBe(0);
    expect(result.soft.avgEdgeLength).toBe(200);
    expect(result.soft.canvasWidth).toBe(280);
    expect(result.soft.canvasHeight).toBe(60);
    expect(result.soft.aspectRatio).toBeCloseTo(280 / 60);

    expect(result.growth).toBeUndefined();
    expect(result.stability).toBeUndefined();
  });

  it('可选的增量指标：生长形状 + 位移计算', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 0, w: 80, h: 60 },
    ]);
    const edges = [{ source: 'a', target: 'b' }];

    const prevPositions: Record<string, Position> = {
      a: { x: 0, y: 0 },
    };
    const prevCenterPositions: Record<string, CenterPos> = {
      a: { cx: 40, cy: 30 },
    };
    const currentCenterPositions: Record<string, CenterPos> = {
      a: { cx: 40, cy: 30 },
      b: { cx: 240, cy: 30 },
    };

    const result = computeLayoutQuality(edges, positions, sizes, {
      prevPositions,
      prevCenterPositions,
      currentCenterPositions,
      oldNodeIds: new Set(['a']),
    });

    expect(result.growth).toBeDefined();
    expect(result.growth!.topExpansionPx).toBe(0);

    expect(result.stability).toBeDefined();
    expect(result.stability!.medianDisplacement).toBe(0);
    expect(result.stability!.maxDisplacement).toBe(0);
    expect(result.stability!.oldNodeCount).toBe(1);
  });
});

describe('边界情况', () => {
  it('自环边被忽略', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
    ]);
    const edges = [{ source: 'a', target: 'a' }];
    const result = computeLayoutQuality(edges, positions, sizes);
    expect(result.soft.edgeNodeOcclusions).toBe(0);
    expect(result.soft.edgeEdgeCrossings).toBe(0);
  });

  it('缺失位置的边被忽略', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
    ]);
    const edges = [{ source: 'a', target: 'missing' }];
    const result = computeLayoutQuality(edges, positions, sizes);
    expect(result.soft.avgEdgeLength).toBe(0);
  });

  it('所有节点重叠在同一位置', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 0, y: 0, w: 80, h: 60 },
      { id: 'c', x: 0, y: 0, w: 80, h: 60 },
    ]);
    const result = computeLayoutQuality([], positions, sizes);
    expect(result.hard.physicalOverlapPairs).toBe(3);
    expect(result.soft.clearance.minClearance).toBeLessThan(0);
  });

  it('节点恰好相邻（净距 = 0）', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 80, y: 0, w: 80, h: 60 },
    ]);
    const result = computeLayoutQuality([], positions, sizes, { clearanceThreshold: 16 });
    expect(result.hard.physicalOverlapPairs).toBe(0);
    expect(result.hard.clearanceViolationPairs).toBe(1);
  });
});
