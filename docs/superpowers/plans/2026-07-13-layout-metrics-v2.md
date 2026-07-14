# Layout Metrics V2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立唯一的布局质量指标模块，统一口径、修正定义、补充缺失指标，为 Round 5 和未来回归体系提供真相源。

**Architecture:** 纯函数模块，接受 positions + sizes 输入，输出指标数字。不依赖布局算法本身，不修改现有调用方。TDD 驱动，每个 task 先写测试再实现。

**Tech Stack:** TypeScript, Vitest, 纯函数无外部依赖

---

## 文件结构

| 操作 | 文件 | 职责 |
|---|---|---|
| 创建 | `tools/layout-lab/src/layout-metrics-v2.ts` | 唯一真相源：所有布局质量指标的类型定义和计算函数 |
| 创建 | `tools/layout-lab/src/layout-metrics-v2.test.ts` | 全部测试 |

**不修改的文件**（避免与 Round 5 冲突）：
- `cluster-internal-layouts.ts` — 旧 `computeLayoutMetrics` 保留不动
- `round3-gallery.ts` — 旧 `countOverlaps` 保留不动
- `replay-sequence.ts` — 旧 `countOverlapPairs` 保留不动
- `incremental-force.ts` — 旧 `DisplacementStats` 保留不动

新代码调用新模块，旧代码继续工作。**迁移旧调用方到新模块是独立任务，不在本计划范围内**——等 Round 5 产品接入稳定后再做。

---

## 与旧模块的口径修正

| 旧定义 | 问题 | 新定义 |
|---|---|---|
| `edgeCrossings`（边穿过节点） | 名字暗示边-边交叉 | `edgeNodeOcclusions`（明确语义） |
| `countOverlaps`（10px buffer） | 统计的是"间距不足10px"不是重叠 | `physicalOverlapPairs`（零 buffer，纯几何重叠） |
| 无 | 缺少边-边交叉检测 | `edgeEdgeCrossings`（O(E²) 线段相交） |
| 无 | 缺少净距分析 | `clearanceViolationPairs` / `clearanceP05` / `minClearance` |
| 无 | 缺少向下生长形状指标 | `topExpansionPx` / `bottomGrowthShare` / `canvasWidth` / `canvasHeight` |

---

### Task 1: 类型定义与测试夹具

**Files:**
- 创建: `tools/layout-lab/src/layout-metrics-v2.ts`
- 创建: `tools/layout-lab/src/layout-metrics-v2.test.ts`

- [ ] **Step 1: 写类型定义的空壳文件**

```typescript
// tools/layout-lab/src/layout-metrics-v2.ts

// ── 输入类型 ──

/** 节点位置（左上角坐标） */
export type Position = { x: number; y: number };

/** 节点尺寸 */
export type Size = { width: number; height: number };

/** 中心点坐标（力导向布局内部使用） */
export type CenterPos = { cx: number; cy: number };

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
    const size = sizes[id] ?? { width: 220, height: 132 };
    result[id] = {
      x: pos.cx - size.width / 2,
      y: pos.cy - size.height / 2,
    };
  }
  return result;
}
```

- [ ] **Step 2: 写测试夹具辅助函数**

在 `layout-metrics-v2.test.ts` 中写入：

```typescript
import { describe, expect, it } from 'vitest';
import {
  centerToTopLeft,
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

  it('缺少尺寸时使用默认值 160x80', () => {
    const centers: Record<string, CenterPos> = {
      a: { cx: 100, cy: 100 },
    };
    const result = centerToTopLeft(centers, {});
    expect(result.a).toEqual({ x: 20, y: 60 });
  });

  it('空输入返回空对象', () => {
    expect(centerToTopLeft({}, {})).toEqual({});
  });
});
```

- [ ] **Step 3: 运行测试验证通过**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：3 个测试全部通过（`centerToTopLeft` 已实现）。

- [ ] **Step 4: 提交**

