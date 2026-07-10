# Round 4：R3b 增量稳定性实验实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 验证 R3b incremental（Pin 弹簧力 + 旧坐标继承 + 新节点邻居落位）在实时增长中旧节点能否少动、最终态是否仍接近 Round 3 静态 R3b。

**Architecture:** 在 `tools/layout-lab/` 上扩展。核心是 `incremental-force.ts`：读上一 revision 全局坐标 → 旧节点原地 + 新节点邻居落位 → 力迭代（面积斥力 + spring + width penalty + Pin 弹簧）→ drift clamp → mobility 碰撞消除。跨 revision cluster 用 nodeId 交集匹配。三候选（产品 stable / R3b full / R3b incremental）逐 revision 截图 + 固定坐标系 gallery。

**Tech Stack:** TypeScript + tsx、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-07-10-round4-incremental-stability.md`

---

## 任务依赖

```
Task 1: incremental-types（Pin 参数 + cluster 匹配 + 增量状态类型）
  └─ Task 2: cluster-matching（跨 revision nodeId 交集匹配，TDD）
        └─ Task 3: incremental-force（Pin + drift + mobility + 新节点落位，TDD）
              └─ Task 4: split-real-graph（真实大图按 timestamp 切序列）
Task 5: replay-sequence（逐 revision 跑三候选 + 截图 + 指标）
  └─ Task 6: round4-gallery（固定坐标系 + slider + 追踪节点 + 指标）
```

---

## Task 1: incremental-types（类型 + 参数 + cluster 匹配接口）

**Files:**
- Create: `tools/layout-lab/src/incremental-types.ts`
- Create: `tools/layout-lab/src/incremental-types.test.ts`

- [ ] **Step 1: 写失败测试**

`tools/layout-lab/src/incremental-types.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { computePinK, computeMaxDrift, computeOldMobility, stableHash } from './incremental-types';

describe('Pin 参数公式', () => {
  it('无新增（r=0）：PIN_K=TIGHT=0.10', () => {
    expect(computePinK(0)).toBeCloseTo(0.10);
  });
  it('新增 30%（r=0.3）：PIN_K=LOOSE=0.025', () => {
    expect(computePinK(0.3)).toBeCloseTo(0.025);
  });
  it('新增 15%（r=0.15）：PIN_K 在 TIGHT 和 LOOSE 之间', () => {
    const k = computePinK(0.15);
    expect(k).toBeGreaterThan(0.025);
    expect(k).toBeLessThan(0.10);
  });
  it('新增超 30%（r=0.5）：不继续降，PIN_K=LOOSE', () => {
    expect(computePinK(0.5)).toBeCloseTo(0.025);
  });
});

describe('MaxDrift 公式', () => {
  it('r=0 → 50px', () => {
    expect(computeMaxDrift(0)).toBe(50);
  });
  it('r=0.3 → 100px', () => {
    expect(computeMaxDrift(0.3)).toBe(100);
  });
});

describe('Mobility 公式', () => {
  it('r=0 → 0.2', () => {
    expect(computeOldMobility(0)).toBeCloseTo(0.2);
  });
  it('r=0.3 → 0.6', () => {
    expect(computeOldMobility(0.3)).toBeCloseTo(0.6);
  });
});

