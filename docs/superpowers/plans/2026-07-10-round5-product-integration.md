# Round 5：R3b 产品化接入实现计划（v2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 R3b 力导向布局通过 feature flag 接入真实 sidepanel，验证在真实 React Flow 中的可读性、增量稳定性和性能。

**Architecture:** R3b 内核提取到 `packages/graph-renderers/src/r3b/`（单一来源，lab 反向 import）。布局内核接收外部 sizes（不再内部调 computeAllNodeSizes），保证力计算/碰撞/React Flow/edge handles/auto-tour 全用同一份尺寸。App.tsx 拆两层 useMemo：geometry transition（只由 graph 触发）+ artifact decoration（处理选中/时间/视图，不推进 R3b 状态）。三个 build 变体。

**Tech Stack:** TypeScript、React、React Flow、Vitest、Playwright、Vite env vars。

**Spec:** `docs/superpowers/specs/2026-07-10-round5-product-integration.md`

---

## v1 审核修正对照

| # | v1 问题 | v2 修正 |
|---|---|---|
| P1#1 | 布局用实验台尺寸，渲染用真实尺寸，两套不一致 | 内核接收外部 `sizes` 参数，一份贯穿 |
| P1#2 | 两层 memo 没真正拆开（geometry 层直接建 artifacts） | 拆 `buildR3bGeometry` + `decorateR3bArtifacts` 两个独立函数 |
| P1#3 | appliedRevision 不足以保证幂等和 session 隔离 | `appliedSessionId + geometryKey`（节点 ID 集合 + 尺寸签名） |
| P1#4 | 提取只是复制，没改 lab import，没等价测试 | 提取后 lab 反向 import + #49/#41/#32 golden positions 等价测试 |
| P1#5 | 验证只截 4 条，无 stable 对照，指标代码是 `// ...` | 23 条 × stable/r3b 对比 + sequence 增量 + p95 性能 + 真实 DOM 指标 |
| P2#6 | NodeGeometry 没贯穿 React Flow node style | `ReactFlowDebugNode` 加 `style?`，flowNodes 注入 `style.width/height` |
| P2#7 | `rendererGraph: {} as RendererGraph` 伪数据 + build 缺 tsc | 继续生成真实 renderer graph，只替换 positions；build 保留 tsc |

---

## 任务依赖

```
Task 1: 提取 R3b 内核 + computeIncrementalLayout 接收外部 sizes + lab 反向 import + golden 等价测试
Task 2: NodeGeometry 契约（GraphNodeCardData + ReactFlowDebugNode + computeRealNodeSize）
  └─ Task 3: resolveEdgeHandles + auto-tour 改用 NodeGeometry（可选 size 参数，fallback 220×132）
Task 4: Feature flag（env + build 脚本 + vite-env + 隔离测试）
Task 5: r3b-geometry.ts + r3b-decorate.ts + App.tsx 两层集成
  └─ Task 6: 验证（23 条 × stable/r3b 截图 + sequence 增量 + p95 性能 + 回归）
```

Task 1-3 可并行做（1 不依赖 2/3）。Task 5 依赖 1-4。Task 6 依赖 5。

---

## Task 1: 提取 R3b 内核 + sizes 参数化 + 单一来源

**Files:**
- Create: `packages/graph-renderers/src/r3b/types.ts`
- Create: `packages/graph-renderers/src/r3b/partition.ts`
- Create: `packages/graph-renderers/src/r3b/node-size.ts`
- Create: `packages/graph-renderers/src/r3b/force-core.ts`
- Create: `packages/graph-renderers/src/r3b/cluster-force.ts`
- Create: `packages/graph-renderers/src/r3b/incremental.ts`
- Create: `packages/graph-renderers/src/r3b/index.ts`
- Create: `packages/graph-renderers/src/r3b/equivalence.test.ts`
- Modify: `packages/graph-renderers/src/index.ts`

### 关键改动 vs lab 原版

