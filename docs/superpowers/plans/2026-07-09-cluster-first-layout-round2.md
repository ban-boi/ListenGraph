# Cluster-First Layout 验证（第二轮）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 验证连通分量分区 + minor 打包是否比当前 baseline 布局更可读，产出 A/B/C 截图对比 gallery 供人眼 go/no-go。

**Architecture:** 在 `tools/layout-lab/` 上扩展（复用第一轮管线）。三个候选（baseline/A/B）各算坐标 → 同一套离线 HTML renderer 渲染 → Playwright 截图 → 三栏并排 gallery。baseline 直接 import 已 export 的 `buildStableReactFlowDebugGraph`（已验证 tsx 能解析依赖链）。cluster 布局用 UnionFind 连通分量分区，major 簇内复用 baseline 坐标算法，minor 簇打包为 Loose Notes。**不碰产品代码。**

**Tech Stack:** TypeScript + tsx、Vitest（单测）、Playwright（截图）、opencode-serve + DeepSeek V4 Flash（LLM 草评）。

**Spec:** `docs/superpowers/specs/2026-07-09-cluster-first-layout-round2-design.md`

---

## 任务依赖与顺序

```
Task 1: RenderModel 类型定义
  └─ Task 2: baseline-layout（封装 import + 等价验证）
        └─ Task 3: cluster-partition（UnionFind + major/minor）
              └─ Task 4: cluster-layout A（分区 + loose-notes + row packing）
                    └─ Task 5: cluster-overview B（A + summary 缩略）
Task 6: html-renderer（坐标/RenderModel → HTML，三候选共用）
  └─ Task 7: render-round2（主流程：算三候选坐标 → HTML → Playwright 截图）
        └─ Task 8: round2-gallery + LLM 草评
```

Task 1-5 可顺序做（类型 → baseline → 分区 → A → B）。Task 6 依赖 Task 1 的 RenderModel 类型。Task 7 依赖全部。Task 8 依赖 Task 7。

---

## Task 1: RenderModel 类型定义

**Files:**
- Create: `tools/layout-lab/src/round2-types.ts`

- [ ] **Step 1: 创建类型文件**

`tools/layout-lab/src/round2-types.ts`：
```typescript
import type { MergedGraph, EdgeType } from '@listen-graphic/schema';

// 坐标（与产品 StableNodePosition 一致）
export type Position = { x: number; y: number };

// 三种渲染项类型（spec 2.2 RenderModel）
export type RenderItem =
  | { kind: 'fullNode'; nodeId: string; position: Position }
  | { kind: 'looseNoteItem'; nodeId: string; position: Position }
  | {
      kind: 'clusterSummary';
      clusterId: string;
      position: Position;
      nodeCount: number;
      edgeCount: number;
    };

// 边（只含 fullNode 之间的边）
export type RenderEdge = {
  source: string;
  target: string;
  type: EdgeType;
};

// 簇元信息
export type ClusterInfo = {
  id: string;
  type: 'major' | 'minor';
  nodeIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
};

// 三候选共用的渲染模型
export type RenderModel = {
  items: RenderItem[];
  edges: RenderEdge[];
  clusters: ClusterInfo[];
  meta: {
    candidate: 'baseline' | 'A' | 'B';
    graphIndex: number;
    nodeCount: number;
    edgeCount: number;
    clusterCount: number;
    majorCount: number;
    minorCount: number;
  };
};

// 簇分区结果（Task 3 产出，Task 4/5 消费）
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

// 布局常量（与产品 graph-utils.ts 一致）
export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 132;
export const CLUSTER_GAP = 60; // cluster 间 packing gap
export const LOOSE_NOTE_ITEM_HEIGHT = 32;
export const LOOSE_NOTE_ITEM_WIDTH = 200;
```

- [ ] **Step 2: 验证类型能被 tsx 解析**

Run: `cd tools/layout-lab/run && npx tsx -e "import('../src/round2-types.ts').then(m => console.log(Object.keys(m)))"`
Expected: 打印类型/常量名，无错误

- [ ] **Step 3: Commit**

```bash
git add tools/layout-lab/src/round2-types.ts
git commit -m "feat(layout-lab): round2 RenderModel 类型定义"
```

---

## Task 2: baseline-layout 封装 + 等价验证

> baseline 直接 import 已 export 的 `buildStableReactFlowDebugGraph`（已验证 tsx 能解析依赖链）。不需要复制代码。

**Files:**
- Create: `tools/layout-lab/src/baseline-layout.ts`
- Create: `tools/layout-lab/src/baseline-layout.test.ts`

- [ ] **Step 1: 写等价验证测试**

`tools/layout-lab/src/baseline-layout.test.ts`：
```typescript
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeBaselinePositions } from './baseline-layout';
import { buildStableReactFlowDebugGraph } from '../../../apps/extension/src/sidepanel/graph-utils.ts';
import { toHierarchyRendererGraph } from '../../../packages/graph-renderers/src/hierarchy.ts';
import type { MergedGraph } from '@listen-graphic/schema';
import type { RenderModel } from './round2-types';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');

function loadGraph(index: number): MergedGraph {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  return dump[index];
}

describe('computeBaselinePositions 等价验证', () => {
  // 抽 3 张图：大图 #49、中图 #32、小图 #18
  const testIndices = [49, 32, 18];

  for (const idx of testIndices) {
    it(`graph #${idx} 的 positions 与 buildStableReactFlowDebugGraph 一致`, () => {
      const graph = loadGraph(idx);
      const rendererGraph = toHierarchyRendererGraph(graph);

      // 直接调产品函数
      const productResult = buildStableReactFlowDebugGraph({
        rendererGraph,
        view: 'hierarchy',
        currentTimeMs: 0,
        selectedNodeId: null,
        previousLayoutState: { positions: {} },
      });
      const productPositions = productResult.layoutState.positions;

      // 调 lab 封装
      const labModel = computeBaselinePositions(graph, idx);

      // 逐节点对比 x/y
      const nodeIds = Object.keys(productPositions);
      expect(nodeIds.length).toBeGreaterThan(0);
      for (const nodeId of nodeIds) {
        const pp = productPositions[nodeId];
        const labItem = labModel.items.find((i) => 'nodeId' in i && i.nodeId === nodeId);
        expect(labItem).toBeDefined();
        if (labItem && 'position' in labItem) {
          expect(labItem.position.x).toBe(pp.x);
          expect(labItem.position.y).toBe(pp.y);
        }
      }
    });
  }
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd tools/layout-lab/run && npx vitest run ../src/baseline-layout.test.ts`
Expected: FAIL — `computeBaselinePositions is not a function`

- [ ] **Step 3: 实现 baseline-layout.ts**

`tools/layout-lab/src/baseline-layout.ts`：
```typescript
import type { MergedGraph } from '@listen-graphic/schema';
import { buildStableReactFlowDebugGraph } from '../../../apps/extension/src/sidepanel/graph-utils.ts';
import { toHierarchyRendererGraph } from '../../../packages/graph-renderers/src/hierarchy.ts';
import type { RenderModel, RenderItem, RenderEdge } from './round2-types';