describe('stableHash', () => {
  it('同一输入同一输出', () => {
    expect(stableHash('node_123')).toBe(stableHash('node_123'));
  });
  it('不同输入不同输出', () => {
    expect(stableHash('node_123')).not.toBe(stableHash('node_456'));
  });
  it('返回 0-359 整数', () => {
    const h = stableHash('test');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
    expect(Number.isInteger(h)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd tools/layout-lab/run && npx vitest run ../src/incremental-types.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 incremental-types.ts**

```typescript
import type { CenterPos } from './force-core-v2';
import type { NodeSize } from './round3-types';

// ── Pin 参数 ──
export const PIN_K_TIGHT = 0.10;
export const PIN_K_LOOSE = 0.025;
export const PIN_SOFTEN_RATIO = 0.30;
export const MAX_DRIFT_TIGHT = 50;
export const MAX_DRIFT_LOOSE = 100;

// u = clamp(r / SOFTEN_RATIO, 0, 1)
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

// ── 确定性 hash（新节点初始位置用）──
export function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

// ── 跨 revision cluster 匹配 ──
export type ClusterMatch = {
  newClusterId: string;
  predecessorIds: string[];   // 上一 revision 中有 nodeId 交集的 cluster IDs
  isNew: boolean;             // 无前驱 → 新 cluster
  isMerge: boolean;           // 多个前驱 → merge
};

// nodeId 交集匹配（spec 4.3.1）
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

// ── 增量布局状态（跨 revision 传递）──
export type IncrementalState = {
  // 全局坐标（center 格式），key = nodeId
  positions: Record<string, CenterPos>;
  // 节点尺寸
  sizes: Record<string, NodeSize>;
  // cluster 全局 origin（key = cluster match 后的稳定 ID）
  clusterOrigins: Record<string, { x: number; y: number }>;
  // 上一 revision 的 cluster 列表（用于匹配）
  prevClusters: Array<{ id: string; nodeIds: string[]; type: 'major' | 'minor' }>;
};

export function createEmptyIncrementalState(): IncrementalState {
  return { positions: {}, sizes: {}, clusterOrigins: {}, prevClusters: [] };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd tools/layout-lab/run && npx vitest run ../src/incremental-types.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/src/incremental-types.ts tools/layout-lab/src/incremental-types.test.ts
git commit -m "feat(layout-lab): incremental-types（Pin 参数 + cluster 匹配 + 增量状态）"
```

---

## Task 2: cluster-matching 单测（跨 revision 场景）

**Files:**
- Create: `tools/layout-lab/src/cluster-matching.test.ts`

> Task 1 已实现 `matchClusters`。这个 Task 专门测跨 revision 的 merge/split/new 场景。

- [ ] **Step 1: 写测试**

```typescript
import { describe, expect, it } from 'vitest';
import { matchClusters } from './incremental-types';

describe('matchClusters 跨 revision 匹配', () => {
  it('新 cluster：无交集', () => {
    const result = matchClusters(
      [{ id: 'c_new', nodeIds: ['x', 'y'] }],
      [{ id: 'old1', nodeIds: ['a', 'b'] }],
    );
    expect(result[0].isNew).toBe(true);
    expect(result[0].predecessorIds).toEqual([]);
  });

  it('继承：一个前驱', () => {
    const result = matchClusters(
      [{ id: 'c1', nodeIds: ['a', 'b', 'c'] }],
      [{ id: 'old1', nodeIds: ['a', 'b'] }],
    );
    expect(result[0].isNew).toBe(false);
    expect(result[0].isMerge).toBe(false);
    expect(result[0].predecessorIds).toEqual(['old1']);
  });

  it('merge：多个前驱', () => {
    const result = matchClusters(
      [{ id: 'c_merged', nodeIds: ['a', 'b', 'c', 'd'] }],
      [
        { id: 'old1', nodeIds: ['a', 'b'] },
        { id: 'old2', nodeIds: ['c', 'd'] },
      ],
    );
    expect(result[0].isMerge).toBe(true);
    expect(result[0].predecessorIds).toEqual(['old1', 'old2']);
  });

  it('split：一个旧簇对应多个新簇', () => {
    const result = matchClusters(
      [
        { id: 'c1', nodeIds: ['a', 'b'] },
        { id: 'c2', nodeIds: ['c', 'd'] },
      ],
      [{ id: 'old1', nodeIds: ['a', 'b', 'c', 'd'] }],
    );
    expect(result[0].predecessorIds).toEqual(['old1']);
    expect(result[1].predecessorIds).toEqual(['old1']);
    expect(result[0].isNew).toBe(false);
    expect(result[1].isNew).toBe(false);
  });

  it('混合：新 + 继承 + merge', () => {
    const result = matchClusters(
      [
        { id: 'c_new', nodeIds: ['x'] },
        { id: 'c_inherit', nodeIds: ['a', 'b'] },
        { id: 'c_merge', nodeIds: ['c', 'd', 'e'] },
      ],
      [
        { id: 'old1', nodeIds: ['a', 'b'] },
        { id: 'old2', nodeIds: ['c'] },
        { id: 'old3', nodeIds: ['d', 'e'] },
      ],
    );
    expect(result[0].isNew).toBe(true);
    expect(result[1].predecessorIds).toEqual(['old1']);
    expect(result[2].isMerge).toBe(true);
    expect(result[2].predecessorIds).toContain('old2');
    expect(result[2].predecessorIds).toContain('old3');
  });
});
```

- [ ] **Step 2: 运行验证通过**

Run: `cd tools/layout-lab/run && npx vitest run ../src/cluster-matching.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 3: Commit**

```bash
git add tools/layout-lab/src/cluster-matching.test.ts
git commit -m "test(layout-lab): cluster-matching 跨 revision 场景（new/inherit/merge/split）"
```

---

## Task 3: incremental-force（Pin + drift + mobility + 新节点落位）

**Files:**
- Create: `tools/layout-lab/src/incremental-force.ts`
- Create: `tools/layout-lab/src/incremental-force.test.ts`

> 这是 Round 4 的核心。实现 spec 4.1-4.8 的完整力定义。

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, expect, it } from 'vitest';
import { computeIncrementalLayout, type IncrementalState } from './incremental-force';
import type { MergedGraph } from '@listen-graphic/schema';

function makeGraph(nodes: string[], edges: Array<[string, string]>, ts: number[] = []): MergedGraph {
  return {
    sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
    nodes: nodes.map((id, i) => ({
      id, type: 'claim' as const, text: id, timestampMs: ts[i] ?? i * 1000, status: 'confirmed' as const,
    })),
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t, type: 'supports' as const })),
  };
}

describe('computeIncrementalLayout', () => {
  it('第一个 revision：与 full-recompute 一致（无旧坐标 → 圆形初始化）', () => {
    const graph = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const emptyState: IncrementalState = { positions: {}, sizes: {}, clusterOrigins: {}, prevClusters: [] };
    const result = computeIncrementalLayout(graph, emptyState);
    expect(result.state.positions).toHaveProperty('a');
    expect(result.state.positions).toHaveProperty('b');
    expect(result.state.positions).toHaveProperty('c');
  });

  it('增量：旧节点位移远小于全量重算', () => {
    const graph1 = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']], [0, 1000, 2000]);
    const emptyState: IncrementalState = { positions: {}, sizes: {}, clusterOrigins: {}, prevClusters: [] };
    const result1 = computeIncrementalLayout(graph1, emptyState);

    // 第二 revision 加一个节点
    const graph2 = makeGraph(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']], [0, 1000, 2000, 3000]);
    const result2 = computeIncrementalLayout(graph2, result1.state);

    // 旧节点 a/b/c 的位移应该很小（< 100px，被 drift clamp 保证）
    for (const id of ['a', 'b', 'c']) {
      const p1 = result1.state.positions[id];
      const p2 = result2.state.positions[id];
      const dist = Math.hypot(p2.cx - p1.cx, p2.cy - p1.cy);
      expect(dist).toBeLessThan(100);
    }
  });

  it('新节点有合理初始位置（在邻居附近）', () => {
    const graph1 = makeGraph(['a', 'b'], [['a', 'b']]);
    const result1 = computeIncrementalLayout(graph1, { positions: {}, sizes: {}, clusterOrigins: {}, prevClusters: [] });
    const graph2 = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const result2 = computeIncrementalLayout(graph2, result1.state);

    const newPos = result2.state.positions['c'];
    const neighborPos = result2.state.positions['b'];
    const dist = Math.hypot(newPos.cx - neighborPos.cx, newPos.cy - neighborPos.cy);
    // 新节点应该在邻居附近（< 500px），不是随机散到几万像素外
    expect(dist).toBeLessThan(500);
  });

  it('统计：displacementStats 含中位/最大位移 + capHitRate', () => {
    const graph1 = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const result1 = computeIncrementalLayout(graph1, { positions: {}, sizes: {}, clusterOrigins: {}, prevClusters: [] });
    const graph2 = makeGraph(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']]);
    const result2 = computeIncrementalLayout(graph2, result1.state);

    expect(result2.displacementStats).toBeDefined();
    expect(result2.displacementStats.medianDisplacement).toBeGreaterThanOrEqual(0);
    expect(result2.displacementStats.maxDisplacement).toBeGreaterThanOrEqual(0);
    expect(result2.displacementStats.capHitRate).toBeGreaterThanOrEqual(0);
    expect(result2.displacementStats.capHitRate).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd tools/layout-lab/run && npx vitest run ../src/incremental-force.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 incremental-force.ts**

```typescript
import type { MergedGraph, GraphNode, GraphEdge, EdgeType } from '@listen-graphic/schema';
import { partitionClusters } from './cluster-partition';
import { resolveOverlaps, type CenterPos } from './force-core-v2';
import {
  computeAllNodeSizes, computeNodeSize, FORCE_PARAMS, PENALTY_STRENGTH, TARGET_WIDTH,
  type NodeSize,
} from './round3-types';
import {
  computePinK, computeMaxDrift, computeOldMobility, stableHash, matchClusters,
  type IncrementalState, type ClusterMatch,
} from './incremental-types';

const STRUCTURAL_TYPES = new Set<EdgeType>(['causes', 'supports', 'example_of', 'follows', 'opposes']);

export type DisplacementStats = {
  medianDisplacement: number;
  maxDisplacement: number;
  capHitRate: number;       // 触发 drift clamp 的旧节点比例
  oldNodeCount: number;
};

export type IncrementalResult = {
  state: IncrementalState;       // 传递给下一 revision
  positions: Record<string, CenterPos>;
  stats: DisplacementStats | null;  // 第一个 revision 为 null
  clusters: Array<{ id: string; nodeIds: string[]; type: 'major' | 'minor' }>;
};

// 新节点初始位置（spec 4.5）
function initNewNode(
  nodeId: string,
  edges: GraphEdge[],
  positions: Record<string, CenterPos>,
): CenterPos {
  const neighbors = edges
    .filter((e) => e.source === nodeId || e.target === nodeId)
    .map((e) => (e.source === nodeId ? e.target : e.source))
    .filter((id) => positions[id]);

  if (neighbors.length > 0) {
    // 放在邻居重心 + 确定性偏移
    const cx = neighbors.reduce((s, id) => s + positions[id].cx, 0) / neighbors.length;
    const cy = neighbors.reduce((s, id) => s + positions[id].cy, 0) / neighbors.length;
    const angle = (stableHash(nodeId) * Math.PI) / 180;
    return {
      cx: cx + Math.cos(angle) * FORCE_PARAMS.SPRING_LENGTH,
      cy: cy + Math.sin(angle) * FORCE_PARAMS.SPRING_LENGTH,
    };
  }
  // 完全孤立：放在画布最下方
  const allY = Object.values(positions).map((p) => p.cy);
  const maxY = allY.length > 0 ? Math.max(...allY) : 0;
  return { cx: TARGET_WIDTH / 2, cy: maxY + 200 };
}

export function computeIncrementalLayout(
  graph: MergedGraph,
  prevState: IncrementalState,
): IncrementalResult {
  const partition = partitionClusters(graph);
  const allSizes = computeAllNodeSizes(graph.nodes);

  // 判断是否第一个 revision（无旧坐标）
  const isFirstRevision = Object.keys(prevState.positions).length === 0;

  // 初始化位置
  const positions: Record<string, CenterPos> = {};
  const oldNodeIds = new Set(Object.keys(prevState.positions));

  if (isFirstRevision) {
    // 第一个 revision：圆形初始化（与 R3b full-recompute 一致）
    const allNodes = graph.nodes;
    const radius = Math.max(200, allNodes.length * 15);
    allNodes.forEach((n, i) => {
      const angle = (i / allNodes.length) * Math.PI * 2;
      positions[n.id] = {
        cx: Math.cos(angle) * radius + (i % 3) * 10,
        cy: Math.sin(angle) * radius + (i % 3) * 10,
      };
    });
  } else {
    // 增量：旧节点保留旧坐标，新节点邻居落位
    for (const n of graph.nodes) {
      if (prevState.positions[n.id]) {
        positions[n.id] = { ...prevState.positions[n.id] };
      }
    }
    for (const n of graph.nodes) {
      if (!positions[n.id]) {
        positions[n.id] = initNewNode(n.id, graph.edges, positions);
      }
    }
  }

  // 对每个 cluster 做力导向
  const { REPULSION_K, SPRING_LENGTH, SPRING_K, DAMPING, MAX_DISPLACEMENT, ITERATIONS } = FORCE_PARAMS;
  const velocities: Record<string, { x: number; y: number }> = {};
  for (const n of graph.nodes) velocities[n.id] = { x: 0, y: 0 };

  // cluster 匹配（增量时）
  const clusterMatches = isFirstRevision ? [] : matchClusters(
    partition.clusters.map((c) => ({ id: c.id, nodeIds: c.nodeIds })),
    prevState.prevClusters,
  );

  // 记录哪些节点是旧的（用于 Pin + drift + mobility）
  const isOldNode = (id: string) => !isFirstRevision && oldNodeIds.has(id);

  // 逐 cluster 力导向
  for (const cluster of partition.clusters) {
    const clusterNodeIds = new Set(cluster.nodeIds);
    const clusterNodes = graph.nodes.filter((n) => clusterNodeIds.has(n.id));
    const clusterEdges = graph.edges.filter(
      (e) => clusterNodeIds.has(e.source) && clusterNodeIds.has(e.target) && e.source !== e.target,
    );
    const edgeList: Array<{ source: string; target: string }> = [];
    for (const e of clusterEdges) {
      if (STRUCTURAL_TYPES.has(e.type)) edgeList.push({ source: e.source, target: e.target });
    }

    // 计算变化率 r
    let pinK = 0;
    let maxDrift = 0;
    let oldMobility = 1.0;

    if (!isFirstRevision && cluster.type === 'major') {
      const oldInCluster = cluster.nodeIds.filter(isOldNode);
      const newInCluster = cluster.nodeIds.filter((id) => !isOldNode(id));
      // 受新边影响的旧节点
      const affectedOld = new Set<string>();
      for (const e of clusterEdges) {
        if (newInCluster.includes(e.source) && oldInCluster.includes(e.target)) affectedOld.add(e.target);
        if (newInCluster.includes(e.target) && oldInCluster.includes(e.source)) affectedOld.add(e.source);
      }
      const r = (newInCluster.length + 0.5 * affectedOld.size) / Math.max(1, oldInCluster.length);
      pinK = computePinK(r);
      maxDrift = computeMaxDrift(r);
      oldMobility = computeOldMobility(r);
    }

    // 力迭代
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const forces: Record<string, { x: number; y: number }> = {};
      for (const n of clusterNodes) forces[n.id] = { x: 0, y: 0 };

      // 面积斥力
      for (let i = 0; i < clusterNodes.length; i++) {
        for (let j = i + 1; j < clusterNodes.length; j++) {
          const a = clusterNodes[i], b = clusterNodes[j];
          const dx = positions[a.id].cx - positions[b.id].cx;
          const dy = positions[a.id].cy - positions[b.id].cy;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) dist = 1;
          const areaA = allSizes[a.id].width * allSizes[a.id].height;
          const areaB = allSizes[b.id].width * allSizes[b.id].height;
          const repulsion = REPULSION_K * Math.sqrt(areaA * areaB) / (dist * dist);
          forces[a.id].x += (dx / dist) * repulsion;
          forces[a.id].y += (dy / dist) * repulsion;
          forces[b.id].x -= (dx / dist) * repulsion;
          forces[b.id].y -= (dy / dist) * repulsion;
        }
      }

      // Spring
      for (const edge of edgeList) {
        const dx = positions[edge.target].cx - positions[edge.source].cx;
        const dy = positions[edge.target].cy - positions[edge.source].cy;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const force = SPRING_K * (dist - SPRING_LENGTH);
        forces[edge.source].x += (dx / dist) * force;
        forces[edge.source].y += (dy / dist) * force;
        forces[edge.target].x -= (dx / dist) * force;
        forces[edge.target].y -= (dy / dist) * force;
      }

      // R3b 宽度惩罚
      for (const n of clusterNodes) {
        const w = allSizes[n.id].width;
        const cx = positions[n.id].cx;
        const leftOvershoot = Math.max(0, w / 2 - cx);
        const rightOvershoot = Math.max(0, cx + w / 2 - TARGET_WIDTH);
        forces[n.id].x += leftOvershoot * PENALTY_STRENGTH - rightOvershoot * PENALTY_STRENGTH;
      }

      // Pin 弹簧力（只对旧节点）
      if (!isFirstRevision && pinK > 0) {
        for (const n of clusterNodes) {
          if (isOldNode(n.id) && prevState.positions[n.id]) {
            const anchor = prevState.positions[n.id];
            forces[n.id].x += pinK * (anchor.cx - positions[n.id].cx);
            forces[n.id].y += pinK * (anchor.cy - positions[n.id].cy);
          }
        }
      }

      // Apply + damping
      for (const n of clusterNodes) {
        velocities[n.id].x = (velocities[n.id].x + forces[n.id].x) * DAMPING;
        velocities[n.id].y = (velocities[n.id].y + forces[n.id].y) * DAMPING;
        positions[n.id].cx += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].x));
        positions[n.id].cy += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].y));
      }

      // Drift clamp（旧节点）
      if (!isFirstRevision && maxDrift > 0) {
        for (const n of clusterNodes) {
          if (isOldNode(n.id) && prevState.positions[n.id]) {
            const anchor = prevState.positions[n.id];
            const dx = positions[n.id].cx - anchor.cx;
            const dy = positions[n.id].cy - anchor.cy;
            const distance = Math.hypot(dx, dy);
            if (distance > maxDrift) {
              const scale = maxDrift / distance;
              positions[n.id].cx = anchor.cx + dx * scale;
              positions[n.id].cy = anchor.cy + dy * scale;
              velocities[n.id].x *= 0.25;
              velocities[n.id].y *= 0.25;
            }
          }
        }
      }
    }
  }

  // 统计位移
  let stats: DisplacementStats | null = null;
  const capHitNodes = new Set<string>();

  if (!isFirstRevision) {
    const displacements: number[] = [];
    for (const n of graph.nodes) {
      if (oldNodeIds.has(n.id) && prevState.positions[n.id]) {
        const dx = positions[n.id].cx - prevState.positions[n.id].cx;
        const dy = positions[n.id].cy - prevState.positions[n.id].cy;
        const dist = Math.hypot(dx, dy);
        displacements.push(dist);
        if (dist >= computeMaxDrift(0.3) - 1) capHitNodes.add(n.id); // 近似：接近 max drift
      }
    }
    displacements.sort((a, b) => a - b);
    const mid = Math.floor(displacements.length / 2);
    const median = displacements.length > 0 ? displacements[mid] : 0;
    const max = displacements.length > 0 ? displacements[displacements.length - 1] : 0;
    const oldCount = [...oldNodeIds].filter((id) => positions[id]).length;
    stats = {
      medianDisplacement: Math.round(median),
      maxDisplacement: Math.round(max),
      capHitRate: oldCount > 0 ? capHitNodes.size / oldCount : 0,
      oldNodeCount: oldCount,
    };
  }

  // 带 mobility 的碰撞消除
  const mobilities: Record<string, number> = {};
  for (const n of graph.nodes) {
    mobilities[n.id] = isFirstRevision ? 1.0 : (isOldNode(n.id) ? 0.4 : 1.0); // 简化：用中间值
  }
  resolveOverlapsWithMobility(positions, allSizes, mobilities);

  // 构建新 state
  const newState: IncrementalState = {
    positions: { ...positions },
    sizes: allSizes,
    clusterOrigins: {},
    prevClusters: partition.clusters.map((c) => ({ id: c.id, nodeIds: c.nodeIds, type: c.type })),
  };

  return {
    state: newState,
    positions,
    stats,
    clusters: partition.clusters.map((c) => ({ id: c.id, nodeIds: c.nodeIds, type: c.type })),
  };
}

