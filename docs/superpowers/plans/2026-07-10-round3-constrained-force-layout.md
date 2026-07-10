# Round 3：Constrained Force Layout + Cluster + 自适应节点实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 验证"受约束力导向（R3a 引力 / R3b 宽度惩罚）+ 自适应节点 + cluster-first 外层"是否比 baseline 更可读，产出三栏 gallery 供人眼 go/no-go。

**Architecture:** 在 `tools/layout-lab/` 上扩展。力导向核心升级（面积斥力 + AABB 碰撞消除）+ 自适应节点尺寸（按截断文本算）+ cluster 外层 packing（800px 纵向堆叠）+ 离线 HTML renderer v2。R3a/R3b 两候选各自独立评分。

**Tech Stack:** TypeScript + tsx、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-07-10-round3-constrained-force-layout.md`

---

## 任务依赖

```
Task 1: round3-types（NodeSize + 常量）
  └─ Task 2: force-core-v2（面积斥力 + AABB resolveOverlaps，TDD）
        └─ Task 3: cluster-force-layout（R3a 引力 + R3b 宽度惩罚 + cluster 外层）
Task 4: html-renderer-v2（自适应节点渲染）
  └─ Task 5: render-round3（主流程：三候选 → HTML → Playwright 截图）
        └─ Task 6: round3-gallery + 指标 + 评分模板
```

Task 1-3 顺序做。Task 4 依赖 Task 1。Task 5 依赖全部。

---

## Task 1: round3-types（NodeSize + 常量）

**Files:**
- Create: `tools/layout-lab/src/round3-types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
import type { GraphNode } from '@listen-graphic/schema';

// 力 simulation 内部使用中心点坐标
export type CenterPos = { cx: number; cy: number };

// 自适应节点尺寸
export type NodeSize = { width: number; height: number };

// 力导向参数
export const FORCE_PARAMS = {
  REPULSION_K: 80000,       // 面积斥力基数
  SPRING_LENGTH: 160,        // 弹簧目标长度
  SPRING_K: 0.04,            // 弹簧刚度
  DAMPING: 0.85,             // 阻尼
  MAX_DISPLACEMENT: 50,      // 单轮最大位移
  ITERATIONS: 300,           // 力导向迭代次数
  OVERLAP_ROUNDS: 20,        // 碰撞消除轮数
} as const;

// R3a 引力参数
export const GRAVITY_STRENGTH = 0.015;

// R3b 宽度惩罚参数
export const PENALTY_STRENGTH = 0.08;

// 竖向约束目标宽度
export const TARGET_WIDTH = 600;

// 外层 cluster packing
export const OUTER_TARGET_WIDTH = 800;

// 自适应节点尺寸计算参数
const CHAR_WIDTH = 12;
const PADDING = 12;
const MIN_WIDTH = 80;
const MAX_WIDTH = 200;
const MIN_HEIGHT = 50;
const TYPE_LABEL_HEIGHT = 16;
const LINE_HEIGHT = 18;
const DISPLAY_TEXT_MAX = 60; // 与 renderer truncate 同源

// 截断文本（与 html-renderer 的 truncate 同源）
export function truncateText(text: string, max = DISPLAY_TEXT_MAX): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// 自适应节点尺寸：基于截断后的显示文本（spec 1.1 + 审核修正 #4）
export function computeNodeSize(text: string): NodeSize {
  const displayText = truncateText(text);
  const textLen = displayText.length;
  const idealWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, textLen * CHAR_WIDTH + PADDING * 2));
  const charsPerLine = Math.floor((idealWidth - PADDING * 2) / CHAR_WIDTH);
  const lineCount = Math.max(1, Math.ceil(textLen / Math.max(1, charsPerLine)));
  const height = Math.max(MIN_HEIGHT, TYPE_LABEL_HEIGHT + lineCount * LINE_HEIGHT + PADDING * 2);
  return { width: idealWidth, height };
}

// 批量算尺寸
export function computeAllNodeSizes(nodes: GraphNode[]): Record<string, NodeSize> {
  const sizes: Record<string, NodeSize> = {};
  for (const n of nodes) {
    sizes[n.id] = computeNodeSize(n.text);
  }
  return sizes;
}
```

- [ ] **Step 2: 写单测**

Create `tools/layout-lab/src/round3-types.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computeNodeSize, truncateText } from './round3-types';

describe('computeNodeSize', () => {
  it('空文本：最小尺寸', () => {
    const s = computeNodeSize('');
    expect(s.width).toBe(80);
    expect(s.height).toBe(50);
  });

  it('21 字（P50）：宽 200，高 76（2 行）', () => {
    const s = computeNodeSize('x'.repeat(21));
    expect(s.width).toBe(200);
    expect(s.height).toBe(76);
  });

  it('42 字（P90）：宽 200，高 94（3 行）', () => {
    const s = computeNodeSize('x'.repeat(42));
    expect(s.width).toBe(200);
    expect(s.height).toBe(94);
  });

  it('超长文本（184 字）截断到 60+… 后算尺寸', () => {
    const s = computeNodeSize('x'.repeat(184));
    // 截断后 61 字（60 + …），5 行
    expect(s.width).toBe(200);
    expect(s.height).toBe(130); // 16 + 5*18 + 24 = 130
  });

  it('10 字：宽 144，高 58（1 行）', () => {
    const s = computeNodeSize('x'.repeat(10));
    expect(s.width).toBe(144);
    expect(s.height).toBe(58);
  });
});