```bash
git add tools/layout-lab/src/layout-metrics-v2.ts tools/layout-lab/src/layout-metrics-v2.test.ts
git commit -m "test(layout-lab): layout-metrics-v2 类型定义与测试夹具"
```

---

### Task 2: 硬约束指标 — 物理重叠与净距

**Files:**
- 修改: `tools/layout-lab/src/layout-metrics-v2.ts`
- 修改: `tools/layout-lab/src/layout-metrics-v2.test.ts`

- [ ] **Step 1: 写物理重叠检测的测试**

在 `layout-metrics-v2.test.ts` 中追加：

```typescript
import {
  centerToTopLeft,
  countPhysicalOverlaps,
  computeClearance,
  type Position,
  type Size,
  type CenterPos,
} from './layout-metrics-v2';

// ... (之前的测试保持不变)

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
      { id: 'b', x: 70, y: 0, w: 80, h: 60 }, // 10px 重叠
    ]);
    expect(countPhysicalOverlaps(positions, sizes)).toBe(1);
  });

  it('恰好相邻不算重叠', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 80, y: 0, w: 80, h: 60 }, // 恰好接触
    ]);
    expect(countPhysicalOverlaps(positions, sizes)).toBe(0);
  });

  it('有 10px 间隙不算重叠（修正旧 countOverlaps 的 buffer 问题）', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 90, y: 0, w: 80, h: 60 }, // 10px 间隙
    ]);
    expect(countPhysicalOverlaps(positions, sizes)).toBe(0);
  });

  it('多对重叠正确计数', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 40, y: 0, w: 80, h: 60 }, // a-b 重叠
      { id: 'c', x: 50, y: 0, w: 80, h: 60 }, // a-c, b-c 重叠
    ]);
    expect(countPhysicalOverlaps(positions, sizes)).toBe(3);
  });

  it('空输入返回 0', () => {
    expect(countPhysicalOverlaps({}, {})).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：`countPhysicalOverlaps` 测试失败（函数未定义）。

- [ ] **Step 3: 实现 `countPhysicalOverlaps`**

在 `layout-metrics-v2.ts` 中追加：

```typescript
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
      const sa = sizes[ids[i]] ?? { width: 220, height: 132 };
      const sb = sizes[ids[j]] ?? { width: 220, height: 132 };
      // AABB 重叠检测：四个条件都不满足才算重叠
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
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：所有 `countPhysicalOverlaps` 测试通过。

- [ ] **Step 5: 写净距分析的测试**

在 `layout-metrics-v2.test.ts` 中追加：

```typescript
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
      { id: 'b', x: 100, y: 0, w: 80, h: 60 }, // 净距 = 20px
    ]);
    const result = computeClearance(positions, sizes, 16);
    expect(result.violationPairs).toBe(0);
    expect(result.minClearance).toBe(20);
    expect(result.minClearancePair).toEqual(['a', 'b']);
  });

  it('净距 < 阈值算违规', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 90, y: 0, w: 80, h: 60 }, // 净距 = 10px < 16px
    ]);
    const result = computeClearance(positions, sizes, 16);
    expect(result.violationPairs).toBe(1);
    expect(result.minClearance).toBe(10);
  });

  it('重叠时净距为负数', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 70, y: 0, w: 80, h: 60 }, // 重叠 10px
    ]);
    const result = computeClearance(positions, sizes, 16);
    expect(result.violationPairs).toBe(1);
    expect(result.minClearance).toBe(-10);
  });

  it('多对时 p05 取第 5 百分位', () => {
    // 创建 20 个节点排成一行，相邻净距分别为 10, 20, 30, 40, ...
    // 共 C(20,2) = 190 对，p05 取第 9 个（190 * 0.05 = 9.5 → index 9）
    const entries: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    let xPos = 0;
    for (let i = 0; i < 20; i++) {
      entries.push({ id: `n${i}`, x: xPos, y: 0, w: 60, h: 40 });
      xPos += 60 + (i + 1) * 10; // 净距递增：10, 20, 30, ...
    }
    const { positions, sizes } = makePositions(entries);
    const result = computeClearance(positions, sizes, 16);
    // 最小净距 = 10（第一对相邻节点）
    expect(result.minClearance).toBe(10);
    // p05 应该接近最小的几个值（第 5 百分位 ≈ 第 9 小的净距）
    expect(result.p05).toBeLessThanOrEqual(20);
    expect(result.p05).toBeGreaterThanOrEqual(10);
    expect(result.violationPairs).toBeGreaterThan(0); // 净距 10 < 16，有违规
  });
});
```