1. **`computeIncrementalLayout` 加 `sizes` 参数**：不再内部调 `computeAllNodeSizes(graph.nodes)`，改为接收外部传入的 `sizes: Record<string, NodeSize>`。
2. **`computeClusterForceLayout` 加 `sizes` 参数**：同理。
3. **`cluster-force.ts` 不依赖 lab 的 `round2-types`**：把 `RenderModel`/`RenderItem`/`RenderEdge`/`ClusterInfo`/`Position` 和 `CLUSTER_GAP`/`LOOSE_NOTE_*` 常量定义在 r3b/ 内部（它们是纯类型/常量，复制几行即可）。
4. **`IncrementalState` 加 `appliedSessionId?` 和 `geometryKey?`**：用于幂等和 session 隔离（Task 5 消费）。

### Step 1: 创建 r3b/types.ts

从 `tools/layout-lab/src/incremental-types.ts` 复制，调整：
- import `NodeSize` 从 `./node-size` 而非 `./round3-types`
- import `CenterPos` 从 `./force-core` 而非 `./force-core-v2`
- `IncrementalState` 加两个字段：

```typescript
export type IncrementalState = {
  positions: Record<string, CenterPos>;
  sizes: Record<string, NodeSize>;
  clusterOrigins: Record<string, { x: number; y: number }>;
  prevClusters: Array<{ id: string; nodeIds: string[]; type: 'major' | 'minor' }>;
  appliedSessionId?: string;   // Task 5 用
  geometryKey?: string;        // Task 5 用
};
```

保留所有现有函数（`computePinK`, `computeMaxDrift`, `computeOldMobility`, `stableHash`, `matchClusters`, `ClusterMatch`, `createEmptyIncrementalState`）。

### Step 2: 创建 r3b/node-size.ts

从 `tools/layout-lab/src/round3-types.ts` 复制 `NodeSize`, `FORCE_PARAMS`, `computeNodeSize`, `truncateText`, `computeAllNodeSizes`。删除 `CenterPos`（移到 force-core.ts）。

### Step 3: 创建 r3b/force-core.ts

从 `tools/layout-lab/src/force-core-v2.ts` 完整复制（`CenterPos`, `resolveOverlaps` 带 padding=16 + 较小 penetration 轴）。

### Step 4: 创建 r3b/partition.ts

从 `tools/layout-lab/src/cluster-partition.ts` 完整复制。import `ClusterPartition` 从 `./types`。

### Step 5: 创建 r3b/cluster-force.ts

从 `tools/layout-lab/src/cluster-force-layout.ts` 复制，改动：
1. 删掉 `import ... from './round2-types'`，改为在文件内定义需要的类型和常量：

```typescript
// r3b 内部类型（从 round2-types 提取的子集）
export type Position = { x: number; y: number };
export type RenderItem =
  | { kind: 'fullNode'; nodeId: string; position: Position }
  | { kind: 'looseNoteItem'; nodeId: string; position: Position }
  | { kind: 'clusterSummary'; clusterId: string; position: Position; nodeCount: number; edgeCount: number };
export type RenderEdge = { source: string; target: string; type: EdgeType };
export type ClusterInfo = { id: string; type: 'major' | 'minor'; nodeIds: string[]; bounds: { x: number; y: number; width: number; height: number } };
export type RenderModel = { items: RenderItem[]; edges: RenderEdge[]; clusters: ClusterInfo[]; meta: { candidate: string; graphIndex: number; nodeCount: number; edgeCount: number; clusterCount: number; majorCount: number; minorCount: number } };

const CLUSTER_GAP = 60;
const LOOSE_NOTE_ITEM_HEIGHT = 32;
const LOOSE_NOTE_ITEM_WIDTH = 200;
```

2. `computeClusterForceLayout` 加 `sizes` 参数：

```typescript
export function computeClusterForceLayout(
  graph: MergedGraph,
  graphIndex: number,
  variant: 'R3a' | 'R3b',
  sizes: Record<string, NodeSize>,  // 新增：外部传入，不再内部算
): RenderModel {
  // 删除 `const allSizes = computeAllNodeSizes(graph.nodes);`
  // 全部 allSizes 引用改为参数 sizes
```