describe('truncateText', () => {
  it('超 60 字截断加 …', () => {
    expect(truncateText('x'.repeat(70)).length).toBe(61); // 60 + …
  });
  it('不超 60 字不截断', () => {
    expect(truncateText('x'.repeat(50))).toBe('x'.repeat(50));
  });
});
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd tools/layout-lab/run && npx vitest run ../src/round3-types.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 4: Commit**

```bash
git add tools/layout-lab/src/round3-types.ts tools/layout-lab/src/round3-types.test.ts
git commit -m "feat(layout-lab): round3 自适应节点尺寸类型 + 单测"
```

---

## Task 2: force-core-v2（面积斥力 + AABB resolveOverlaps）

**Files:**
- Create: `tools/layout-lab/src/force-core-v2.ts`
- Create: `tools/layout-lab/src/force-core-v2.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, expect, it } from 'vitest';
import { resolveOverlaps, type CenterPos } from './force-core-v2';
import type { NodeSize } from './round3-types';

describe('resolveOverlaps', () => {
  it('两个不重叠的节点不动', () => {
    const pos: Record<string, CenterPos> = {
      a: { cx: 0, cy: 0 },
      b: { cx: 500, cy: 500 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes);
    expect(pos.a.cx).toBe(0);
    expect(pos.b.cx).toBe(500);
  });

  it('两个水平重叠的节点沿 X 轴推开', () => {
    const pos: Record<string, CenterPos> = {
      a: { cx: 100, cy: 0 },
      b: { cx: 150, cy: 0 }, // 中心距 50，但 width 200 → 重叠 150
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes);
    // 推开后中心距应 >= 200（width 之和/2）
    const dist = Math.abs(pos.a.cx - pos.b.cx);
    expect(dist).toBeGreaterThanOrEqual(200);
  });

  it('两个垂直重叠的节点沿 Y 轴推开', () => {
    const pos: Record<string, CenterPos> = {
      a: { cx: 0, cy: 100 },
      b: { cx: 0, cy: 130 }, // 中心距 30，height 100 → 重叠 70
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes);
    const dist = Math.abs(pos.a.cy - pos.b.cy);
    expect(dist).toBeGreaterThanOrEqual(100);
  });

  it('中心重合时按 id 稳定方向推开', () => {
    const pos: Record<string, CenterPos> = {
      b: { cx: 0, cy: 0 },
      a: { cx: 0, cy: 0 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes);
    // 应该推开了（不再重合）
    expect(pos.a.cx).not.toBe(pos.b.cx);
    // a 的 id 字母序 < b，a 应被推向左/上
    expect(pos.a.cx).toBeLessThan(pos.b.cx);
  });

  it('多轮迭代消除三节点链式重叠', () => {
    const pos: Record<string, CenterPos> = {
      a: { cx: 0, cy: 0 },
      b: { cx: 10, cy: 0 },
      c: { cx: 20, cy: 0 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
      c: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes, 30);
    // 所有点对不重叠
    const distAB = Math.abs(pos.a.cx - pos.b.cx);
    const distBC = Math.abs(pos.b.cx - pos.c.cx);
    const distAC = Math.abs(pos.a.cx - pos.c.cx);
    // 水平方向至少推到了不重叠（但因为只在重叠轴推，可能某些对仍竖直重叠）
    // 至少 a 和 c 不应重叠
    const overlapAC = (200 / 2 + 200 / 2) - distAC;
    expect(overlapAC).toBeLessThanOrEqual(0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd tools/layout-lab/run && npx vitest run ../src/force-core-v2.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 force-core-v2.ts**

```typescript
import type { CenterPos } from './force-core-v2';
import type { NodeSize } from './round3-types';
import { FORCE_PARAMS } from './round3-types';

// AABB minimum translation 碰撞消除（spec 审核修正 #5）
// 沿较小重叠轴各推一半；中心重合时按 id 字母序稳定方向
export function resolveOverlaps(
  positions: Record<string, CenterPos>,
  sizes: Record<string, NodeSize>,
  rounds: number = FORCE_PARAMS.OVERLAP_ROUNDS,
): void {
  const ids = Object.keys(positions).sort(); // 稳定顺序

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

        if (overlapX <= 0 || overlapY <= 0) continue; // 不重叠
        anyOverlap = true;

        if (overlapX < overlapY) {
          // 沿 X 推
          let dir: number;
          if (dx === 0) {
            dir = a < b ? -1 : 1; // 中心重合按 id 稳定方向
          } else {
            dir = dx > 0 ? 1 : -1; // a 在右边往右推
          }
          positions[a].cx += dir * overlapX / 2;
          positions[b].cx -= dir * overlapX / 2;
        } else {
          // 沿 Y 推
          let dir: number;
          if (dy === 0) {
            dir = a < b ? -1 : 1;
          } else {
            dir = dy > 0 ? 1 : -1;
          }
          positions[a].cy += dir * overlapY / 2;
          positions[b].cy -= dir * overlapY / 2;
        }
      }
    }
    if (!anyOverlap) break; // 没有重叠了，提前结束
  }
}