- [ ] **Step 6: 运行测试验证失败**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：`computeClearance` 测试失败。

- [ ] **Step 7: 实现 `computeClearance`**

在 `layout-metrics-v2.ts` 中追加：

```typescript
/**
 * 计算净距分析报告。
 * 净距 = 两个节点 AABB 之间的距离（可为负数，表示重叠）。
 *
 * 三种情况：
 * 1. 两轴都分离 → 欧氏距离（正数）
 * 2. 仅一轴分离 → 该轴间隙（正数）
 * 3. 两轴都重叠 → 负穿透深度（取较浅轴的重叠量取负）
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
      const sa = sizes[ids[i]] ?? { width: 220, height: 132 };
      const sb = sizes[ids[j]] ?? { width: 220, height: 132 };

      // B 到 A 右边界的有符号距离（正 = 分离，负 = 重叠）
      const dx = b.x - (a.x + sa.width);
      // B 到 A 下边界的有符号距离
      const dy = b.y - (a.y + sa.height);

      let clearance: number;
      if (dx > 0 && dy > 0) {
        // 两轴都分离 → 欧氏距离
        clearance = Math.sqrt(dx * dx + dy * dy);
      } else if (dx > 0) {
        // X 轴分离，Y 轴重叠或恰好接触 → X 间隙
        clearance = dx;
      } else if (dy > 0) {
        // Y 轴分离，X 轴重叠或恰好接触 → Y 间隙
        clearance = dy;
      } else {
        // 两轴都重叠 → 负穿透深度（取较浅轴）
        const overlapX = Math.min(a.x + sa.width, b.x + sb.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + sa.height, b.y + sb.height) - Math.max(a.y, b.y);
        clearance = -Math.min(overlapX, overlapY);
      }

      clearances.push({ clearance, pair: [ids[i], ids[j]] });
    }
  }

  clearances.sort((a, b) => a.clearance - b.clearance);

  const violationPairs = clearances.filter(c => c.clearance < violationThreshold).length;
  const minEntry = clearances[0];

  // P05：第 5 百分位
  const p05Index = Math.max(0, Math.floor(clearances.length * 0.05));
  const p05 = clearances[p05Index]?.clearance ?? Infinity;

  return {
    violationPairs,
    p05,
    minClearance: minEntry?.clearance ?? Infinity,
    minClearancePair: minEntry?.pair ?? null,
  };
}
```

- [ ] **Step 8: 运行测试验证通过**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：所有测试通过。

- [ ] **Step 9: 提交**

```bash
git add tools/layout-lab/src/layout-metrics-v2.ts tools/layout-lab/src/layout-metrics-v2.test.ts
git commit -m "feat(layout-lab): 硬约束指标 — 物理重叠检测与净距分析"
```

---

### Task 3: 边指标 — 边穿节点与边-边交叉

**Files:**
- 修改: `tools/layout-lab/src/layout-metrics-v2.ts`
- 修改: `tools/layout-lab/src/layout-metrics-v2.test.ts`

- [ ] **Step 1: 写边穿节点检测的测试**

在 `layout-metrics-v2.test.ts` 中追加：