3. `layoutClusterForce` 内部也用传入的 sizes。

### Step 6: 创建 r3b/incremental.ts

从 `tools/layout-lab/src/incremental-force.ts` 复制，改动：
1. import 从 `./types` `./force-core` `./node-size` `./partition` `./cluster-force`
2. **`computeIncrementalLayout` 加 `sizes` 参数**：

```typescript
export function computeIncrementalLayout(
  graph: MergedGraph,
  prevState: IncrementalState,
  variant: 'R3a' | 'R3b',
  sizes: Record<string, NodeSize>,  // 新增：外部传入
): IncrementalResult {
  // 删除 `const allSizes = computeAllNodeSizes(graph.nodes);`
  // 全部 allSizes 引用改为参数 sizes
```

3. `resolveOverlapsWithMobility` 也用传入的 sizes（它已经接收 sizes 参数，不用改）。

### Step 7: 创建 r3b/index.ts

```typescript
export * from './types';
export * from './node-size';
export * from './force-core';
export * from './partition';
export * from './cluster-force';
export * from './incremental';
```

### Step 8: 修改 packages/graph-renderers/src/index.ts

末尾加 `export * from './r3b';`

### Step 9: 写 golden 等价测试

Create `packages/graph-renderers/src/r3b/equivalence.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeIncrementalLayout, createEmptyIncrementalState, computeAllNodeSizes } from './index';
import type { MergedGraph } from '@listen-graphic/schema';

const DUMP = path.resolve(__dirname, '../../../../tools/layout-lab/inputs/real-graphs-dump.json');

describe('R3b golden 等价性（提取后 vs lab 固定输出）', () => {
  // 用 #32（91节点，5簇）做 golden——够大验证正确性，够快不超时
  it('#32 增量最终态 positions 确定性', () => {
    const dump = JSON.parse(fs.readFileSync(DUMP, 'utf8')) as MergedGraph[];
    const graph = dump[32];
    const sizes = computeAllNodeSizes(graph.nodes);

    // 跑两次，验证确定性
    const r1 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);
    const r2 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);

    for (const id of Object.keys(r1.positions)) {
      expect(r2.positions[id].cx).toBe(r1.positions[id].cx);
      expect(r2.positions[id].cy).toBe(r1.positions[id].cy);
    }
  });

  it('#18 小图增量最终态 positions 确定性', () => {
    const dump = JSON.parse(fs.readFileSync(DUMP, 'utf8')) as MergedGraph[];
    const graph = dump[18];
    const sizes = computeAllNodeSizes(graph.nodes);

    const r1 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);
    const r2 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);

    for (const id of Object.keys(r1.positions)) {
      expect(r2.positions[id]).toEqual(r1.positions[id]);
    }
  });
});
```

### Step 10: 修改 lab 反向 import package

修改 `tools/layout-lab/src/incremental-force.ts`：
- 删掉全部实现，改为 re-export：
```typescript
export { computeIncrementalLayout } from '@listen-graphic/graph-renderers';
export type { IncrementalResult, DisplacementStats } from '@listen-graphic/graph-renderers';
```

同理修改其他 lab 文件（`incremental-types.ts`, `force-core-v2.ts`, `round3-types.ts`, `cluster-partition.ts`, `cluster-force-layout.ts`），改为从 package re-export。

注意：lab 的 `vitest.config.ts` 需要加 `@listen-graphic/graph-renderers` alias（如果还没有）。

### Step 11: 运行测试

```bash
# package 内部测试
cd packages/graph-renderers && npx vitest run src/r3b/equivalence.test.ts

# lab 测试（验证反向 import 后仍通过）
cd tools/layout-lab/run && npx vitest run
```
Expected: 全部通过

### Step 12: Commit

```bash
git add packages/graph-renderers/src/r3b/ packages/graph-renderers/src/index.ts tools/layout-lab/src/
git commit -m "feat(graph-renderers): 提取 R3b 内核 + sizes 参数化 + lab 反向 import

- computeIncrementalLayout/computeClusterForceLayout 接收外部 sizes
- cluster-force.ts 自包含（不依赖 lab round2-types）
- IncrementalState 加 appliedSessionId/geometryKey
- lab 反向 import @listen-graphic/graph-renderers
- golden 等价测试（#32/#18 确定性）"
```