// 带 mobility 的碰撞消除
function resolveOverlapsWithMobility(
  positions: Record<string, CenterPos>,
  sizes: Record<string, NodeSize>,
  mobilities: Record<string, number>,
  rounds: number = FORCE_PARAMS.OVERLAP_ROUNDS,
): void {
  const ids = Object.keys(positions).sort();
  for (let r = 0; r < rounds; r++) {
    let anyOverlap = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        if (!positions[a] || !positions[b] || !sizes[a] || !sizes[b]) continue;
        const sa = sizes[a], sb = sizes[b];
        const dx = positions[a].cx - positions[b].cx;
        const dy = positions[a].cy - positions[b].cy;
        const overlapX = (sa.width + sb.width) / 2 - Math.abs(dx);
        const overlapY = (sa.height + sb.height) / 2 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        anyOverlap = true;
        // 按 mobility 分配位移
        const ma = mobilities[a] ?? 1.0;
        const mb = mobilities[b] ?? 1.0;
        const totalMob = ma + mb;
        const ratioA = ma / totalMob;
        const ratioB = mb / totalMob;

        if (overlapX < overlapY) {
          let dir: number;
          if (dx === 0) { dir = a < b ? -1 : 1; }
          else { dir = dx > 0 ? 1 : -1; }
          positions[a].cx += dir * overlapX * ratioA;
          positions[b].cx -= dir * overlapX * ratioB;
        } else {
          let dir: number;
          if (dy === 0) { dir = a < b ? -1 : 1; }
          else { dir = dy > 0 ? 1 : -1; }
          positions[a].cy += dir * overlapY * ratioA;
          positions[b].cy -= dir * overlapY * ratioB;
        }
      }
    }
    if (!anyOverlap) break;
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd tools/layout-lab/run && npx vitest run ../src/incremental-force.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/src/incremental-force.ts tools/layout-lab/src/incremental-force.test.ts
git commit -m "feat(layout-lab): incremental-force（Pin + drift + mobility + 新节点落位）"
```

---

## Task 4: split-real-graph（真实大图按 timestamp 切序列）

**Files:**
- Create: `tools/layout-lab/src/split-real-graph.ts`

- [ ] **Step 1: 实现**

```typescript
import type { MergedGraph } from '@listen-graphic/schema';