// baseline 封装：直接调用产品函数算坐标，转成 RenderModel
export function computeBaselinePositions(
  graph: MergedGraph,
  graphIndex: number,
): RenderModel {
  const rendererGraph = toHierarchyRendererGraph(graph);

  const result = buildStableReactFlowDebugGraph({
    rendererGraph,
    view: 'hierarchy',
    currentTimeMs: 0,
    selectedNodeId: null,
    previousLayoutState: { positions: {} },
  });

  const positions = result.layoutState.positions;

  // 转为 RenderItem（baseline 全是 fullNode）
  const items: RenderItem[] = rendererGraph.nodes
    .filter((n) => positions[n.id])
    .map((n) => ({
      kind: 'fullNode' as const,
      nodeId: n.id,
      position: positions[n.id],
    }));

  // 边（只含两端都有 position 的）
  const validNodeIds = new Set(
    items.filter((i) => i.kind === 'fullNode').map((i) => i.nodeId),
  );
  const edges: RenderEdge[] = rendererGraph.edges
    .filter((e) => validNodeIds.has(e.source) && validNodeIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, type: e.relation }));

  return {
    items,
    edges,
    clusters: [], // baseline 无分簇
    meta: {
      candidate: 'baseline',
      graphIndex,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      clusterCount: 0,
      majorCount: 0,
      minorCount: 0,
    },
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd tools/layout-lab/run && npx vitest run ../src/baseline-layout.test.ts`
Expected: PASS — 3 个等价验证测试通过（graph #49/#32/#18 的 positions 逐节点一致）

> **若失败**：说明 `buildStableReactFlowDebugGraph` 的参数或返回结构与预期不符。检查 `previousLayoutState: { positions: {} }` 是否正确（空初始状态），检查 `layoutState.positions` 的 key 是否是 nodeId。

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/src/baseline-layout.ts tools/layout-lab/src/baseline-layout.test.ts
git commit -m "feat(layout-lab): baseline-layout 封装 + 等价验证（3 图 positions 一致）"
```

---

## Task 3: cluster-partition（UnionFind + major/minor）

**Files:**
- Create: `tools/layout-lab/src/cluster-partition.ts`
- Create: `tools/layout-lab/src/cluster-partition.test.ts`

- [ ] **Step 1: 写失败测试**

`tools/layout-lab/src/cluster-partition.test.ts`：
```typescript
import { describe, expect, it } from 'vitest';
import { partitionClusters } from './cluster-partition';
import type { MergedGraph } from '@listen-graphic/schema';

function makeGraph(nodes: string[], edges: Array<[string, string]>): MergedGraph {
  return {
    sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
    nodes: nodes.map((id) => ({ id, type: 'claim' as const, text: id, timestampMs: 0, status: 'confirmed' as const })),
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t, type: 'supports' as const })),
  };
}

describe('partitionClusters', () => {
  it('两个连通子图 → 2 个分量', () => {
    const g = makeGraph(['a', 'b', 'c', 'd'], [['a', 'b'], ['c', 'd']]);
    const p = partitionClusters(g);
    expect(p.clusters.length).toBe(2);
  });

  it('self-loop 边不参与分量，节点保留为单节点 minor', () => {
    const g: MergedGraph = {
      sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
      nodes: [{ id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' }],
      edges: [{ id: 'e1', source: 'a', target: 'a', type: 'supports' }],
    };
    const p = partitionClusters(g);
    expect(p.clusters.length).toBe(1);
    expect(p.clusters[0].nodeIds).toEqual(['a']);
    expect(p.selfLoopNodes).toContain('a');
  });

  it('dangling edge 不参与分量，进异常统计', () => {
    const g: MergedGraph = {
      sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
      nodes: [{ id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' }],
      edges: [{ id: 'e1', source: 'a', target: 'ghost', type: 'supports' }],
    };
    const p = partitionClusters(g);
    expect(p.clusters.length).toBe(1);
    expect(p.clusters[0].nodeIds).toEqual(['a']);
    expect(p.danglingEdges.length).toBe(1);
  });

  it('major: nodeCount>=3', () => {
    const g = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const p = partitionClusters(g);
    expect(p.clusters[0].type).toBe('major');
  });

  it('minor: 1-2 节点少边', () => {
    const g = makeGraph(['a', 'b'], [['a', 'b']]);
    const p = partitionClusters(g);
    expect(p.clusters[0].type).toBe('minor');
  });

  it('保护规则：全图无 major 时最大 minor 升级为 major', () => {
    // 两个 2 节点分量，都不满足 major
    const g = makeGraph(['a', 'b', 'c', 'd'], [['a', 'b'], ['c', 'd']]);
    const p = partitionClusters(g);
    const majors = p.clusters.filter((c) => c.type === 'major');
    expect(majors.length).toBe(1); // 最大的 minor 被升级
  });

  it('孤立节点（无边）各自为单节点 minor', () => {
    const g = makeGraph(['a', 'b', 'c'], []);
    const p = partitionClusters(g);
    expect(p.clusters.length).toBe(3);
    expect(p.clusters.every((c) => c.type === 'minor')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd tools/layout-lab/run && npx vitest run ../src/cluster-partition.test.ts`
Expected: FAIL — `partitionClusters is not a function`

- [ ] **Step 3: 实现 cluster-partition.ts**

`tools/layout-lab/src/cluster-partition.ts`：
```typescript
import type { MergedGraph, GraphEdge, EdgeType } from '@listen-graphic/schema';
import type { ClusterPartition } from './round2-types';

// 并查集（复用第一轮 metrics.ts 的实现模式）
class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(id: string) {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra)!;
    const rankB = this.rank.get(rb)!;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }
}

export function partitionClusters(graph: MergedGraph): ClusterPartition {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  const uf = new UnionFind();
  for (const n of nodes) uf.add(n.id);

  const danglingEdges: Array<{ source: string; target: string; type: EdgeType }> = [];
  const selfLoopNodes = new Set<string>();

  for (const e of edges) {
    if (e.source === e.target) {
      // self-loop：边不参与分量，节点标记
      selfLoopNodes.add(e.source);
      continue;
    }
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      // dangling edge：不参与分量
      danglingEdges.push({ source: e.source, target: e.target, type: e.type });
      continue;
    }
    uf.union(e.source, e.target);
  }

  // 按 root 分组节点
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const root = uf.find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(n.id);
  }

  // 分 major / minor
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  let clusters = Array.from(groups.entries()).map(([root, nodeIds], i) => {
    const clusterEdges = edges.filter(
      (e) =>
        e.source !== e.target &&
        nodeIds.includes(e.source) &&
        nodeIds.includes(e.target),
    );
    const edgeCount = clusterEdges.length;
    // maxDegree
    const deg = new Map<string, number>();
    for (const e of clusterEdges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    const maxDegree = Math.max(0, ...deg.values());
    const isMajor = nodeIds.length >= 3 || edgeCount >= 2 || maxDegree >= 2;
    return {
      id: `cluster_${i}`,
      nodeIds,
      edges: clusterEdges.map((e) => ({ source: e.source, target: e.target, type: e.type })),
      type: (isMajor ? 'major' : 'minor') as 'major' | 'minor',
    };
  });

  // 保护规则：全图无 major 时，最大的 minor 升级为 major
  if (clusters.length > 0 && !clusters.some((c) => c.type === 'major')) {
    const largest = clusters.reduce((a, b) => (a.nodeIds.length >= b.nodeIds.length ? a : b));
    largest.type = 'major';
  }

  // 排序：major 优先，然后按 nodeCount 降序，最后按最早 timestamp
  clusters.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'major' ? -1 : 1;
    if (a.nodeIds.length !== b.nodeIds.length) return b.nodeIds.length - a.nodeIds.length;
    if (a.edges.length !== b.edges.length) return b.edges.length - a.edges.length;
    const aMin = Math.min(...a.nodeIds.map((id) => nodeById.get(id)?.timestampMs ?? 0));
    const bMin = Math.min(...b.nodeIds.map((id) => nodeById.get(id)?.timestampMs ?? 0));
    return aMin - bMin;
  });

  return { clusters, danglingEdges, selfLoopNodes: Array.from(selfLoopNodes) };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd tools/layout-lab/run && npx vitest run ../src/cluster-partition.test.ts`
Expected: PASS — 7 个测试全部通过

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/src/cluster-partition.ts tools/layout-lab/src/cluster-partition.test.ts
git commit -m "feat(layout-lab): cluster-partition（UnionFind + major/minor + 保护规则）"
```

---

## Task 4: cluster-layout A（分区 + loose-notes + row packing）

**Files:**
- Create: `tools/layout-lab/src/cluster-layout.ts`
- Create: `tools/layout-lab/src/cluster-layout.test.ts`

- [ ] **Step 1: 写失败测试**

`tools/layout-lab/src/cluster-layout.test.ts`：
```typescript
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeClusterLayoutA } from './cluster-layout';
import type { MergedGraph } from '@listen-graphic/schema';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');