---

## Task 2: NodeGeometry 契约

**Files:**
- Create: `packages/graph-renderers/src/r3b/node-geometry.ts`
- Create: `packages/graph-renderers/src/r3b/node-geometry.test.ts`
- Modify: `packages/ui/src/types.ts`（GraphNodeCardData 加 `nodeSize?`）
- Modify: `apps/extension/src/sidepanel/types.ts`（ReactFlowDebugNode 加 `style?`）

### Step 1: 创建 node-geometry.ts

```typescript
import type { NodeType } from '@listen-graphic/schema';
import { truncateText } from './node-size';

export type NodeGeometry = {
  position: { x: number; y: number };
  size: { width: number; height: number };
};

export type NodeDisplayMode = 'readable' | 'compact';

export function computeRealNodeSize(
  text: string,
  nodeType: NodeType,
  hasSpeaker: boolean,
  hasTimestamp: boolean,
  displayMode: NodeDisplayMode = 'readable',
): { width: number; height: number } {
  const isCompact = displayMode === 'compact';
  const maxTextChars = isCompact ? 56 : 80;
  const displayText = truncateText(text, maxTextChars);
  const charWidth = isCompact ? 7 : 12;
  const padding = isCompact ? 8 : 16;
  const maxWidth = isCompact ? 200 : 220;
  const minWidth = isCompact ? 140 : 80;

  const idealWidth = Math.min(maxWidth, Math.max(minWidth, displayText.length * charWidth + padding * 2));
  const charsPerLine = Math.max(1, Math.floor((idealWidth - padding * 2) / charWidth));
  const lineCount = Math.max(1, Math.ceil(displayText.length / charsPerLine));
  const lineHeight = isCompact ? 16 : 18;

  const typeLabelH = 16;
  const textH = lineCount * lineHeight;
  const speakerH = hasSpeaker ? 14 : 0;
  const timestampH = hasTimestamp ? 14 : 0;
  const height = Math.max(isCompact ? 50 : 60, typeLabelH + textH + speakerH + timestampH + padding * 2);

  return { width: idealWidth, height };
}
```

### Step 2: 写单测

Create `packages/graph-renderers/src/r3b/node-geometry.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computeRealNodeSize } from './node-geometry';

describe('computeRealNodeSize', () => {
  it('readable 短文本不包含 speaker/timestamp', () => {
    const s = computeRealNodeSize('短文本', 'claim', false, false, 'readable');
    expect(s.width).toBeGreaterThanOrEqual(80);
    expect(s.height).toBeGreaterThanOrEqual(60);
  });

  it('speaker + timestamp 增加高度 ≥28px', () => {
    const noExtra = computeRealNodeSize('x'.repeat(50), 'claim', false, false, 'readable');
    const withExtra = computeRealNodeSize('x'.repeat(50), 'claim', true, true, 'readable');
    expect(withExtra.height - noExtra.height).toBeGreaterThanOrEqual(28);
  });

  it('compact 宽度范围 140-200', () => {
    const s = computeRealNodeSize('x'.repeat(30), 'reason', false, false, 'compact');
    expect(s.width).toBeGreaterThanOrEqual(140);
    expect(s.width).toBeLessThanOrEqual(200);
  });
});
```

### Step 3: GraphNodeCardData 加 nodeSize

在 `packages/ui/src/types.ts` 的 `GraphNodeCardData` interface 加：

```typescript
nodeSize?: { width: number; height: number };
```

### Step 4: ReactFlowDebugNode 加 style

在 `apps/extension/src/sidepanel/types.ts` 的 `ReactFlowDebugNode` 加：

```typescript
export type ReactFlowDebugNode = {
  id: string;
  type: 'graphNode';
  position: { x: number; y: number };
  data: ReactFlowDebugNodeData;
  style?: Record<string, unknown>;  // 新增
};
```

### Step 5: 运行测试 + commit