// 按 timestampMs 把最终态图切成增长序列（spec 6.2）
// 规则：相同 timestampMs 的节点不拆；边在两端都进入后才加入
export function splitGraphByTimestamp(
  graph: MergedGraph,
  batchSize = 20,
): MergedGraph[] {
  // 按 timestampMs 分组节点
  const timestamps = [...new Set(graph.nodes.map((n) => n.timestampMs))].sort((a, b) => a - b);

  // 按 batchSize 合并时间戳为批次
  const batches: number[][] = [];
  let currentBatch: number[] = [];
  let currentSize = 0;
  for (const ts of timestamps) {
    const count = graph.nodes.filter((n) => n.timestampMs === ts).length;
    if (currentSize + count > batchSize && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(ts);
    currentSize += count;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  // 逐批构建增长 revision
  const revisions: MergedGraph[] = [];
  let accumulatedNodeIds = new Set<string>();

  for (let i = 0; i < batches.length; i++) {
    const batchTimestamps = new Set(batches[i]);
    const newNodes = graph.nodes.filter((n) => batchTimestamps.has(n.timestampMs));
    for (const n of newNodes) accumulatedNodeIds.add(n.id);

    // 边只在两端都进入后加入
    const validEdges = graph.edges.filter(
      (e) => accumulatedNodeIds.has(e.source) && accumulatedNodeIds.has(e.target),
    );

    revisions.push({
      ...graph,
      revision: i + 1,
      nodes: [...accumulatedNodeIds].map((id) => graph.nodes.find((n) => n.id === id)!).filter(Boolean),
      edges: validEdges,
    });
  }

  // 完整性验证：最后 revision 的 nodes/edges 必须与原图一致
  const last = revisions[revisions.length - 1];
  if (last.nodes.length !== graph.nodes.length || last.edges.length !== graph.edges.length) {
    console.warn(`[split] 完整性警告：最终 ${last.nodes.length}节点/${last.edges.length}边 vs 原始 ${graph.nodes.length}/${graph.edges.length}`);
  }

  return revisions;
}
```

- [ ] **Step 2: 冒烟测试**

```bash
cd tools/layout-lab/run && cat > smoke-split.ts <<'EOF'
import { splitGraphByTimestamp } from '../src/split-real-graph.ts';
import fs from 'fs';
const dump = JSON.parse(fs.readFileSync('../inputs/real-graphs-dump.json', 'utf8'));
const graph = dump[32]; // 91 nodes
const revisions = splitGraphByTimestamp(graph, 20);
console.log('#32 split into', revisions.length, 'revisions');
revisions.forEach((r, i) => console.log(`  rev ${i}: ${r.nodes.length} nodes, ${r.edges.length} edges`));
// 完整性
const last = revisions[revisions.length - 1];
console.log('完整性:', last.nodes.length === graph.nodes.length && last.edges.length === graph.edges.length ? 'PASS' : 'FAIL');
EOF
npx tsx smoke-split.ts && rm -f smoke-split.ts
```
Expected: 打印 revision 数 + 节点增长 + 完整性 PASS

- [ ] **Step 3: Commit**

```bash
git add tools/layout-lab/src/split-real-graph.ts
git commit -m "feat(layout-lab): split-real-graph（按 timestampMs 切增长序列）"
```

---

## Task 5: replay-sequence（逐 revision 三候选 + 截图 + 指标）

**Files:**
- Create: `tools/layout-lab/src/replay-sequence.ts`

> 这个 Task 跑 sequence fixture 和真实大图切分序列，逐 revision 跑三候选（产品 stable / R3b full / R3b incremental），截图 + 算指标。

- [ ] **Step 1: 实现（代码较长，见下方）**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import { chromium } from '@playwright/test';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterForceLayout } from './cluster-force-layout';
import { computeIncrementalLayout, type IncrementalState } from './incremental-force';
import { splitGraphByTimestamp } from './split-real-graph';
import { renderModelToHtml } from './html-renderer';
import { renderModelToHtmlV2 } from './html-renderer-v2';
import { computeLayoutMetrics, type Position } from './cluster-internal-layouts';
import { computeAllNodeSizes } from './round3-types';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const FIXTURE_DIR = path.resolve(import.meta.dirname, '../../../packages/graph-fixtures/fixtures/sequences');
const HTML_DIR = path.resolve(import.meta.dirname, '../outputs/round4-html');
const SHOT_DIR = path.resolve(import.meta.dirname, '../outputs/round4-screenshots');
const METRICS_PATH = path.resolve(import.meta.dirname, '../outputs/round4-metrics.json');

type Sequence = {
  name: string;
  revisions: MergedGraph[];
  trackNodeIds: string[]; // 追踪节点
};

function loadFixtureSequences(): Sequence[] {
  const files = ['seq-incremental-growth', 'seq-late-burst', 'seq-pattern-question-incremental'];
  return files.map((name) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
    const revisions = (fixture.steps ?? []).map((s: { graph: MergedGraph }) => s.graph);
    const trackNodeIds = revisions[0]?.nodes?.slice(0, 3).map((n: { id: string }) => n.id) ?? [];
    return { name, revisions, trackNodeIds };
  });
}

function loadRealGraphSequences(): Sequence[] {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  return [49, 41, 32].map((idx) => {
    const revisions = splitGraphByTimestamp(dump[idx], 20);
    const trackNodeIds = revisions[0]?.nodes?.slice(0, 3).map((n) => n.id) ?? [];
    return { name: `real-${idx}`, revisions, trackNodeIds };
  });
}

function extractPositions(items: Array<{ kind: string; nodeId?: string; position?: Position }>): Record<string, Position> {
  const positions: Record<string, Position> = {};
  for (const item of items) {
    if (item.kind === 'fullNode' && item.nodeId && item.position) {
      positions[item.nodeId] = item.position;
    }
  }
  return positions;
}

export async function replayAll(): Promise<void> {
  const sequences = [...loadFixtureSequences(), ...loadRealGraphSequences()];
  fs.mkdirSync(HTML_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const allMetrics: unknown[] = [];

  for (const seq of sequences) {
    console.log(`\n[replay] sequence: ${seq.name} (${seq.revisions.length} revisions)`);

    // R3b incremental 的跨 revision 状态
    let incrementalState: IncrementalState = { positions: {}, sizes: {}, clusterOrigins: {}, prevClusters: [] };
    const allRevMetrics: unknown[] = [];

    for (let rev = 0; rev < seq.revisions.length; rev++) {
      const graph = seq.revisions[rev];
      const padded = String(rev).padStart(2, '0');

      // 三候选
      const baseline = computeBaselinePositions(graph, rev);
      const r3bFull = computeClusterForceLayout(graph, rev, 'R3b');
      const r3bIncremental = computeIncrementalLayout(graph, incrementalState);
      incrementalState = r3bIncremental.state;

      // 生成 HTML（每帧固定画布尺寸 = 最终 revision 尺寸，见 spec 7.1）
      const prefix = `${seq.name}-${padded}`;
      renderModelToHtml(baseline, graph, path.join(HTML_DIR, `${prefix}-baseline.html`));
      renderModelToHtmlV2(r3bFull, graph, path.join(HTML_DIR, `${prefix}-r3bfull.html`));

      // incremental 需要转成 RenderModel 格式（简化：手动构建）
      // 这里直接用 incremental 的 positions 渲染
      const incrementalModel = {
        items: graph.nodes.map((n) => {
          const pos = r3bIncremental.positions[n.id];
          if (!pos) return null;
          const size = computeAllNodeSizes([n])[n.id];
          return { kind: 'fullNode' as const, nodeId: n.id, position: { x: pos.cx - size.width / 2, y: pos.cy - size.height / 2 } };
        }).filter(Boolean),
        edges: graph.edges.filter((e) => r3bIncremental.positions[e.source] && r3bIncremental.positions[e.target])
          .map((e) => ({ source: e.source, target: e.target, type: e.type })),
        clusters: [],
        meta: { candidate: 'R3b-incr' as const, graphIndex: rev, nodeCount: graph.nodes.length, edgeCount: graph.edges.length, clusterCount: 0, majorCount: 0, minorCount: 0 },
      };
      renderModelToHtmlV2(incrementalModel as any, graph, path.join(HTML_DIR, `${prefix}-incr.html`));

      // 指标
      const adaptiveSizes = computeAllNodeSizes(graph.nodes);
      const fixedSizes: Record<string, { width: number; height: number }> = {};
      for (const n of graph.nodes) fixedSizes[n.id] = { width: 220, height: 132 };

      const bp = extractPositions(baseline.items);
      const fp = extractPositions(r3bFull.items);
      const incrPositions: Record<string, Position> = {};
      for (const n of graph.nodes) {
        const pos = r3bIncremental.positions[n.id];
        const size = adaptiveSizes[n.id];
        if (pos) incrPositions[n.id] = { x: pos.cx - size.width / 2, y: pos.cy - size.height / 2 };
      }

      const bm = computeLayoutMetrics(graph.nodes, graph.edges, bp, 220, 132, fixedSizes);
      const fm = computeLayoutMetrics(graph.nodes, graph.edges, fp, 220, 132, adaptiveSizes);
      const im = computeLayoutMetrics(graph.nodes, graph.edges, incrPositions, 220, 132, adaptiveSizes);

      allRevMetrics.push({
        revision: rev,
        nodeCount: graph.nodes.length,
        baseline: bm,
        r3bFull: fm,
        r3bIncremental: { ...im, displacement: r3bIncremental.stats },
      });

      console.log(`  rev ${padded}: ${graph.nodes.length}n ${graph.edges.length}e | incr median=${r3bIncremental.stats?.medianDisplacement ?? '-'}px max=${r3bIncremental.stats?.maxDisplacement ?? '-'}px`);
    }

    allMetrics.push({ sequence: seq.name, trackNodeIds: seq.trackNodeIds, revisions: allRevMetrics });
  }

  fs.writeFileSync(METRICS_PATH, JSON.stringify(allMetrics, null, 2));
  console.log(`\n[replay] 指标写入 ${METRICS_PATH}`);

  // Playwright 截图
  const browser = await chromium.launch({ headless: true });
  for (const seq of sequences) {
    for (let rev = 0; rev < seq.revisions.length; rev++) {
      const padded = String(rev).padStart(2, '0');
      const prefix = `${seq.name}-${padded}`;
      for (const cand of ['baseline', 'r3bfull', 'incr'] as const) {
        const htmlPath = path.join(HTML_DIR, `${prefix}-${cand}.html`);
        if (!fs.existsSync(htmlPath)) continue;
        const page = await browser.newPage();
        try {
          await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
          await page.waitForLoadState('domcontentloaded');
          await page.waitForTimeout(200);
          await page.screenshot({ path: path.join(SHOT_DIR, `${prefix}-${cand}.png`), fullPage: true });
        } catch (e) {
          console.warn(`  截图失败 ${prefix}-${cand}: ${(e as Error).message.split('\n')[0]}`);
        }
        await page.close();
      }
    }
    console.log(`[replay] ${seq.name} 截图完成`);
  }
  await browser.close();
  console.log(`[replay] 全部完成`);
}

void replayAll();
```

- [ ] **Step 2: 运行**

```bash
cd tools/layout-lab/run && npx tsx ../src/replay-sequence.ts
```
Expected: 逐 sequence 逐 revision 打印指标，最终写入 metrics + 截图。

- [ ] **Step 3: Commit**

```bash
git add tools/layout-lab/src/replay-sequence.ts
git commit -m "feat(layout-lab): replay-sequence（逐 revision 三候选 + 截图 + 指标）"
```

---

## Task 6: round4-gallery（固定坐标系 + slider + 追踪节点 + 指标）

**Files:**
- Create: `tools/layout-lab/src/round4-gallery.ts`

- [ ] **Step 1: 实现**

```typescript
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = path.join(ROOT, 'outputs/round4-screenshots');
const METRICS_PATH = path.join(ROOT, 'outputs/round4-metrics.json');

export function renderRound4Gallery(): void {
  const metrics = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));

  const sequences: string[] = metrics.map((m: { sequence: string }) => m.sequence);
  const rows: string[] = [];

  for (const seqData of metrics) {
    const seqName: string = seqData.sequence;
    const trackNodeIds: string[] = seqData.trackNodeIds ?? [];
    const revisions = seqData.revisions ?? [];

    // revision slider 行
    const revCount = revisions.length;
    const revButtons = Array.from({ length: revCount }, (_, i) =>
      `<button class="rev-btn" data-seq="${seqName}" data-rev="${i}" onclick="showRev('${seqName}',${i})">${i}</button>`
    ).join('');

    // 每个 revision 的三栏图片
    const revPanes = revisions.map((rev: { revision: number; nodeCount: number }, i: number) => {
      const padded = String(i).padStart(2, '0');
      const prefix = `${seqName}-${padded}`;
      const shot = (c: string) => {
        const p = path.join(SHOT_DIR, `${prefix}-${c}.png`);
        return fs.existsSync(p) ? `round4-screenshots/${prefix}-${c}.png` : '';
      };
      const disp = rev.r3bIncremental?.displacement;
      const dispStr = disp ? `中位:${disp.medianDisplacement}px 最大:${disp.maxDisplacement}px cap:${(disp.capHitRate * 100).toFixed(0)}%` : '首个revision';
      return `<div class="rev-pane" id="${seqName}-${i}" style="display:none;">
        <div class="rev-info">rev ${i} · ${rev.nodeCount} 节点 · ${dispStr}</div>
        <div class="candidates">
          <div class="cand"><h4>产品 stable</h4><img src="${shot('baseline')}" /></div>
          <div class="cand"><h4>R3b 全量重算</h4><img src="${shot('r3bfull')}" /></div>
          <div class="cand"><h4>R3b incremental</h4><img src="${shot('incr')}" /></div>
        </div>
      </div>`;
    }).join('');

    rows.push(`
      <div class="seq-section">
        <h2>${seqName} <span class="track">追踪: ${trackNodeIds.join(', ')}</span></h2>
        <div class="rev-nav">${revButtons}</div>
        ${revPanes}
      </div>
    `);
  }

  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>Round 4 Incremental Stability</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#fafafa}
.seq-section{background:#fff;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:20px}
.rev-nav{display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap}
.rev-btn{padding:4px 10px;border:1px solid #ccc;border-radius:4px;background:#f5f5f5;cursor:pointer;font-size:12px}
.rev-btn:hover{background:#e0e0e0}
.rev-btn.active{background:#3b82f6;color:#fff;border-color:#3b82f6}
.candidates{display:flex;gap:8px}
.cand{flex:1;min-width:0}
.cand img{width:100%;border:1px solid #eee}
.rev-info{font-size:12px;color:#666;margin-bottom:6px}
.track{font-size:11px;color:#999;font-weight:normal}
h2{font-size:15px;margin:0 0 8px}h4{margin:0 0 4px;font-size:12px;color:#666}
</style>
<script>
function showRev(seq, rev) {
  // 隐藏该序列所有 pane
  document.querySelectorAll('[id^="' + seq + '-"]').forEach(el => el.style.display = 'none');
  // 显示选中的
  const pane = document.getElementById(seq + '-' + rev);
  if (pane) pane.style.display = 'block';
  // 更新按钮状态
  document.querySelectorAll('.rev-btn[data-seq="' + seq + '"]').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector('.rev-btn[data-seq="' + seq + '"][data-rev="' + rev + '"]');
  if (btn) btn.classList.add('active');
}
// 默认显示每个序列的第一个 revision
window.addEventListener('load', () => {
  document.querySelectorAll('.seq-section').forEach(sec => {
    const firstBtn = sec.querySelector('.rev-btn');
    if (firstBtn) firstBtn.click();
  });
});
</script>
</head><body>
<h1>Round 4: R3b 增量稳定性</h1>
<p>三候选逐 revision 对比。追踪节点应跨 revision 保持位置稳定。<br>
关键指标：旧节点中位位移 <30px、最大 <100px、capHitRate <10%。</p>
${rows.join('')}
</body></html>`;

  fs.writeFileSync(path.join(ROOT, 'outputs/round4-gallery.html'), html);
  console.log(`[round4-gallery] 完成 → outputs/round4-gallery.html`);
}

renderRound4Gallery();
```

- [ ] **Step 2: 生成 gallery**

```bash
cd tools/layout-lab/run && npx tsx ../src/round4-gallery.ts
```

- [ ] **Step 3: Commit**

```bash
git add tools/layout-lab/src/round4-gallery.ts
git commit -m "feat(layout-lab): round4-gallery（revision slider + 三栏 + 追踪节点 + 指标）"
```

---

## 完成标准

- [ ] 6 个 Task 全部落地
- [ ] 全套测试通过（Round 1-4 累计）
- [ ] sequence fixture + 真实大图切分序列的逐 revision 截图生成
- [ ] `round4-metrics.json` 含逐 revision 位移指标
- [ ] `round4-gallery.html` 有 revision slider + 三栏对比
- [ ] **人眼审核**：追踪节点跨 revision 是否稳定 + 最终态质量是否接近 Round 3