function loadGraph(index: number): MergedGraph {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  return dump[index];
}

describe('computeClusterLayoutA', () => {
  it('大图 #49：major cluster 内节点有坐标，minor 节点为 looseNoteItem', () => {
    const graph = loadGraph(49);
    const model = computeClusterLayoutA(graph, 49);
    const fullNodes = model.items.filter((i) => i.kind === 'fullNode');
    const looseNotes = model.items.filter((i) => i.kind === 'looseNoteItem');
    expect(fullNodes.length + looseNotes.length).toBe(graph.nodes.length);
    expect(model.meta.candidate).toBe('A');
    expect(model.meta.clusterCount).toBeGreaterThan(0);
  });

  it('小图 #18：不伤害——所有节点有坐标', () => {
    const graph = loadGraph(18);
    const model = computeClusterLayoutA(graph, 18);
    const positioned = model.items.filter((i) => 'position' in i);
    expect(positioned.length).toBe(graph.nodes.length);
  });

  it('纯碎片图 #6：12 孤立节点进 loose-notes', () => {
    const graph = loadGraph(6);
    const model = computeClusterLayoutA(graph, 6);
    const looseNotes = model.items.filter((i) => i.kind === 'looseNoteItem');
    expect(looseNotes.length).toBe(12);
  });

  it('cluster bounds 不重叠', () => {
    const graph = loadGraph(41);
    const model = computeClusterLayoutA(graph, 41);
    for (let i = 0; i < model.clusters.length; i++) {
      for (let j = i + 1; j < model.clusters.length; j++) {
        const a = model.clusters[i].bounds;
        const b = model.clusters[j].bounds;
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

- [ ] **Step 2: 运行测试验证失败**

Run: `cd tools/layout-lab/run && npx vitest run ../src/cluster-layout.test.ts`
Expected: FAIL — `computeClusterLayoutA is not a function`

- [ ] **Step 3: 实现 cluster-layout.ts**

`tools/layout-lab/src/cluster-layout.ts`：
```typescript
import type { MergedGraph, NodeType, GraphEdge, EdgeType } from '@listen-graphic/schema';
import { buildStableReactFlowDebugGraph } from '../../../apps/extension/src/sidepanel/graph-utils.ts';
import { toHierarchyRendererGraph } from '../../../packages/graph-renderers/src/hierarchy.ts';
import { partitionClusters } from './cluster-partition';
import type { RenderModel, RenderItem, RenderEdge, ClusterInfo, Position } from './round2-types';
import { CARD_WIDTH, CARD_HEIGHT, CLUSTER_GAP, LOOSE_NOTE_ITEM_HEIGHT, LOOSE_NOTE_ITEM_WIDTH } from './round2-types';

// 对单个 cluster 的子图跑 baseline 坐标算法
function layoutClusterInternal(
  graph: MergedGraph,
  clusterNodeIds: string[],
  clusterEdges: Array<{ source: string; target: string; type: EdgeType }>,
): Record<string, Position> {
  // 构造只含本 cluster 节点的子 MergedGraph
  const nodeSet = new Set(clusterNodeIds);
  const subNodes = graph.nodes.filter((n) => nodeSet.has(n.id));
  const subEdges = graph.edges.filter(
    (e) => nodeSet.has(e.source) && nodeSet.has(e.target) && e.source !== e.target,
  );
  const subGraph: MergedGraph = {
    ...graph,
    nodes: subNodes,
    edges: subEdges,
  };

  const rendererGraph = toHierarchyRendererGraph(subGraph);
  const result = buildStableReactFlowDebugGraph({
    rendererGraph,
    view: 'hierarchy',
    currentTimeMs: 0,
    selectedNodeId: null,
    previousLayoutState: { positions: {} },
  });

  return result.layoutState.positions;
}

// 算一个 cluster 的 local bounds
function computeBounds(positions: Record<string, Position>, isLoose: boolean): {
  x: number; y: number; width: number; height: number;
} {
  const pos = Object.values(positions);
  if (pos.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = isLoose ? LOOSE_NOTE_ITEM_WIDTH : CARD_WIDTH;
  const h = isLoose ? LOOSE_NOTE_ITEM_HEIGHT : CARD_HEIGHT;
  return {
    x: minX,
    y: minY,
    width: maxX + w - minX,
    height: maxY + h - minY,
  };
}

export function computeClusterLayoutA(
  graph: MergedGraph,
  graphIndex: number,
): RenderModel {
  const partition = partitionClusters(graph);
  const items: RenderItem[] = [];
  const edges: RenderEdge[] = [];
  const clusters: ClusterInfo[] = [];

  let currentX = 0;
  let currentY = 0;
  let rowMaxY = 0;

  for (const cluster of partition.clusters) {
    let clusterPositions: Record<string, Position> = {};
    let clusterItems: RenderItem[] = [];

    if (cluster.type === 'major') {
      // major cluster：内部跑 baseline 坐标
      clusterPositions = layoutClusterInternal(graph, cluster.nodeIds, cluster.edges);
      clusterItems = cluster.nodeIds
        .filter((id) => clusterPositions[id])
        .map((id) => ({
          kind: 'fullNode' as const,
          nodeId: id,
          position: {
            x: clusterPositions[id].x + currentX,
            y: clusterPositions[id].y + currentY,
          },
        }));

      // 收集簇内边
      for (const e of cluster.edges) {
        if (clusterPositions[e.source] && clusterPositions[e.target]) {
          edges.push({
            source: e.source,
            target: e.target,
            type: e.type,
          });
        }
      }
    } else {
      // minor cluster → loose notes：按时间排序打包成单列
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
      const sorted = [...cluster.nodeIds].sort((a, b) => {
        const ta = nodeById.get(a)?.timestampMs ?? 0;
        const tb = nodeById.get(b)?.timestampMs ?? 0;
        return ta - tb;
      });
      sorted.forEach((id, i) => {
        clusterPositions[id] = {
          x: currentX,
          y: currentY + i * LOOSE_NOTE_ITEM_HEIGHT,
        };
        clusterItems.push({
          kind: 'looseNoteItem' as const,
          nodeId: id,
          position: clusterPositions[id],
        });
      });
    }

    items.push(...clusterItems);

    const bounds = computeBounds(clusterPositions, cluster.type === 'minor');
    clusters.push({
      id: cluster.id,
      type: cluster.type,
      nodeIds: cluster.nodeIds,
      bounds: {
        x: currentX,
        y: currentY,
        width: bounds.width,
        height: bounds.height,
      },
    });

    // row packing：同行往右排，超宽则换行
    const MAX_ROW_WIDTH = 1200;
    if (currentX + bounds.width + CLUSTER_GAP > MAX_ROW_WIDTH) {
      currentX = 0;
      currentY = rowMaxY + CLUSTER_GAP;
      rowMaxY = 0;
    } else {
      currentX += bounds.width + CLUSTER_GAP;
    }
    rowMaxY = Math.max(rowMaxY, currentY + bounds.height);
  }

  const majorCount = partition.clusters.filter((c) => c.type === 'major').length;
  const minorCount = partition.clusters.filter((c) => c.type === 'minor').length;

  return {
    items,
    edges,
    clusters,
    meta: {
      candidate: 'A',
      graphIndex,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      clusterCount: partition.clusters.length,
      majorCount,
      minorCount,
    },
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd tools/layout-lab/run && npx vitest run ../src/cluster-layout.test.ts`
Expected: PASS — 4 个测试通过

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/src/cluster-layout.ts tools/layout-lab/src/cluster-layout.test.ts
git commit -m "feat(layout-lab): cluster-layout A（分区 + loose-notes + row packing）"
```

---

## Task 5: cluster-overview B（A + summary 缩略）

**Files:**
- Create: `tools/layout-lab/src/cluster-overview.ts`
- Create: `tools/layout-lab/src/cluster-overview.test.ts`

- [ ] **Step 1: 写失败测试**

`tools/layout-lab/src/cluster-overview.test.ts`：
```typescript
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeClusterLayoutB } from './cluster-overview';
import type { MergedGraph } from '@listen-graphic/schema';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');

function loadGraph(index: number): MergedGraph {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  return dump[index];
}

describe('computeClusterLayoutB', () => {
  it('大图 #49：major>4 时第 5+ 变成 clusterSummary', () => {
    const graph = loadGraph(49);
    const model = computeClusterLayoutB(graph, 49);
    const summaries = model.items.filter((i) => i.kind === 'clusterSummary');
    const fullNodes = model.items.filter((i) => i.kind === 'fullNode');
    expect(model.meta.candidate).toBe('B');
    expect(fullNodes.length).toBeGreaterThan(0);
    // #49 有 30 分量，major 应该 >4，所以有 summary
    expect(summaries.length).toBeGreaterThan(0);
  });

  it('小图 #18：major<=4 不产生 summary', () => {
    const graph = loadGraph(18);
    const model = computeClusterLayoutB(graph, 18);
    const summaries = model.items.filter((i) => i.kind === 'clusterSummary');
    expect(summaries.length).toBe(0);
  });

  it('summary 块有 nodeCount 和 edgeCount', () => {
    const graph = loadGraph(49);
    const model = computeClusterLayoutB(graph, 49);
    const summaries = model.items.filter((i) => i.kind === 'clusterSummary');
    for (const s of summaries) {
      expect(s.kind).toBe('clusterSummary');
      if (s.kind === 'clusterSummary') {
        expect(s.nodeCount).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd tools/layout-lab/run && npx vitest run ../src/cluster-overview.test.ts`
Expected: FAIL — `computeClusterLayoutB is not a function`

- [ ] **Step 3: 实现 cluster-overview.ts**

`tools/layout-lab/src/cluster-overview.ts`：
```typescript
import type { MergedGraph, EdgeType } from '@listen-graphic/schema';
import { partitionClusters } from './cluster-partition';
import { computeClusterLayoutA } from './cluster-layout';
import type { RenderModel, RenderItem, RenderEdge, ClusterInfo, Position } from './round2-types';
import { CARD_WIDTH, CARD_HEIGHT, CLUSTER_GAP, LOOSE_NOTE_ITEM_HEIGHT, LOOSE_NOTE_ITEM_WIDTH } from './round2-types';

const TOP_MAJOR_EXPAND = 4;

export function computeClusterLayoutB(
  graph: MergedGraph,
  graphIndex: number,
): RenderModel {
  const partition = partitionClusters(graph);
  const majorClusters = partition.clusters.filter((c) => c.type === 'major');
  const minorClusters = partition.clusters.filter((c) => c.type === 'minor');

  // 如果 major <= TOP_MAJOR_EXPAND，B 退化为 A（无 summary）
  if (majorClusters.length <= TOP_MAJOR_EXPAND) {
    return computeClusterLayoutA(graph, graphIndex);
  }

  // 先算 A 的完整布局，拿到前 4 个 major 的坐标
  const layoutA = computeClusterLayoutA(graph, graphIndex);

  // 重建：前 4 个 major 用 A 的 fullNode，第 5+ major 变 summary，minor 全 loose-notes
  const items: RenderItem[] = [];
  const edges: RenderEdge[] = [];
  const clusters: ClusterInfo[] = [];

  let majorRank = 0;
  let currentX = 0;
  let currentY = 0;
  let rowMaxY = 0;
  const MAX_ROW_WIDTH = 1200;

  for (const cluster of partition.clusters) {
    if (cluster.type === 'major') {
      if (majorRank < TOP_MAJOR_EXPAND) {
        // 展开：从 layoutA 找对应的 fullNode
        const clusterFullNodes = layoutA.items.filter(
          (i) => i.kind === 'fullNode' && cluster.nodeIds.includes(i.nodeId),
        );
        items.push(...clusterFullNodes);

        // 簇内边
        for (const e of cluster.edges) {
          if (cluster.nodeIds.includes(e.source) && cluster.nodeIds.includes(e.target)) {
            edges.push({ source: e.source, target: e.target, type: e.type });
          }
        }

        const bounds = clusterFullNodes.length > 0
          ? computeFullNodeBounds(clusterFullNodes.map((i) => (i.kind === 'fullNode' ? i.position : { x: 0, y: 0 })))
          : { width: CARD_WIDTH, height: CARD_HEIGHT };
        clusters.push({
          id: cluster.id, type: 'major', nodeIds: cluster.nodeIds,
          bounds: { x: currentX, y: currentY, width: bounds.width, height: bounds.height },
        });

        currentX += bounds.width + CLUSTER_GAP;
      } else {
        // 第 5+ major：summary 块
        const summaryWidth = 200;
        const summaryHeight = 80;
        items.push({
          kind: 'clusterSummary',
          clusterId: cluster.id,
          position: { x: currentX, y: currentY },
          nodeCount: cluster.nodeIds.length,
          edgeCount: cluster.edges.length,
        });
        clusters.push({
          id: cluster.id, type: 'major', nodeIds: cluster.nodeIds,
          bounds: { x: currentX, y: currentY, width: summaryWidth, height: summaryHeight },
        });
        currentX += summaryWidth + CLUSTER_GAP;
      }
      majorRank++;
    } else {
      // minor → loose notes
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
      const sorted = [...cluster.nodeIds].sort((a, b) => {
        return (nodeById.get(a)?.timestampMs ?? 0) - (nodeById.get(b)?.timestampMs ?? 0);
      });
      sorted.forEach((id, i) => {
        items.push({
          kind: 'looseNoteItem',
          nodeId: id,
          position: { x: currentX, y: currentY + i * LOOSE_NOTE_ITEM_HEIGHT },
        });
      });
      const h = sorted.length * LOOSE_NOTE_ITEM_HEIGHT;
      clusters.push({
        id: cluster.id, type: 'minor', nodeIds: cluster.nodeIds,
        bounds: { x: currentX, y: currentY, width: LOOSE_NOTE_ITEM_WIDTH, height: h },
      });
      currentX += LOOSE_NOTE_ITEM_WIDTH + CLUSTER_GAP;
    }

    // row packing
    const lastCluster = clusters[clusters.length - 1];
    if (currentX > MAX_ROW_WIDTH) {
      currentX = 0;
      currentY = rowMaxY + CLUSTER_GAP;
      rowMaxY = 0;
    }
    rowMaxY = Math.max(rowMaxY, currentY + (lastCluster?.bounds.height ?? 0));
  }

  return {
    items,
    edges,
    clusters,
    meta: {
      candidate: 'B',
      graphIndex,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      clusterCount: partition.clusters.length,
      majorCount: majorClusters.length,
      minorCount: minorClusters.length,
    },
  };
}

function computeFullNodeBounds(positions: Position[]) {
  if (positions.length === 0) return { width: CARD_WIDTH, height: CARD_HEIGHT };
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  return {
    width: Math.max(...xs) + CARD_WIDTH - Math.min(...xs),
    height: Math.max(...ys) + CARD_HEIGHT - Math.min(...ys),
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd tools/layout-lab/run && npx vitest run ../src/cluster-overview.test.ts`
Expected: PASS — 3 个测试通过

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/src/cluster-overview.ts tools/layout-lab/src/cluster-overview.test.ts
git commit -m "feat(layout-lab): cluster-overview B（A + top4展开 + 第5+ summary）"
```

---

## Task 6: html-renderer（三候选共用）

**Files:**
- Create: `tools/layout-lab/src/html-renderer.ts`

- [ ] **Step 1: 实现 html-renderer.ts**

`tools/layout-lab/src/html-renderer.ts`：
```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import type { RenderModel, RenderItem } from './round2-types';
import { CARD_WIDTH, CARD_HEIGHT } from './round2-types';

const NODE_COLORS: Record<string, string> = {
  claim: '#3b82f6',
  reason: '#10b981',
  example: '#8b5cf6',
  question: '#f59e0b',
  conclusion: '#6b7280',
};

const EDGE_COLORS: Record<string, string> = {
  supports: '#10b981',
  opposes: '#ef4444',
  causes: '#f59e0b',
  follows: '#6b7280',
  example_of: '#8b5cf6',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function renderModelToHtml(
  model: RenderModel,
  graph: MergedGraph,
  outputPath: string,
): void {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // 计算总画布尺寸
  let maxX = 0;
  let maxY = 0;
  for (const item of model.items) {
    if ('position' in item) {
      maxX = Math.max(maxX, item.position.x + CARD_WIDTH);
      maxY = Math.max(maxY, item.position.y + CARD_HEIGHT);
    }
  }
  for (const c of model.clusters) {
    maxX = Math.max(maxX, c.bounds.x + c.bounds.width);
    maxY = Math.max(maxY, c.bounds.y + c.bounds.height);
  }

  // cluster 背景层
  const clusterDivs = model.clusters
    .map((c) => {
      const bg = c.type === 'major' ? 'rgba(59,130,246,0.06)' : 'rgba(107,114,128,0.06)';
      const border = c.type === 'major' ? 'rgba(59,130,246,0.2)' : 'rgba(107,114,128,0.2)';
      return `<div style="position:absolute;left:${c.bounds.x}px;top:${c.bounds.y}px;width:${c.bounds.width}px;height:${c.bounds.height}px;background:${bg};border:1px dashed ${border};border-radius:8px;"></div>`;
    })
    .join('\n');

  // 节点/loose-note/summary 层
  const itemDivs = model.items
    .map((item) => {
      if (item.kind === 'fullNode') {
        const node = nodeById.get(item.nodeId);
        if (!node) return '';
        const color = NODE_COLORS[node.type] ?? '#6b7280';
        const text = escapeHtml(truncate(node.text, 60));
        const speaker = node.speaker ? `<div style="font-size:10px;color:#888;">${escapeHtml(node.speaker)}</div>` : '';
        return `<div style="position:absolute;left:${item.position.x}px;top:${item.position.y}px;width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;border:2px solid ${color};border-radius:8px;background:#fff;padding:8px;box-sizing:border-box;overflow:hidden;">
          <div style="font-size:10px;color:${color};font-weight:600;text-transform:uppercase;">${node.type}</div>
          <div style="font-size:12px;margin-top:4px;line-height:1.3;">${text}</div>
          ${speaker}
        </div>`;
      }
      if (item.kind === 'looseNoteItem') {
        const node = nodeById.get(item.nodeId);
        if (!node) return '';
        const color = NODE_COLORS[node.type] ?? '#6b7280';
        const text = escapeHtml(truncate(node.text, 30));
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

  // 边层（svg）
  const edgesSvg = model.edges.length > 0
    ? `<svg style="position:absolute;left:0;top:0;width:${maxX}px;height:${maxY}px;pointer-events:none;">
      ${model.edges
        .map((e) => {
          const srcItem = model.items.find((i) => 'nodeId' in i && i.nodeId === e.source);
          const tgtItem = model.items.find((i) => 'nodeId' in i && i.nodeId === e.target);
          if (!srcItem || !tgtItem || !('position' in srcItem) || !('position' in tgtItem)) return '';
          const sx = srcItem.position.x + CARD_WIDTH / 2;
          const sy = srcItem.position.y + CARD_HEIGHT / 2;
          const tx = tgtItem.position.x + CARD_WIDTH / 2;
          const ty = tgtItem.position.y + CARD_HEIGHT / 2;
          const color = EDGE_COLORS[e.type] ?? '#6b7280';
          return `<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="${color}" stroke-width="1.5" opacity="0.5" />`;
        })
        .join('\n')}
    </svg>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:system-ui,sans-serif;}
    .canvas{position:relative;width:${maxX}px;height:${maxY}px;}
    .meta{position:fixed;top:0;left:0;background:rgba(0,0,0,0.8);color:#fff;padding:4px 10px;font-size:12px;z-index:999;}
  </style></head><body>
    <div class="meta">${model.meta.candidate} | #${model.meta.graphIndex} | ${model.meta.nodeCount}节点 ${model.meta.edgeCount}边 | ${model.meta.clusterCount}簇(${model.meta.majorCount}M/${model.meta.minorCount}m)</div>
    <div class="canvas">
      ${clusterDivs}
      ${edgesSvg}
      ${itemDivs}
    </div>
  </body></html>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
}
```

- [ ] **Step 2: 冒烟测试——渲染一张图的 baseline**

Run:
```bash
cd tools/layout-lab/run && npx tsx -e "
import { computeBaselinePositions } from '../src/baseline-layout.ts';
import { renderModelToHtml } from '../src/html-renderer.ts';
import fs from 'fs';
const dump = JSON.parse(fs.readFileSync('../inputs/real-graphs-dump.json','utf8'));
const graph = dump[49];
const model = computeBaselinePositions(graph, 49);
renderModelToHtml(model, graph, '../outputs/round2-html/test-baseline-49.html');
console.log('done, items:', model.items.length);
"
```
Expected: 打印 `done, items: <N>`，生成 `outputs/round2-html/test-baseline-49.html`

- [ ] **Step 3: Commit**

```bash
git add tools/layout-lab/src/html-renderer.ts
git commit -m "feat(layout-lab): html-renderer（坐标/RenderModel → HTML，三候选共用）"
```

---

## Task 7: render-round2（主流程：三候选坐标 → HTML → Playwright 截图）

**Files:**
- Create: `tools/layout-lab/src/render-round2.ts`

- [ ] **Step 1: 实现 render-round2.ts**

`tools/layout-lab/src/render-round2.ts`：
```typescript
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterLayoutA } from './cluster-layout';
import { computeClusterLayoutB } from './cluster-overview';
import { renderModelToHtml } from './html-renderer';
import type { RenderModel } from './round2-types';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const HTML_DIR = path.resolve(import.meta.dirname, '../outputs/round2-html');
const SHOT_DIR = path.resolve(import.meta.dirname, '../outputs/round2-screenshots');

// spec 4.x 代表样本（23 条）
const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46, // 大图
  37, 32, 58, 57, // 中等
  18, 21, 16, 12, 6, // 小图/防伤害
  33, 51, // 长标签
];

export async function renderRound2(): Promise<void> {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  fs.mkdirSync(HTML_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  // 1. 算三候选坐标 + 生成 HTML
  for (const idx of SAMPLE_INDICES) {
    const graph = dump[idx];
    if (!graph) {
      console.warn(`[round2] graph #${idx} 不存在，跳过`);
      continue;
    }
    const padded = String(idx).padStart(2, '0');

    const baseline = computeBaselinePositions(graph, idx);
    const candidateA = computeClusterLayoutA(graph, idx);
    const candidateB = computeClusterLayoutB(graph, idx);

    renderModelToHtml(baseline, graph, path.join(HTML_DIR, `${padded}-baseline.html`));
    renderModelToHtml(candidateA, graph, path.join(HTML_DIR, `${padded}-A.html`));
    renderModelToHtml(candidateB, graph, path.join(HTML_DIR, `${padded}-B.html`));

    console.log(`[round2] #${padded}: baseline=${baseline.items.length}items A=${candidateA.meta.clusterCount}clusters B=${candidateB.meta.clusterCount}clusters`);
  }

  // 2. Playwright 截图
  const browser = await chromium.launch({ headless: true });
  for (const idx of SAMPLE_INDICES) {
    const padded = String(idx).padStart(2, '0');
    for (const candidate of ['baseline', 'A', 'B'] as const) {
      const htmlPath = path.join(HTML_DIR, `${padded}-${candidate}.html`);
      if (!fs.existsSync(htmlPath)) continue;
      const page = await browser.newPage();
      await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(SHOT_DIR, `${padded}-${candidate}.png`),
        fullPage: true,
      });
      await page.close();
    }
    console.log(`[round2] #${padded} 截图完成`);
  }
  await browser.close();
  console.log(`[round2] 全部完成：${SAMPLE_INDICES.length} 条图 × 3 候选`);
}

void renderRound2();
```

- [ ] **Step 2: 运行全流程**

```bash
cd tools/layout-lab/run && npx tsx ../src/render-round2.ts
```
Expected: 打印每条图的进度，最终 `全部完成：23 条图 × 3 候选`。`outputs/round2-screenshots/` 下 69 张 PNG。

- [ ] **Step 3: 抽查截图非空白**

```bash
ls -la tools/layout-lab/outputs/round2-screenshots/49-baseline.png
ls -la tools/layout-lab/outputs/round2-screenshots/49-A.png
ls -la tools/layout-lab/outputs/round2-screenshots/49-B.png
```
Expected: 三张文件都存在且 size > 10KB

- [ ] **Step 4: Commit**

```bash
git add tools/layout-lab/src/render-round2.ts
git commit -m "feat(layout-lab): render-round2 主流程（三候选坐标→HTML→Playwright截图）"
```

---

## Task 8: round2-gallery + LLM 草评

**Files:**
- Create: `tools/layout-lab/src/round2-gallery.ts`
- Create: `tools/layout-lab/src/round2-evaluate.ts`

- [ ] **Step 1: 实现 round2-gallery.ts（三栏并排对比 HTML）**

`tools/layout-lab/src/round2-gallery.ts`：
```typescript
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = path.join(ROOT, 'outputs/round2-screenshots');
const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46,
  37, 32, 58, 57,
  18, 21, 16, 12, 6,
  33, 51,
];

export function renderRound2Gallery(): void {
  const rows: string[] = [];

  for (const idx of SAMPLE_INDICES) {
    const padded = String(idx).padStart(2, '0');
    const shot = (c: string) => {
      const p = path.join(SHOT_DIR, `${padded}-${c}.png`);
      return fs.existsSync(p) ? `round2-screenshots/${padded}-${c}.png` : '';
    };

    rows.push(`
      <div class="graph-row">
        <h3>#${idx}</h3>
        <div class="candidates">
          <div class="cand"><h4>Baseline</h4><img src="${shot('baseline')}" loading="lazy" /></div>
          <div class="cand"><h4>Candidate A</h4><img src="${shot('A')}" loading="lazy" /></div>
          <div class="cand"><h4>Candidate B</h4><img src="${shot('B')}" loading="lazy" /></div>
        </div>
      </div>
    `);
  }

  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>Round 2 Cluster-First Layout A/B</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#fafafa}
.graph-row{background:#fff;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:16px}
.candidates{display:flex;gap:12px}
.cand{flex:1;min-width:0}
.cand img{width:100%;border:1px solid #eee;border-radius:4px}
h3{margin:0 0 8px}h4{margin:0 0 4px;font-size:13px;color:#666}
</style></head><body>
<h1>Round 2: Cluster-First Layout A/B 对比</h1>
<p>${SAMPLE_INDICES.length} 条图 × 3 候选。主要看：大图是否不再"一片乱"？主话题能否一眼定位？小图是否没被伤害？</p>
${rows.join('')}
</body></html>`;

  fs.writeFileSync(path.join(ROOT, 'outputs/round2-gallery.html'), html);
  console.log(`[round2-gallery] 完成 → outputs/round2-gallery.html`);
}

renderRound2Gallery();
```

- [ ] **Step 2: 实现 round2-evaluate.ts（LLM 草评）**

`tools/layout-lab/src/round2-evaluate.ts`：
```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterLayoutA } from './cluster-layout';
import { computeClusterLayoutB } from './cluster-overview';

const METRICS_DIR = path.resolve(import.meta.dirname, '../outputs/metrics');
const SIMPLIFIED_DIR = path.resolve(import.meta.dirname, '../outputs/simplified');
const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const OUTPUT_PATH = path.resolve(import.meta.dirname, '../outputs/round2-llm-eval.json');

const OPENCODE_SERVE_URL = process.env.OPENCODE_SERVE_URL ?? 'http://127.0.0.1:4199';
const MODEL = process.env.LAYOUT_LAB_LLM_MODEL ?? 'opencode/deepseek-v4-flash-free';
const MAX_RETRIES = 3;

const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46,
  37, 32, 58, 57,
  18, 21, 16, 12, 6,
  33, 51,
];

const SYSTEM_PROMPT = `你是图谱布局评审助手。对一张图的三个布局候选做纯文本评审（你看不到截图）。
只回答三个问题：
1. cluster 分区是否符合 graph 结构？（是否过度拆分/合并不当）
2. 哪些图不适合 cluster-first？（如真实争论、纯因果链）
3. baseline vs candidate A/B 的语义组织哪个更清晰？
只输出 JSON：{"partitionReasonable": bool, "unsuitableForCluster": bool, "unsuitableReason": string, "semanticOrgWinner": "baseline"|"A"|"B"|"tie", "note": string}`;

function buildPrompt(graphIndex: number, graph: MergedGraph, baselineMeta: unknown, aMeta: unknown, bMeta: unknown): string {
  const padded = String(graphIndex).padStart(2, '0');
  const simplified = JSON.parse(fs.readFileSync(path.join(SIMPLIFIED_DIR, `${padded}.json`), 'utf8'));
  return `${SYSTEM_PROMPT}\n\n--- graph JSON ---\n${JSON.stringify(simplified.simplified)}\n--- baseline meta ---\n${JSON.stringify(baselineMeta)}\n--- candidate A meta ---\n${JSON.stringify(aMeta)}\n--- candidate B meta ---\n${JSON.stringify(bMeta)}\n只输出 JSON，不要 markdown。`;
}

async function callOpencodeServe(prompt: string): Promise<string> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const sr = await fetch(`${OPENCODE_SERVE_URL}/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!sr.ok) throw new Error(`serve /session ${sr.status}`);
      const sj = await sr.json();
      const mr = await fetch(`${OPENCODE_SERVE_URL}/session/${sj.id}/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: prompt }] }),
      });
      if (!mr.ok) throw new Error(`serve /message ${mr.status}`);
      const mj = await mr.json();
      const content = (mj?.parts ?? []).filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join('');
      if (!content.trim()) throw new Error('空内容');
      return content;
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        console.warn(`  ↻ 第 ${attempt + 1} 次失败: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw new Error('重试耗尽');
}

export async function evaluateRound2(): Promise<void> {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  const results: unknown[] = [];

  for (const idx of SAMPLE_INDICES) {
    const graph = dump[idx];
    if (!graph) continue;
    const baseline = computeBaselinePositions(graph, idx);
    const a = computeClusterLayoutA(graph, idx);
    const b = computeClusterLayoutB(graph, idx);
    const prompt = buildPrompt(idx, graph, baseline.meta, a.meta, b.meta);

    try {
      const raw = await callOpencodeServe(prompt);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```/g, '').trim());
      } catch {
        parsed = { raw };
      }
      results.push({ graphIndex: idx, eval: parsed });
      console.log(`[eval] #${idx} done`);
    } catch (e) {
      results.push({ graphIndex: idx, error: (e as Error).message });
      console.error(`[eval] #${idx} 失败: ${(e as Error).message}`);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  console.log(`[eval] 完成 → outputs/round2-llm-eval.json (${results.length} 条)`);
}

void evaluateRound2();
```

- [ ] **Step 3: 生成 gallery**

```bash
cd tools/layout-lab/run && npx tsx ../src/round2-gallery.ts
```
Expected: 打印完成，生成 `outputs/round2-gallery.html`

- [ ] **Step 4: 跑 LLM 草评（需 opencode serve 运行）**

先启动 serve：`opencode serve --port 4199 &`
然后：
```bash
cd tools/layout-lab/run && npx tsx ../src/round2-evaluate.ts
```
Expected: 23 条逐条完成，生成 `outputs/round2-llm-eval.json`

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/src/round2-gallery.ts tools/layout-lab/src/round2-evaluate.ts
git commit -m "feat(layout-lab): round2 gallery + LLM 草评"
```

---

## 完成标准（Definition of Done）

- [ ] 8 个 Task 全部落地，代码提交
- [ ] 全部测试通过：`cd tools/layout-lab/run && npx vitest run`
- [ ] baseline 等价验证通过（3 图 positions 与产品函数一致）
- [ ] 23 条图 × 3 候选 = 69 张截图生成且非空白
- [ ] `round2-gallery.html` 可在浏览器打开，三栏并排
- [ ] `round2-llm-eval.json` 生成（23 条 LLM 草评）
- [ ] **人眼审核 gallery**：按 spec 5.3 go/no-go 门槛判定

## 不在本计划范围

- ❌ Candidate C（opposition 强化）
- ❌ Louvain/社区发现
- ❌ 点击展开交互
- ❌ 改产品代码
- ❌ 第三轮产品化（等 go 判定）