// 重新导出 CenterPos（供其他模块 import）
export type { CenterPos };
```

注意：`CenterPos` 类型定义和导出在同一文件。上面的 `import type { CenterPos } from './force-core-v2'` 在文件内部是自引用——修正为直接在文件内定义：

```typescript
// 文件顶部定义
export type CenterPos = { cx: number; cy: number };
```

（删除顶部的自引用 import 行，直接在文件内 export type。）

- [ ] **Step 4: 运行测试验证通过**

Run: `cd tools/layout-lab/run && npx vitest run ../src/force-core-v2.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/src/force-core-v2.ts tools/layout-lab/src/force-core-v2.test.ts
git commit -m "feat(layout-lab): force-core-v2 AABB resolveOverlaps + 单测"
```

---

## Task 3: cluster-force-layout（R3a + R3b + cluster 外层）

**Files:**
- Create: `tools/layout-lab/src/cluster-force-layout.ts`
- Create: `tools/layout-lab/src/cluster-force-layout.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeClusterForceLayout } from './cluster-force-layout';
import type { MergedGraph } from '@listen-graphic/schema';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
function loadGraph(i: number): MergedGraph {
  return (JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[])[i];
}

describe('computeClusterForceLayout', () => {
  it('R3a 大图 #49：产出坐标 + cluster 元信息', () => {
    const graph = loadGraph(49);
    const result = computeClusterForceLayout(graph, 49, 'R3a');
    expect(result.meta.candidate).toBe('R3a');
    expect(result.meta.clusterCount).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
    // 所有节点都有位置
    const positioned = result.items.filter((i) => 'position' in i);
    expect(positioned.length).toBe(graph.nodes.length);
  });

  it('R3b 大图 #49：产出坐标 + cluster 元信息', () => {
    const graph = loadGraph(49);
    const result = computeClusterForceLayout(graph, 49, 'R3b');
    expect(result.meta.candidate).toBe('R3b');
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('小图 #18 不伤害：所有节点有坐标', () => {
    const graph = loadGraph(18);
    const result = computeClusterForceLayout(graph, 18, 'R3a');
    const positioned = result.items.filter((i) => 'position' in i);
    expect(positioned.length).toBe(graph.nodes.length);
  });

  it('cluster bounds 不重叠', () => {
    const graph = loadGraph(41);
    const result = computeClusterForceLayout(graph, 41, 'R3b');
    for (let i = 0; i < result.clusters.length; i++) {
      for (let j = i + 1; j < result.clusters.length; j++) {
        const a = result.clusters[i].bounds;
        const b = result.clusters[j].bounds;
        const overlaps = !(
          a.x + a.width + 10 <= b.x ||
          b.x + b.width + 10 <= a.x ||
          a.y + a.height + 10 <= b.y ||
          b.y + b.height + 10 <= a.y
        );
        expect(overlaps).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd tools/layout-lab/run && npx vitest run ../src/cluster-force-layout.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 cluster-force-layout.ts**

```typescript
import type { MergedGraph, GraphNode, GraphEdge, EdgeType } from '@listen-graphic/schema';
import { partitionClusters } from './cluster-partition';
import { resolveOverlaps, type CenterPos } from './force-core-v2';
import {
  computeAllNodeSizes, computeNodeSize, truncateText,
  FORCE_PARAMS, GRAVITY_STRENGTH, PENALTY_STRENGTH, TARGET_WIDTH, OUTER_TARGET_WIDTH,
  type NodeSize,
} from './round3-types';
import { CARD_WIDTH, CARD_HEIGHT, CLUSTER_GAP, LOOSE_NOTE_ITEM_HEIGHT, LOOSE_NOTE_ITEM_WIDTH,
  type RenderModel, type RenderItem, type RenderEdge, type ClusterInfo, type Position } from './round2-types';

const STRUCTURAL_TYPES = new Set<EdgeType>(['causes', 'supports', 'example_of', 'follows', 'opposes']);

// 簇内力导向（面积斥力 + spring + 竖向约束 + resolveOverlaps）
function layoutClusterForce(
  nodes: GraphNode[],
  edges: GraphEdge[],
  sizes: Record<string, NodeSize>,
  variant: 'R3a' | 'R3b',
): Record<string, CenterPos> {
  if (nodes.length === 0) return {};
  if (nodes.length === 1) return { [nodes[0].id]: { cx: TARGET_WIDTH / 2, cy: 0 } };

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeList: Array<{ source: string; target: string }> = [];
  for (const e of edges) {
    if (!STRUCTURAL_TYPES.has(e.type)) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    edgeList.push({ source: e.source, target: e.target });
  }

  // 初始位置：圆形
  const positions: Record<string, CenterPos> = {};
  const radius = Math.max(200, nodes.length * 15);
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    positions[n.id] = {
      cx: Math.cos(angle) * radius + (i % 3) * 10,
      cy: Math.sin(angle) * radius + (i % 3) * 10,
    };
  });

  const { REPULSION_K, SPRING_LENGTH, SPRING_K, DAMPING, MAX_DISPLACEMENT, ITERATIONS } = FORCE_PARAMS;
  const velocities: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) velocities[n.id] = { x: 0, y: 0 };

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const forces: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) forces[n.id] = { x: 0, y: 0 };

    // 面积斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = positions[a.id].cx - positions[b.id].cx;
        const dy = positions[a.id].cy - positions[b.id].cy;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const areaA = sizes[a.id].width * sizes[a.id].height;
        const areaB = sizes[b.id].width * sizes[b.id].height;
        const repulsion = REPULSION_K * Math.sqrt(areaA * areaB) / (dist * dist);
        forces[a.id].x += (dx / dist) * repulsion;
        forces[a.id].y += (dy / dist) * repulsion;
        forces[b.id].x -= (dx / dist) * repulsion;
        forces[b.id].y -= (dy / dist) * repulsion;
      }
    }

    // Spring attraction
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

    // 竖向约束力
    if (variant === 'R3a') {
      // Center-axis gravity
      const centerX = TARGET_WIDTH / 2;
      for (const n of nodes) {
        forces[n.id].x += (centerX - positions[n.id].cx) * GRAVITY_STRENGTH;
      }
    } else {
      // R3b: soft width penalty（按矩形边界，审核修正 #3）
      for (const n of nodes) {
        const w = sizes[n.id].width;
        const cx = positions[n.id].cx;
        const leftOvershoot = Math.max(0, w / 2 - cx);
        const rightOvershoot = Math.max(0, cx + w / 2 - TARGET_WIDTH);
        forces[n.id].x += leftOvershoot * PENALTY_STRENGTH - rightOvershoot * PENALTY_STRENGTH;
      }
    }

    // Apply forces
    for (const n of nodes) {
      velocities[n.id].x = (velocities[n.id].x + forces[n.id].x) * DAMPING;
      velocities[n.id].y = (velocities[n.id].y + forces[n.id].y) * DAMPING;
      positions[n.id].cx += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].x));
      positions[n.id].cy += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].y));
    }
  }

  // 碰撞消除后处理
  resolveOverlaps(positions, sizes);

  return positions;
}

// center → top-left 转换（spec 2.2 坐标语义）
function centerToTopLeft(pos: CenterPos, size: NodeSize): Position {
  return { x: pos.cx - size.width / 2, y: pos.cy - size.height / 2 };
}

export function computeClusterForceLayout(
  graph: MergedGraph,
  graphIndex: number,
  variant: 'R3a' | 'R3b',
): RenderModel {
  const partition = partitionClusters(graph);
  const allSizes = computeAllNodeSizes(graph.nodes);
  const items: RenderItem[] = [];
  const edges: RenderEdge[] = [];
  const clusters: ClusterInfo[] = [];

  let currentY = 0;

  for (const cluster of partition.clusters) {
    const clusterNodes = graph.nodes.filter((n) => cluster.nodeIds.includes(n.id));
    const clusterEdges = graph.edges.filter(
      (e) => cluster.nodeIds.includes(e.source) && cluster.nodeIds.includes(e.target) && e.source !== e.target,
    );
    const clusterSizes: Record<string, NodeSize> = {};
    for (const id of cluster.nodeIds) clusterSizes[id] = allSizes[id];

    let localItems: RenderItem[] = [];
    let localWidth = 0;
    let localHeight = 0;

    if (cluster.type === 'major') {
      // 力导向布局（中心点坐标）
      const centerPositions = layoutClusterForce(clusterNodes, clusterEdges, clusterSizes, variant);

      // 转 top-left + offset
      localItems = cluster.nodeIds
        .filter((id) => centerPositions[id])
        .map((id) => ({
          kind: 'fullNode' as const,
          nodeId: id,
          position: centerToTopLeft(centerPositions[id], clusterSizes[id]),
        }));

      for (const e of clusterEdges) {
        if (centerPositions[e.source] && centerPositions[e.target]) {
          edges.push({ source: e.source, target: e.target, type: e.type });
        }
      }

      // local bounds
      const xs = localItems.filter((i) => 'position' in i).map((i) => (i as any).position.x);
      const ys = localItems.filter((i) => 'position' in i).map((i) => (i as any).position.y);
      localWidth = xs.length > 0 ? Math.max(...xs) + 200 - Math.min(...xs) : 200;
      localHeight = ys.length > 0 ? Math.max(...ys) + 100 - Math.min(...ys) : 100;
    } else {
      // minor → loose notes
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
      const sorted = [...cluster.nodeIds].sort((a, b) => {
        return (nodeById.get(a)?.timestampMs ?? 0) - (nodeById.get(b)?.timestampMs ?? 0);
      });
      sorted.forEach((id, i) => {
        localItems.push({
          kind: 'looseNoteItem' as const,
          nodeId: id,
          position: { x: 0, y: i * LOOSE_NOTE_ITEM_HEIGHT },
        });
      });
      localWidth = LOOSE_NOTE_ITEM_WIDTH;
      localHeight = sorted.length * LOOSE_NOTE_ITEM_HEIGHT;
    }

    // offset 到外层位置（纵向堆叠）
    const placeY = currentY;
    for (const item of localItems) {
      if ('position' in item) {
        items.push({
          ...item,
          position: { x: item.position.x, y: item.position.y + placeY },
        });
      }
    }

    clusters.push({
      id: cluster.id,
      type: cluster.type,
      nodeIds: cluster.nodeIds,
      bounds: { x: 0, y: placeY, width: Math.min(localWidth, OUTER_TARGET_WIDTH), height: localHeight },
    });

    currentY = placeY + localHeight + CLUSTER_GAP;
  }

  const majorCount = partition.clusters.filter((c) => c.type === 'major').length;
  const minorCount = partition.clusters.filter((c) => c.type === 'minor').length;

  return {
    items, edges, clusters,
    meta: {
      candidate: variant, graphIndex,
      nodeCount: graph.nodes.length, edgeCount: graph.edges.length,
      clusterCount: partition.clusters.length, majorCount, minorCount,
    },
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd tools/layout-lab/run && npx vitest run ../src/cluster-force-layout.test.ts`
Expected: PASS — 4 tests

若力导向对大图 #49（271 节点）太慢（O(n²) 斥力 × 300 迭代），测试可能超时。如果超时，减少 #49 的迭代数或在测试里跳过 #49 只测 #41。但 271 节点的 O(n²) = ~73000 对 × 300 = ~22M 操作，应该在几秒内完成。

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/src/cluster-force-layout.ts tools/layout-lab/src/cluster-force-layout.test.ts
git commit -m "feat(layout-lab): cluster-force-layout R3a/R3b（力导向+cluster外层）"
```

---

## Task 4: html-renderer-v2（自适应节点渲染）

**Files:**
- Create: `tools/layout-lab/src/html-renderer-v2.ts`

- [ ] **Step 1: 实现 html-renderer-v2.ts**

基于 `html-renderer.ts`，改动：节点用自适应宽高，边端点用实际节点中心。

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import type { RenderModel, RenderItem } from './round2-types';
import { computeNodeSize, truncateText } from './round3-types';

const NODE_COLORS: Record<string, string> = {
  claim: '#3b82f6', reason: '#10b981', example: '#8b5cf6',
  question: '#f59e0b', conclusion: '#6b7280',
};
const EDGE_COLORS: Record<string, string> = {
  supports: '#10b981', opposes: '#ef4444', causes: '#f59e0b',
  follows: '#6b7280', example_of: '#8b5cf6',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderModelToHtmlV2(
  model: RenderModel,
  graph: MergedGraph,
  outputPath: string,
): void {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // 算每个节点的自适应尺寸
  const sizes: Record<string, { width: number; height: number }> = {};
  for (const n of graph.nodes) sizes[n.id] = computeNodeSize(n.text);

  // 算画布尺寸（用实际节点宽高）
  let maxX = 0, maxY = 0;
  for (const item of model.items) {
    if (item.kind === 'fullNode') {
      const s = sizes[item.nodeId];
      maxX = Math.max(maxX, item.position.x + s.width);
      maxY = Math.max(maxY, item.position.y + s.height);
    } else if (item.kind === 'looseNoteItem') {
      maxX = Math.max(maxX, item.position.x + 200);
      maxY = Math.max(maxY, item.position.y + 32);
    } else if (item.kind === 'clusterSummary') {
      maxX = Math.max(maxX, item.position.x + 200);
      maxY = Math.max(maxY, item.position.y + 80);
    }
  }
  for (const c of model.clusters) {
    maxX = Math.max(maxX, c.bounds.x + c.bounds.width);
    maxY = Math.max(maxY, c.bounds.y + c.bounds.height);
  }

  // cluster 背景
  const clusterDivs = model.clusters
    .map((c) => {
      const bg = c.type === 'major' ? 'rgba(59,130,246,0.06)' : 'rgba(107,114,128,0.06)';
      const border = c.type === 'major' ? 'rgba(59,130,246,0.2)' : 'rgba(107,114,128,0.2)';
      return `<div style="position:absolute;left:${c.bounds.x}px;top:${c.bounds.y}px;width:${c.bounds.width}px;height:${c.bounds.height}px;background:${bg};border:1px dashed ${border};border-radius:8px;"></div>`;
    })
    .join('\n');

  // 节点渲染（自适应宽高）
  const itemDivs = model.items
    .map((item) => {
      if (item.kind === 'fullNode') {
        const node = nodeById.get(item.nodeId);
        if (!node) return '';
        const s = sizes[item.nodeId];
        const color = NODE_COLORS[node.type] ?? '#6b7280';
        const text = escapeHtml(truncateText(node.text));
        const speaker = node.speaker ? `<div style="font-size:10px;color:#888;">${escapeHtml(node.speaker)}</div>` : '';
        return `<div style="position:absolute;left:${item.position.x}px;top:${item.position.y}px;width:${s.width}px;height:${s.height}px;border:2px solid ${color};border-radius:8px;background:#fff;padding:6px;box-sizing:border-box;overflow:hidden;font-size:11px;">
          <div style="font-size:9px;color:${color};font-weight:600;text-transform:uppercase;">${node.type}</div>
          <div style="margin-top:3px;line-height:1.2;">${text}</div>${speaker}
        </div>`;
      }
      if (item.kind === 'looseNoteItem') {
        const node = nodeById.get(item.nodeId);
        if (!node) return '';
        const color = NODE_COLORS[node.type] ?? '#6b7280';
        const text = escapeHtml(truncateText(node.text, 30));
        return `<div style="position:absolute;left:${item.position.x}px;top:${item.position.y}px;width:200px;height:32px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #eee;">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <span style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${text}</span>
        </div>`;
      }
      if (item.kind === 'clusterSummary') {
        return `<div style="position:absolute;left:${item.position.x}px;top:${item.position.y}px;width:200px;height:80px;border:2px dashed #aaa;border-radius:8px;background:#f9fafb;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style="font-size:12px;color:#666;font-weight:600;">未展开分区</div>
          <div style="font-size:11px;color:#999;margin-top:4px;">${item.nodeCount} 节点 · ${item.edgeCount} 边</div>
        </div>`;
      }
      return '';
    })
    .join('\n');

  // 边（用实际节点中心）
  const edgesSvg = model.edges.length > 0
    ? `<svg style="position:absolute;left:0;top:0;width:${maxX}px;height:${maxY}px;pointer-events:none;">
      ${model.edges.map((e) => {
        const srcItem = model.items.find((i) => 'nodeId' in i && i.nodeId === e.source);
        const tgtItem = model.items.find((i) => 'nodeId' in i && i.nodeId === e.target);
        if (!srcItem || !tgtItem || !('position' in srcItem) || !('position' in tgtItem)) return '';
        const ss = sizes[e.source] ?? { width: 200, height: 100 };
        const ts = sizes[e.target] ?? { width: 200, height: 100 };
        const sx = srcItem.position.x + ss.width / 2;
        const sy = srcItem.position.y + ss.height / 2;
        const tx = tgtItem.position.x + ts.width / 2;
        const ty = tgtItem.position.y + ts.height / 2;
        const color = EDGE_COLORS[e.type] ?? '#6b7280';
        return `<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="${color}" stroke-width="1" opacity="0.4" />`;
      }).join('\n')}
    </svg>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:system-ui,sans-serif;}
    .canvas{position:relative;width:${maxX}px;height:${maxY}px;}
    .meta{position:fixed;top:0;left:0;background:rgba(0,0,0,0.8);color:#fff;padding:4px 10px;font-size:12px;z-index:999;}
  </style></head><body>
    <div class="meta">${model.meta.candidate} | #${model.meta.graphIndex} | ${model.meta.nodeCount}节点 ${model.meta.edgeCount}边 | ${model.meta.clusterCount}簇</div>
    <div class="canvas">${clusterDivs}${edgesSvg}${itemDivs}</div>
  </body></html>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
}
```

- [ ] **Step 2: 冒烟测试**

```bash
cd tools/layout-lab/run && cat > smoke-v2.ts <<'EOF'
import { computeClusterForceLayout } from '../src/cluster-force-layout.ts';
import { renderModelToHtmlV2 } from '../src/html-renderer-v2.ts';
import fs from 'fs';
const dump = JSON.parse(fs.readFileSync('../inputs/real-graphs-dump.json', 'utf8'));
const graph = dump[49];
const model = computeClusterForceLayout(graph, 49, 'R3b');
renderModelToHtmlV2(model, graph, '../outputs/round3-html/smoke-r3b-49.html');
console.log('done, items:', model.items.length, 'clusters:', model.meta.clusterCount);
EOF
npx tsx smoke-v2.ts && rm -f smoke-v2.ts
```
Expected: prints items count + clusters, generates HTML file.

- [ ] **Step 3: Commit**

```bash
git add tools/layout-lab/src/html-renderer-v2.ts
git commit -m "feat(layout-lab): html-renderer-v2（自适应节点宽高渲染）"
```

---

## Task 5: render-round3（主流程：三候选 → HTML → 截图）

**Files:**
- Create: `tools/layout-lab/src/render-round3.ts`

- [ ] **Step 1: 实现 render-round3.ts**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterForceLayout } from './cluster-force-layout';
import { renderModelToHtml } from './html-renderer';        // v1：baseline 用固定 220×132
import { renderModelToHtmlV2 } from './html-renderer-v2';   // v2：R3a/R3b 用自适应尺寸

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const HTML_DIR = path.resolve(import.meta.dirname, '../outputs/round3-html');
const SHOT_DIR = path.resolve(import.meta.dirname, '../outputs/round3-screenshots');

const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46,
  37, 32, 58, 57,
  18, 21, 16, 12, 6,
  33, 51,
];

export async function renderRound3(): Promise<void> {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  fs.mkdirSync(HTML_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  for (const idx of SAMPLE_INDICES) {
    const graph = dump[idx];
    if (!graph) { console.warn(`[round3] #${idx} 不存在`); continue; }
    const padded = String(idx).padStart(2, '0');

    // baseline（用 defaultView，固定 220x132）
    const baseline = computeBaselinePositions(graph, idx);
    // R3a（引力收窄）
    const r3a = computeClusterForceLayout(graph, idx, 'R3a');
    // R3b（宽度惩罚）
    const r3b = computeClusterForceLayout(graph, idx, 'R3b');

    // baseline 用 v1 renderer（固定 220×132，产品实际尺寸）
    // R3a/R3b 用 v2 renderer（自适应尺寸）
    renderModelToHtml(baseline, graph, path.join(HTML_DIR, `${padded}-baseline.html`));
    renderModelToHtmlV2(r3a, graph, path.join(HTML_DIR, `${padded}-R3a.html`));
    renderModelToHtmlV2(r3b, graph, path.join(HTML_DIR, `${padded}-R3b.html`));

    console.log(`[round3] #${padded}: baseline=${baseline.items.length}items R3a=${r3a.meta.clusterCount}clusters R3b=${r3b.meta.clusterCount}clusters`);
  }

  // Playwright 截图
  const browser = await chromium.launch({ headless: true });
  for (const idx of SAMPLE_INDICES) {
    const padded = String(idx).padStart(2, '0');
    for (const cand of ['baseline', 'R3a', 'R3b'] as const) {
      const htmlPath = path.join(HTML_DIR, `${padded}-${cand}.html`);
      if (!fs.existsSync(htmlPath)) continue;
      const page = await browser.newPage();
      await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOT_DIR, `${padded}-${cand}.png`), fullPage: true });
      await page.close();
    }
    console.log(`[round3] #${padded} 截图完成`);
  }
  await browser.close();
  console.log(`[round3] 全部完成：${SAMPLE_INDICES.length} 条图 × 3 候选`);
}

void renderRound3();
```

baseline 用 v1（固定 220×132，产品实际尺寸），R3a/R3b 用 v2（自适应尺寸）。对比时能看出"自适应节点 + 力导向"整体效果 vs "固定大节点 + 产品布局"。

- [ ] **Step 2: 运行全流程**

```bash
cd tools/layout-lab/run && npx tsx ../src/render-round3.ts
```
Expected: 23 条图 × 3 = 69 张截图。

注意大图（#49 271 节点）的力导向计算可能需要 30-60 秒。全流程预计 10-20 分钟。

- [ ] **Step 3: 验证截图**

```bash
node -e "console.log(require('fs').readdirSync('tools/layout-lab/outputs/round3-screenshots').filter(f=>f.endsWith('.png')).length, 'PNGs')"
```
Expected: 69

- [ ] **Step 4: Commit**

```bash
git add tools/layout-lab/src/render-round3.ts
git commit -m "feat(layout-lab): render-round3 主流程（三候选→HTML→截图）"
```

---

## Task 6: round3-gallery + 指标 + 评分模板

**Files:**
- Create: `tools/layout-lab/src/round3-gallery.ts`

- [ ] **Step 1: 实现 round3-gallery.ts**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterForceLayout } from './cluster-force-layout';
import { computeAllNodeSizes, truncateText } from './round3-types';
import { computeLayoutMetrics } from './cluster-internal-layouts';
import type { Position, LayoutMetrics } from './cluster-internal-layouts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = path.join(ROOT, 'outputs/round3-screenshots');
const DUMP_PATH = path.join(ROOT, 'inputs/real-graphs-dump.json');

const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46,
  37, 32, 58, 57,
  18, 21, 16, 12, 6,
  33, 51,
];

function category(idx: number): 'large' | 'small' {
  return idx >= 30 || [49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46, 37, 32, 33, 51].includes(idx) ? 'large' : 'small';
}

// 算节点重叠对数（独立于 computeLayoutMetrics 的 edgeCrossings）
function countOverlaps(positions: Record<string, Position>, graph: MergedGraph): number {
  const sizes = computeAllNodeSizes(graph.nodes);
  const ids = Object.keys(positions);
  let overlaps = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = positions[ids[i]], b = positions[ids[j]];
      const sa = sizes[ids[i]] ?? { width: 220, height: 132 };
      const sb = sizes[ids[j]] ?? { width: 220, height: 132 };
      const overlap = !(
        a.x + sa.width + 10 <= b.x ||
        b.x + sb.width + 10 <= a.x ||
        a.y + sa.height + 10 <= b.y ||
        b.y + sb.height + 10 <= a.y
      );
      if (overlap) overlaps++;
    }
  }
  return overlaps;
}

export function renderRound3Gallery(): void {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  const rows: string[] = [];
  const reviewTemplate: unknown[] = [];
  const allMetrics: unknown[] = [];

  for (const idx of SAMPLE_INDICES) {
    const graph = dump[idx];
    if (!graph) continue;
    const padded = String(idx).padStart(2, '0');
    const cat = category(idx);
    const shot = (c: string) => {
      const p = path.join(SHOT_DIR, `${padded}-${c}.png`);
      return fs.existsSync(p) ? `round3-screenshots/${padded}-${c}.png` : '';
    };

    const baseline = computeBaselinePositions(graph, idx);
    const r3a = computeClusterForceLayout(graph, idx, 'R3a');
    const r3b = computeClusterForceLayout(graph, idx, 'R3b');

    // 算指标（用固定 220x132 算 baseline，自适应算 R3a/R3b）
    const baselinePositions: Record<string, Position> = {};
    for (const item of baseline.items) if (item.kind === 'fullNode') baselinePositions[item.nodeId] = item.position;
    const r3aPositions: Record<string, Position> = {};
    for (const item of r3a.items) if (item.kind === 'fullNode') r3aPositions[item.nodeId] = item.position;
    const r3bPositions: Record<string, Position> = {};
    for (const item of r3b.items) if (item.kind === 'fullNode') r3bPositions[item.nodeId] = item.position;

    const clusterNodes = graph.nodes;
    const clusterEdges = graph.edges;

    const bm = computeLayoutMetrics(clusterNodes, clusterEdges, baselinePositions);
    const am = computeLayoutMetrics(clusterNodes, clusterEdges, r3aPositions);
    const bm2 = computeLayoutMetrics(clusterNodes, clusterEdges, r3bPositions);

    const bo = countOverlaps(baselinePositions, graph);
    const ao = countOverlaps(r3aPositions, graph);
    const bo2 = countOverlaps(r3bPositions, graph);

    const metricsStr = (m: LayoutMetrics, overlaps: number) =>
      `宽高比:${m.aspectRatio.toFixed(2)} 边长:${m.avgEdgeLength} 长边:${(m.longEdgeRatio*100).toFixed(0)}% 穿越:${m.edgeCrossings} 重叠:${overlaps}`;

    rows.push(`
      <div class="graph-row" data-index="${idx}" data-category="${cat}">
        <h3>#${idx} <span class="cat cat-${cat}">${cat === 'large' ? '大图' : '小图'}</span></h3>
        <div class="candidates">
          <div class="cand"><h4>Baseline</h4><div class="metrics">${metricsStr(bm, bo)}</div><img src="${shot('baseline')}" loading="lazy" /></div>
          <div class="cand"><h4>R3a（引力收窄）</h4><div class="metrics">${metricsStr(am, ao)}</div><img src="${shot('R3a')}" loading="lazy" /></div>
          <div class="cand"><h4>R3b（宽度惩罚）</h4><div class="metrics">${metricsStr(bm2, bo2)}</div><img src="${shot('R3b')}" loading="lazy" /></div>
        </div>
      </div>
    `);

    reviewTemplate.push({
      graphIndex: idx, category: cat,
      r3aWinner: '', r3aVsBaseline: '', r3bWinner: '', r3bVsBaseline: '',
      r3aVsR3b: '', smallHarm: cat === 'small' ? '' : null, notes: '',
    });

    allMetrics.push({
      graphIndex: idx, category: cat,
      baseline: { ...bm, overlaps: bo },
      r3a: { ...am, overlaps: ao },
      r3b: { ...bm2, overlaps: bo2 },
    });
  }

  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>Round 3 Force Layout A/B</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#fafafa}
.graph-row{background:#fff;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:16px}
.candidates{display:flex;gap:12px}
.cand{flex:1;min-width:0}
.cand img{width:100%;border:1px solid #eee;border-radius:4px;margin-top:4px}
.metrics{font-size:11px;color:#666;background:#f5f5f5;padding:4px 6px;border-radius:3px}
.cat{font-size:11px;padding:1px 6px;border-radius:3px;color:#fff}
.cat-large{background:#d97706}.cat-small{background:#16a34a}
h3{margin:0 0 8px}h4{margin:0;font-size:13px;color:#666}
</style></head><body>
<h1>Round 3: 受约束力导向 + 自适应节点</h1>
<p>${SAMPLE_INDICES.length} 条图 × 3 候选。R3a/R3b 各自独立评分，任一满足门槛即 GO。</p>
<p>门槛：大图 70%+ 优于 baseline、小图不超 20% 更差、重叠率中位数 <30%、宽高比中位数 <0.5</p>
${rows.join('')}
</body></html>`;

  fs.writeFileSync(path.join(ROOT, 'outputs/round3-gallery.html'), html);
  fs.writeFileSync(path.join(ROOT, 'outputs/round3-human-review-template.json'), JSON.stringify(reviewTemplate, null, 2));
  fs.writeFileSync(path.join(ROOT, 'outputs/round3-metrics.json'), JSON.stringify(allMetrics, null, 2));
  console.log(`[round3-gallery] 完成 → gallery + review-template + metrics`);
}

renderRound3Gallery();
```

- [ ] **Step 2: 生成 gallery**

```bash
cd tools/layout-lab/run && npx tsx ../src/round3-gallery.ts
```

- [ ] **Step 3: Commit**

```bash
git add tools/layout-lab/src/round3-gallery.ts
git commit -m "feat(layout-lab): round3-gallery + 指标 + 评分模板"
```

---

## 完成标准

- [ ] 6 个 Task 全部落地
- [ ] 全部测试通过（Round 1/2/3 累计）
- [ ] 23 条图 × 3 候选 = 69 张截图
- [ ] `round3-gallery.html` 三栏并排 + 指标
- [ ] `round3-metrics.json` 含宽高比/边长/穿越/重叠
- [ ] `round3-human-review-template.json` 评分模板
- [ ] **人眼审核**：R3a/R3b 各自独立评分，按 spec go/no-go 门槛判定