```bash
cd tools/layout-lab/run && npx vitest run ../../../packages/graph-renderers/src/r3b/node-geometry.test.ts
cd ../../../apps/extension && pnpm exec tsc -b --noEmit
git add packages/graph-renderers/src/r3b/node-geometry.ts packages/graph-renderers/src/r3b/node-geometry.test.ts packages/ui/src/types.ts apps/extension/src/sidepanel/types.ts
git commit -m "feat: NodeGeometry 契约（computeRealNodeSize + GraphNodeCardData.nodeSize + ReactFlowDebugNode.style）"
```

---

## Task 3: resolveEdgeHandles + auto-tour 改用 NodeGeometry

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.ts`
- Modify: `apps/extension/src/sidepanel/auto-tour-utils.ts`

### Step 1: resolveEdgeHandles 加可选 size

在 `graph-utils.ts` 中，`resolveEdgeHandles` 签名加 `sourceSize?` 和 `targetSize?` 参数。内部用 `sourceSize?.width ?? STABLE_LAYOUT_CARD_WIDTH` 等。`getNodeRect` 同理。

### Step 2: auto-tour-utils.ts 用 nodeSize

bounds 从 `node.data?.nodeSize` 取，fallback 到 `STABLE_LAYOUT_CARD_WIDTH/HEIGHT`。

### Step 3: 运行现有测试

```bash
cd apps/extension && pnpm test:run
```
Expected: 全部通过（参数可选，不传时 fallback）

### Step 4: Commit

```bash
git add apps/extension/src/sidepanel/graph-utils.ts apps/extension/src/sidepanel/auto-tour-utils.ts
git commit -m "feat(extension): resolveEdgeHandles + auto-tour 支持可选 NodeGeometry"
```

---

## Task 4: Feature flag

**Files:**
- Modify: `apps/extension/src/vite-env.d.ts`
- Create: `apps/extension/.env.r3b`
- Create: `apps/extension/.env.r3b-fixture-lab`
- Modify: `apps/extension/package.json`

### Step 1-3: 同 v1 计划（加 VITE_LAYOUT_ENGINE + 两个 env 文件 + 两个 build 脚本）

build 脚本保留 tsc：
```json
"build:r3b": "tsc -b && vite build --mode r3b",
"build:r3b:fixture-lab": "tsc -b && vite build --mode r3b-fixture-lab",
```

### Step 4: 验证

```bash
pnpm --filter extension build:r3b
pnpm --filter extension build:r3b:fixture-lab
```

用 E2E 行为确认（不只是搜索 bundle）：
- `build:r3b` 的 dist 启动后 `__listenGraphicFixture` 未定义
- `build:r3b:fixture-lab` 的 dist 启动后 `__listenGraphicFixture` 已定义

### Step 5: Commit

```bash
git add apps/extension/src/vite-env.d.ts apps/extension/.env.r3b apps/extension/.env.r3b-fixture-lab apps/extension/package.json
git commit -m "feat(extension): R3b feature flag（VITE_LAYOUT_ENGINE + 三 build 变体）"
```

---

## Task 5: r3b-geometry.ts + r3b-decorate.ts + App.tsx 两层集成

> 这是核心 Task。两个独立函数，真拆开。

**Files:**
- Create: `apps/extension/src/sidepanel/r3b-geometry.ts`
- Create: `apps/extension/src/sidepanel/r3b-decorate.ts`
- Modify: `apps/extension/src/sidepanel/App.tsx`

### Step 1: 创建 r3b-geometry.ts（层 1：只算位置）

```typescript
import type { MergedGraph } from '@listen-graphic/schema';
import {
  computeIncrementalLayout,
  computeAllNodeSizes,
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

// 算 geometry key：节点 ID 集合的有序 hash + revision
function computeGeometryKey(graph: MergedGraph): string {
  const ids = graph.nodes.map(n => n.id).sort().join(',');
  return `${graph.sessionId}:${graph.revision}:${ids}`;
}

export function buildR3bGeometry(
  graph: MergedGraph,
  previousState: IncrementalState,
): R3bGeometry {
  const key = computeGeometryKey(graph);

  // 幂等：相同 session + 相同 geometry key → 返回已有 positions
  if (previousState.appliedSessionId === graph.sessionId &&
      previousState.geometryKey === key &&
      previousState.positions) {
    // 重建 sizes（尺寸可能因 displayMode 变化，但位置不变）
    const sizes = computeAllNodeSizes(graph.nodes);
    const geometries: Record<string, { position: { x: number; y: number }; size: NodeSize }> = {};
    for (const n of graph.nodes) {
      const cp = previousState.positions[n.id];
      const s = sizes[n.id];
      if (cp && s) {
        geometries[n.id] = { position: { x: cp.cx - s.width / 2, y: cp.cy - s.height / 2 }, size: s };
      }
    }
    return { positions: previousState.positions, sizes, geometries, nextState: previousState, geometryKey: key };
  }

  // 先算唯一尺寸（覆盖真实卡片结构）
  const sizes: Record<string, NodeSize> = {};
  for (const n of graph.nodes) {
    sizes[n.id] = computeRealNodeSize(n.text, n.type, !!n.speaker, true, 'readable');
  }

  // 跑增量布局，传入 sizes（力计算 + 碰撞用同一份）
  const result = computeIncrementalLayout(graph, previousState, 'R3b', sizes);

  // 转 top-left
  const geometries: Record<string, { position: { x: number; y: number }; size: NodeSize }> = {};
  for (const n of graph.nodes) {
    const cp = result.positions[n.id];
    const s = sizes[n.id];
    if (cp && s) {
      geometries[n.id] = { position: { x: cp.cx - s.width / 2, y: cp.cy - s.height / 2 }, size: s };
    }
  }

  const nextState: IncrementalState = {
    ...result.state,
    appliedSessionId: graph.sessionId,
    geometryKey: key,
  };

  return { positions: result.positions, sizes, geometries, nextState, geometryKey: key };
}
```

### Step 2: 创建 r3b-decorate.ts（层 2：装饰，不推进状态）

```typescript
import type { MergedGraph, ViewType, EdgeType } from '@listen-graphic/schema';
import type { R3bGeometry } from './r3b-geometry';
import type { ReactFlowDebugNode, ReactFlowDebugEdge, DebugViewArtifact } from './types';
import { VIEW_EDGE_PRIORITIES } from './constants';
import { resolveEdgeHandles, getRendererGraph } from './graph-utils';
import type { RendererGraph } from '@listen-graphic/graph-renderers';

export function decorateR3bArtifacts(
  graph: MergedGraph,
  geometry: R3bGeometry,
  currentView: ViewType,
  currentTimeMs: number,
  selectedNodeId: string | null,
): Record<ViewType, DebugViewArtifact> {
  const artifacts = {} as Record<ViewType, DebugViewArtifact>;

  for (const view of ['causal', 'comparison', 'hierarchy', 'timeline'] as ViewType[]) {
    const priorities = VIEW_EDGE_PRIORITIES[view] ?? VIEW_EDGE_PRIORITIES.causal;
    const rendererGraph = getRendererGraph(graph, view); // 真实 renderer graph（非伪数据）

    const nodes: ReactFlowDebugNode[] = graph.nodes
      .filter((n) => geometry.geometries[n.id])
      .map((n) => {
        const g = geometry.geometries[n.id];
        const isActive = Math.abs(n.timestampMs - currentTimeMs) < 30000 || n.id === selectedNodeId;
        return {
          id: n.id,
          type: 'graphNode' as const,
          position: g.position,
          data: {
            label: n.text,
            nodeType: n.type,
            speaker: n.speaker,
            timestampMs: n.timestampMs,
            status: n.status,
            isActive,
            nodeSize: g.size,
          },
          style: { width: g.size.width, height: g.size.height },
        };
      });

    const edges: ReactFlowDebugEdge[] = graph.edges
      .filter((e) => {
        const p = priorities[e.type as EdgeType];
        return p !== 'hidden';
      })
      .filter((e) => geometry.geometries[e.source] && geometry.geometries[e.target])
      .map((e) => {
        const sg = geometry.geometries[e.source];
        const tg = geometry.geometries[e.target];
        const handles = resolveEdgeHandles(sg.position, tg.position, sg.size, tg.size);
        const priority = priorities[e.type as EdgeType] ?? 'secondary';
        return {
          id: e.id, source: e.source, target: e.target, type: 'default' as const,
          sourceHandle: handles.sourceHandle, targetHandle: handles.targetHandle,
          label: e.type,
          style: {
            stroke: e.type === 'supports' ? '#10b981' : e.type === 'opposes' ? '#ef4444' : e.type === 'causes' ? '#f59e0b' : '#6b7280',
            opacity: priority === 'primary' ? 1 : 0.35,
          },
          animated: e.type === 'causes' && priority === 'primary',
        };
      });

    artifacts[view] = {
      rendererGraph,
      layoutDiagnostics: { reusedPositions: 0, newPositions: nodes.length, movedPositions: 0 },
      reactFlow: { nodes, edges },
    };
  }

  return artifacts;
}
```

### Step 3: 修改 App.tsx

1. 加 import + ref：

```typescript
import { buildR3bGeometry } from './r3b-geometry';
import { decorateR3bArtifacts } from './r3b-decorate';
import { createEmptyIncrementalState } from '@listen-graphic/graph-renderers';
import type { IncrementalState } from '@listen-graphic/graph-renderers';

const isR3b = import.meta.env.VITE_LAYOUT_ENGINE === 'r3b';
const r3bStateRef = useRef<IncrementalState>(createEmptyIncrementalState());
```

2. 替换现有 `layoutBuild` useMemo（第 611-619 行）：

```typescript
// 层 1：Geometry Transition（只由 graph revision 触发，不依赖 time/view/selected）
const r3bGeometry = useMemo(() => {
  if (!isR3b) return null;
  return buildR3bGeometry(panel.graph, r3bStateRef.current);
}, [panel.graph]); // 只依赖 graph

// 提交 R3b 状态（useLayoutEffect，不在 render 中写 ref）
useLayoutEffect(() => {
  if (r3bGeometry && r3bGeometry.geometryKey !== r3bStateRef.current.geometryKey) {
    // 校验：result key 仍对应当前 graph（防止提交过期 render 的结果）
    if (r3bGeometry.nextState.appliedSessionId === panel.graph.sessionId) {
      r3bStateRef.current = r3bGeometry.nextState;
    }
  }
}, [r3bGeometry, panel.graph.sessionId]);

// 层 2：Artifact（stable layout 或 R3b decoration）
const debugViewArtifacts = useMemo(() => {
  if (isR3b && r3bGeometry) {
    return decorateR3bArtifacts(
      panel.graph, r3bGeometry,
      currentView, panel.currentTimeMs, panel.selectedNodeId,
    );
  }
  const stable = buildDebugViewArtifacts({
    graph: panel.graph,
    currentTimeMs: panel.currentTimeMs,
    selectedNodeId: panel.selectedNodeId,
    previousLayoutCache: layoutCacheRef.current,
  });
  return stable.artifacts;
}, [panel.graph, panel.currentTimeMs, panel.selectedNodeId, currentView, r3bGeometry]);
```

注意：现有 `const debugViewArtifacts = layoutBuild.artifacts;` 删除，直接用层 2 的返回值。

3. `layoutCacheRef` 的 useLayoutEffect 保留（只 stable 模式用）。

4. session 切换重置 r3bStateRef：

在现有 `resetLayoutCache` 函数附近加：
```typescript
const resetR3bState = useCallback(() => {
  r3bStateRef.current = createEmptyIncrementalState();
}, []);
```
在 session start/stop/fixture reset 调用处，同步调 `resetR3bState()`。

### Step 4: flowNodes 注入 style

在 App.tsx 的 `flowNodes` useMemo（第 717 行）里，spread node 后保留 `style`（如果 R3b 设了的话）：

```typescript
return {
  ...node,  // style 已经在 r3b-decorate.ts 里设了
  data: {
    ...node.data,
    onClickTime: handleTimeClick,
    displayMode: ...,
    isTourAdded,
    isTourAnchor,
  },
};
```

`...node` 已经包含 `style`（ReactFlowDebugNode 现在有 `style?` 字段），不需要额外处理。

### Step 5: 验证编译 + 测试

```bash
cd apps/extension && pnpm exec tsc -b --noEmit
cd apps/extension && pnpm test:run
```
Expected: 编译通过，测试全过（isR3b=false 时走 stable 路径）

### Step 6: Commit

```bash
git add apps/extension/src/sidepanel/r3b-geometry.ts apps/extension/src/sidepanel/r3b-decorate.ts apps/extension/src/sidepanel/App.tsx
git commit -m "feat(extension): R3b 两层集成（geometry transition + artifact decoration）

- buildR3bGeometry：只由 graph revision 触发，sizes 在入口算好后传入内核
- decorateR3bArtifacts：处理 isActive/选中/视图过滤，不推进 R3b 状态
- 幂等：appliedSessionId + geometryKey
- state commit 用 useLayoutEffect + session 校验"
```

---

## Task 6: GraphNodeCard adaptiveSize 分支

**Files:**
- Modify: `packages/ui/src/GraphNodeCard.tsx`

### Step 1: GraphNodeCard 支持 nodeSize

找到 style 里的 `minWidth/maxWidth`（约第 61-62 行），改为：

```typescript
...(data.nodeSize
  ? { width: data.nodeSize.width, height: data.nodeSize.height, boxSizing: 'border-box', overflow: 'hidden' }
  : { minWidth: isCompact ? 140 : 220, maxWidth: isCompact ? 200 : 260 }),
```

### Step 2: 验证

```bash
cd apps/extension && pnpm test:run
```

### Step 3: Commit

```bash
git add packages/ui/src/GraphNodeCard.tsx
git commit -m "feat(ui): GraphNodeCard adaptiveSize（R3b 模式用 data.nodeSize）"
```

---

## Task 7: 验证

**Files:**
- Create: `tools/layout-lab/src/round5-verify.ts`

### Step 1: 构建 r3b-fixture-lab + stable 两个版本

```bash
pnpm --filter extension build  # stable（prod）
cp -r apps/extension/dist apps/extension/dist-stable
pnpm --filter extension build:r3b:fixture-lab
```

### Step 2: 截 23 条样本 × 2 build

用 Playwright 分别启动 stable dist 和 r3b-fixture-lab dist，灌入 23 条真实图，截图。

每条图：
- stable：截 currentView=causal
- r3b：截 currentView=causal（R3b 模式下四视图位置相同）

### Step 3: sequence 增量验证

用 `seq-incremental-growth`（8 步）+ `arm`/`next`，截每步 R3b，验证旧节点不动。

### Step 4: 性能测量

对 #49（271 节点）跑 10 次 `computeIncrementalLayout`，记录 p95。

### Step 5: 指标（真实 DOM bounds）

用 Playwright `page.evaluate` 读 `getBoundingClientRect`，算：
- avgEdgeLength（节点中心间欧氏距离）
- edgeCrossings（边穿过其他节点矩形）
- overlapPairs（节点矩形相交）
- 最小净距

### Step 6: 回归测试

```bash
pnpm --filter extension build  # prod
cd apps/extension && pnpm test:run  # 应全部通过
```

### Step 7: Commit

```bash
git add tools/layout-lab/src/round5-verify.ts
git commit -m "test(layout-lab): Round 5 验证（23 条 × stable/r3b + sequence + p95）"
```

---

## 完成标准

- [ ] 7 个 Task 全部落地
- [ ] 全套测试通过（graph-renderers r3b + lab + extension）
- [ ] `build` / `build:r3b` / `build:r3b:fixture-lab` 均成功
- [ ] prod build 零回归
- [ ] 23 条样本 × stable/r3b 对比截图生成
- [ ] sequence 增量验证：旧节点位移 0px
- [ ] 性能：#49 计算 p95 < 200ms
- [ ] 真实 DOM 指标可计算