```typescript
import {
  centerToTopLeft,
  countPhysicalOverlaps,
  computeClearance,
  countEdgeNodeOcclusions,
  countEdgeEdgeCrossings,
  type Position,
  type Size,
  type CenterPos,
} from './layout-metrics-v2';

// ... (之前的测试保持不变)

describe('countEdgeNodeOcclusions', () => {
  it('无穿越时返回 0', () => {
    // 两个节点并排，边连接它们，不穿过任何其他节点
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 0, w: 80, h: 60 },
    ]);
    const edges = [{ source: 'a', target: 'b' }];
    expect(countEdgeNodeOcclusions(edges, positions, sizes)).toBe(0);
  });

  it('检测边穿过节点', () => {
    // a 在左边，b 在右边，c 在中间
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 25, w: 80, h: 60 },
      { id: 'b', x: 300, y: 25, w: 80, h: 60 },
      { id: 'c', x: 140, y: 25, w: 80, h: 60 }, // 在 a-b 连线上
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
    // 边端点是 a 和 b 自身，不算穿越
    expect(countEdgeNodeOcclusions(edges, positions, sizes)).toBe(0);
  });

  it('空边列表返回 0', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
    ]);
    expect(countEdgeNodeOcclusions([], positions, sizes)).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：`countEdgeNodeOcclusions` 测试失败。

- [ ] **Step 3: 实现 `countEdgeNodeOcclusions` 和辅助函数**

在 `layout-metrics-v2.ts` 中追加：

```typescript
/** 边的端点信息（用于指标计算） */
export type Edge = { source: string; target: string };

/**
 * 线段与轴对齐矩形的相交检测。
 * 与旧 cluster-internal-layouts.ts:655 的 lineIntersectsRect 语义相同，但增加了共线处理。
 */
function lineIntersectsRect(
  p1: Position, p2: Position,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  // 端点在矩形内
  if (p1.x >= rx && p1.x <= rx + rw && p1.y >= ry && p1.y <= ry + rh) return true;
  if (p2.x >= rx && p2.x <= rx + rw && p2.y >= ry && p2.y <= ry + rh) return true;

  // 与矩形四条边的相交检测
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

/** 两条线段是否相交（共端点不算） */
function segmentsIntersect(
  p1: Position, p2: Position,
  p3: Position, p4: Position,
): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  // 共线情况：检查投影重叠
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
    Math.min(p1.x, p2.x) <= p3.x && p3.x <= Math.max(p1.x, p2.x) &&
    Math.min(p1.y, p2.y) <= p3.y && p3.y <= Math.max(p1.y, p2.y)
  );
}

/**
 * 获取节点中心点坐标。
 * 所有边相关指标统一使用中心点，避免混用左上角/中心点。
 */
function getCenter(id: string, positions: Record<string, Position>, sizes: Record<string, Size>): Position {
  const p = positions[id];
  const s = sizes[id] ?? { width: 220, height: 132 };
  return { x: p.x + s.width / 2, y: p.y + s.height / 2 };
}

/**
 * 统计边穿过无关节点的次数。
 * 与旧 computeLayoutMetrics 的 edgeCrossings 语义相同，但重命名为 edgeNodeOcclusions 以明确语义。
 * 边的端点使用节点中心点（与 edgeEdgeCrossings、edgeLengthStats 口径一致）。
 */
export function countEdgeNodeOcclusions(
  edges: Edge[],
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
): number {
  const validIds = new Set(Object.keys(positions));
  const validEdges = edges.filter(
    e => validIds.has(e.source) && validIds.has(e.target) && e.source !== e.target,
  );

  let occlusions = 0;
  for (const edge of validEdges) {
    const s = getCenter(edge.source, positions, sizes);
    const t = getCenter(edge.target, positions, sizes);
    for (const nodeId of validIds) {
      if (nodeId === edge.source || nodeId === edge.target) continue;
      const np = positions[nodeId];
      const ns = sizes[nodeId] ?? { width: 220, height: 132 };
      if (lineIntersectsRect(s, t, np.x, np.y, ns.width, ns.height)) {
        occlusions++;
      }
    }
  }
  return occlusions;
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：所有 `countEdgeNodeOcclusions` 测试通过。

- [ ] **Step 5: 写边-边交叉检测的测试**

在 `layout-metrics-v2.test.ts` 中追加：

```typescript
describe('countEdgeEdgeCrossings', () => {
  it('无交叉时返回 0', () => {
    // 两条平行边
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
    // a-b 从左上到右下，c-d 从左下到右上，形成 X 形
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
      { source: 'a', target: 'c' }, // 共享端点 a
    ];
    expect(countEdgeEdgeCrossings(edges, positions, sizes)).toBe(0);
  });

  it('空边列表返回 0', () => {
    expect(countEdgeEdgeCrossings([], {}, {})).toBe(0);
  });
});
```

- [ ] **Step 6: 运行测试验证失败**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：`countEdgeEdgeCrossings` 测试失败。

- [ ] **Step 7: 实现 `countEdgeEdgeCrossings`**

在 `layout-metrics-v2.ts` 中追加：

```typescript
/**
 * 统计边与边交叉的次数。
 * O(E²) 复杂度，对典型图（<100 条边）足够快。
 * 共享端点的边不算交叉。
 * 边的端点使用节点中心点（与 edgeNodeOcclusions、edgeLengthStats 口径一致）。
 */
export function countEdgeEdgeCrossings(
  edges: Edge[],
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
): number {
  const validIds = new Set(Object.keys(positions));
  const validEdges = edges.filter(
    e => validIds.has(e.source) && validIds.has(e.target) && e.source !== e.target,
  );

  let crossings = 0;
  for (let i = 0; i < validEdges.length; i++) {
    for (let j = i + 1; j < validEdges.length; j++) {
      const e1 = validEdges[i];
      const e2 = validEdges[j];

      // 共享端点不算交叉
      if (e1.source === e2.source || e1.source === e2.target ||
          e1.target === e2.source || e1.target === e2.target) {
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
```

- [ ] **Step 8: 运行测试验证通过**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：所有测试通过。

- [ ] **Step 9: 提交**

```bash
git add tools/layout-lab/src/layout-metrics-v2.ts tools/layout-lab/src/layout-metrics-v2.test.ts
git commit -m "feat(layout-lab): 边指标 — 边穿节点与边-边交叉检测"
```

---

### Task 4: 形状指标 — 画布尺寸、宽高比、坐标有效性

**Files:**
- 修改: `tools/layout-lab/src/layout-metrics-v2.ts`
- 修改: `tools/layout-lab/src/layout-metrics-v2.test.ts`

- [ ] **Step 1: 写画布尺寸和坐标有效性的测试**

在 `layout-metrics-v2.test.ts` 中追加：

```typescript
import {
  centerToTopLeft,
  countPhysicalOverlaps,
  computeClearance,
  countEdgeNodeOcclusions,
  countEdgeEdgeCrossings,
  computeCanvasMetrics,
  validateCoordinates,
  type Position,
  type Size,
  type CenterPos,
} from './layout-metrics-v2';

describe('computeCanvasMetrics', () => {
  it('计算画布尺寸和宽高比', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 100, w: 80, h: 60 },
    ]);
    const result = computeCanvasMetrics(positions, sizes);
    expect(result.canvasWidth).toBe(280); // 200 + 80 - 0
    expect(result.canvasHeight).toBe(160); // 100 + 60 - 0
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
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：`computeCanvasMetrics` 和 `validateCoordinates` 测试失败。

- [ ] **Step 3: 实现 `computeCanvasMetrics` 和 `validateCoordinates`**

在 `layout-metrics-v2.ts` 中追加：

```typescript
/** 画布尺寸指标 */
export type CanvasMetrics = {
  canvasWidth: number;
  canvasHeight: number;
  aspectRatio: number;
};

/**
 * 计算画布尺寸和宽高比。
 * 使用所有节点的 AABB 的并集作为画布范围。
 */
export function computeCanvasMetrics(
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
): CanvasMetrics {
  const ids = Object.keys(positions);
  if (ids.length === 0) {
    return { canvasWidth: 0, canvasHeight: 0, aspectRatio: 0 };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    const s = sizes[id] ?? { width: 220, height: 132 };
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
  for (const [id, p] of Object.entries(positions)) {
    if (!isFinite(p.x) || !isFinite(p.y)) return false;
  }
  return true;
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：所有测试通过（注意 `NaN` 测试标记为 `xit`，因为 `NaN !== NaN` 的特殊性，需要特殊处理）。

- [ ] **Step 5: 提交**

```bash
git add tools/layout-lab/src/layout-metrics-v2.ts tools/layout-lab/src/layout-metrics-v2.test.ts
git commit -m "feat(layout-lab): 形状指标 — 画布尺寸、宽高比、坐标有效性"
```

---

### Task 5: 边长统计与完整 `computeLayoutQuality` 函数

**Files:**
- 修改: `tools/layout-lab/src/layout-metrics-v2.ts`
- 修改: `tools/layout-lab/src/layout-metrics-v2.test.ts`

- [ ] **Step 1: 写边长统计的测试**

在 `layout-metrics-v2.test.ts` 中追加：

```typescript
import {
  // ... 之前的所有导入
  computeEdgeLengthStats,
  computeLayoutQuality,
  type LayoutQualityMetrics,
} from './layout-metrics-v2';

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
    // a 中心 (40,30), b 中心 (240,30), c 中心 (440,30)
    // 边长都是 200
    expect(result.avgEdgeLength).toBe(200);
    expect(result.p95EdgeLength).toBe(200);
    expect(result.longEdgeRatio).toBe(0); // 200 < diagonal * 0.3
  });

  it('空边列表返回零值', () => {
    const result = computeEdgeLengthStats([], {}, {});
    expect(result.avgEdgeLength).toBe(0);
    expect(result.p95EdgeLength).toBe(0);
    expect(result.longEdgeRatio).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：`computeEdgeLengthStats` 测试失败。

- [ ] **Step 3: 实现 `computeEdgeLengthStats`**

在 `layout-metrics-v2.ts` 中追加：

```typescript
/** 边长统计 */
export type EdgeLengthStats = {
  avgEdgeLength: number;
  p95EdgeLength: number;
  longEdgeRatio: number;
};

/**
 * 计算边长统计。
 * 使用节点中心点计算欧氏距离。
 * 长边定义：长度 > 画布对角线 * 0.3。
 */
export function computeEdgeLengthStats(
  edges: Edge[],
  positions: Record<string, Position>,
  sizes: Record<string, Size>,
): EdgeLengthStats {
  const validIds = new Set(Object.keys(positions));
  const validEdges = edges.filter(
    e => validIds.has(e.source) && validIds.has(e.target) && e.source !== e.target,
  );

  if (validEdges.length === 0) {
    return { avgEdgeLength: 0, p95EdgeLength: 0, longEdgeRatio: 0 };
  }

  const lengths = validEdges.map(e => {
    const s = getCenter(e.source, positions, sizes);
    const t = getCenter(e.target, positions, sizes);
    return Math.sqrt((s.x - t.x) ** 2 + (s.y - t.y) ** 2);
  });

  lengths.sort((a, b) => a - b);

  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const p95Index = Math.min(lengths.length - 1, Math.floor(lengths.length * 0.95));
  const p95 = lengths[p95Index];

  // 画布对角线
  const canvas = computeCanvasMetrics(positions, sizes);
  const diagonal = Math.sqrt(canvas.canvasWidth ** 2 + canvas.canvasHeight ** 2);
  const longThreshold = diagonal * 0.3;
  const longCount = lengths.filter(l => l > longThreshold).length;

  return {
    avgEdgeLength: Math.round(avg),
    p95EdgeLength: Math.round(p95),
    longEdgeRatio: Math.round((longCount / lengths.length) * 100) / 100,
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：所有 `computeEdgeLengthStats` 测试通过。

- [ ] **Step 5: 写 `computeLayoutQuality` 集成测试**

在 `layout-metrics-v2.test.ts` 中追加：

```typescript
describe('computeLayoutQuality', () => {
  it('返回完整的布局质量指标', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 0, w: 80, h: 60 },
    ]);
    const edges = [{ source: 'a', target: 'b' }];
    const result = computeLayoutQuality(edges, positions, sizes);

    // 硬约束
    expect(result.hard.physicalOverlapPairs).toBe(0);
    expect(result.hard.clearanceViolationPairs).toBe(0);
    expect(result.hard.coordinateValidity).toBe(true);

    // 软目标
    expect(result.soft.edgeNodeOcclusions).toBe(0);
    expect(result.soft.edgeEdgeCrossings).toBe(0);
    expect(result.soft.avgEdgeLength).toBe(200);
    expect(result.soft.canvasWidth).toBe(280);
    expect(result.soft.canvasHeight).toBe(60);
    expect(result.soft.aspectRatio).toBeCloseTo(280 / 60);

    // 无增量指标
    expect(result.growth).toBeUndefined();
    expect(result.stability).toBeUndefined();
  });

  it('可选的增量指标：生长形状 + 位移计算', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 200, y: 0, w: 80, h: 60 },
    ]);
    const edges = [{ source: 'a', target: 'b' }];

    // 前一 revision：a 在原位
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

    // 生长形状：无顶部扩张，底部扩张 0（高度未变）
    expect(result.growth).toBeDefined();
    expect(result.growth!.topExpansionPx).toBe(0);

    // 位移：a 未移动
    expect(result.stability).toBeDefined();
    expect(result.stability!.medianDisplacement).toBe(0);
    expect(result.stability!.maxDisplacement).toBe(0);
    expect(result.stability!.oldNodeCount).toBe(1);
  });
});
```

- [ ] **Step 6: 运行测试验证失败**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：`computeLayoutQuality` 测试失败。

- [ ] **Step 7: 实现 `computeLayoutQuality`**

在 `layout-metrics-v2.ts` 中追加：

```typescript
/**
 * 从前后两个 revision 的中心点坐标计算增量位移统计。
 * 与 incremental-force.ts 的 DisplacementStats 口径一致，但作为纯函数独立提供。
 *
 * @param prevPositions 前一 revision 的中心点坐标
 * @param positions 当前 revision 的中心点坐标
 * @param oldNodeIds 在前一 revision 中已存在的节点 ID 集合
 * @param maxDrift 漂移上限（px），超过此值的节点计为 capHit
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
  const median = displacements.length % 2 === 0
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

  // 硬约束
  const hard: HardConstraints = {
    physicalOverlapPairs: countPhysicalOverlaps(positions, sizes),
    clearanceViolationPairs: computeClearance(positions, sizes, threshold).violationPairs,
    coordinateValidity: validateCoordinates(positions),
  };

  // 软目标
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

  // 生长形状（可选）
  let growth: GrowthShape | undefined;
  if (options?.prevPositions) {
    const prevIds = Object.keys(options.prevPositions);
    const currIds = Object.keys(positions);
    if (prevIds.length > 0 && currIds.length > 0) {
      let prevMinY = Infinity, prevMaxY = -Infinity;
      for (const id of prevIds) {
        const p = options.prevPositions[id];
        const s = sizes[id] ?? { width: 220, height: 132 };
        prevMinY = Math.min(prevMinY, p.y);
        prevMaxY = Math.max(prevMaxY, p.y + s.height);
      }
      let currMinY = Infinity, currMaxY = -Infinity;
      for (const id of currIds) {
        const p = positions[id];
        const s = sizes[id] ?? { width: 220, height: 132 };
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

  // 增量稳定性（可选，从中心点坐标计算）
  let stability: IncrementalStability | undefined;
  if (options?.prevCenterPositions && options?.currentCenterPositions && options?.oldNodeIds) {
    stability = computeDisplacement(
      options.prevCenterPositions,
      options.currentCenterPositions,
      options.oldNodeIds,
      options?.maxDrift,
    );
  }

  return { hard, soft, growth, stability };
}
```

- [ ] **Step 8: 运行测试验证通过**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：所有测试通过。

- [ ] **Step 9: 提交**

```bash
git add tools/layout-lab/src/layout-metrics-v2.ts tools/layout-lab/src/layout-metrics-v2.test.ts
git commit -m "feat(layout-lab): 完整 computeLayoutQuality 函数"
```

---

### Task 6: 导出检查与文档

**Files:**
- 修改: `tools/layout-lab/src/layout-metrics-v2.ts`
- 修改: `tools/layout-lab/src/layout-metrics-v2.test.ts`

- [ ] **Step 1: 检查所有导出是否完整**

确认 `layout-metrics-v2.ts` 导出了以下所有类型和函数：

```
类型：
- Position, Size, CenterPos, Edge
- HardConstraints, ClearanceReport, SoftTargets
- IncrementalStability, GrowthShape, LayoutQualityMetrics
- CanvasMetrics, EdgeLengthStats

函数：
- centerToTopLeft
- countPhysicalOverlaps
- computeClearance
- countEdgeNodeOcclusions
- countEdgeEdgeCrossings
- computeCanvasMetrics
- validateCoordinates
- computeEdgeLengthStats
- computeLayoutQuality
```

- [ ] **Step 2: 写边界情况的补充测试**

在 `layout-metrics-v2.test.ts` 中追加：

```typescript
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
    expect(result.hard.physicalOverlapPairs).toBe(3); // C(3,2) = 3
    expect(result.soft.clearance.minClearance).toBeLessThan(0);
  });

  it('节点恰好相邻（净距 = 0）', () => {
    const { positions, sizes } = makePositions([
      { id: 'a', x: 0, y: 0, w: 80, h: 60 },
      { id: 'b', x: 80, y: 0, w: 80, h: 60 },
    ]);
    const result = computeLayoutQuality([], positions, sizes, { clearanceThreshold: 16 });
    expect(result.hard.physicalOverlapPairs).toBe(0);
    expect(result.hard.clearanceViolationPairs).toBe(1); // 净距 0 < 16
  });
});
```

- [ ] **Step 3: 运行全部测试**

```bash
cd tools/layout-lab && npx vitest run src/layout-metrics-v2.test.ts
```

预期：所有测试通过。

- [ ] **Step 4: 运行整个 layout-lab 测试套件确认无回归**

```bash
cd tools/layout-lab && npx vitest run
```

预期：原有测试不受影响，新测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add tools/layout-lab/src/layout-metrics-v2.ts tools/layout-lab/src/layout-metrics-v2.test.ts
git commit -m "test(layout-lab): layout-metrics-v2 边界情况补充测试"
```

---

## 自检清单

- [ ] 所有旧定义的口径修正已在新模块中体现
- [ ] `edgeNodeOcclusions` 明确是边穿节点（不是边-边）
- [ ] `physicalOverlapPairs` 零 buffer（不是旧 countOverlaps 的 10px gap）
- [ ] `countEdgeEdgeCrossings` 是真正的线段相交检测
- [ ] `clearanceViolationPairs` 阈值可配置（默认 16px）
- [ ] 未修改任何现有文件（避免与 Round 5 冲突）
- [ ] 所有函数都是纯函数，无副作用
- [ ] 测试覆盖正常路径和边界情况
- [ ] 类型导出完整，可供外部模块使用
