# Round 5：R3b 产品化接入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 R3b 力导向布局通过 feature flag 接入真实 sidepanel，验证在真实 React Flow 中的可读性、增量稳定性和性能。

**Architecture:** R3b 内核从 `tools/layout-lab/` 提取到 `packages/graph-renderers/src/r3b/`（单一来源）。sidepanel 的 `App.tsx` 加两层 useMemo 分支（geometry transition + artifact decoration）。GraphNodeCard + resolveEdgeHandles + auto-tour 统一消费 NodeGeometry 契约。三个 build 变体（prod / r3b / r3b-fixture-lab）。

**Tech Stack:** TypeScript、React、React Flow、Vitest、Playwright、Vite env vars。

**Spec:** `docs/superpowers/specs/2026-07-10-round5-product-integration.md`

---

## Scope Check

这个 spec 跨多个子系统但它们有强依赖顺序（内核 → 契约 → 集成 → 验证），适合一个计划。

## 任务依赖

```
Task 1: 提取 R3b 内核到 packages/graph-renderers/src/r3b/（+ 等价测试）
Task 2: NodeGeometry 契约 + computeRealNodeSize（覆盖真实卡片结构）
  └─ Task 3: resolveEdgeHandles + auto-tour 改用 NodeGeometry
Task 4: Feature flag 基础设施（env + build 脚本 + vite-env.d.ts）
  └─ Task 5: r3b-layout.ts 适配层（两层 useMemo 集成到 App.tsx）
        └─ Task 6: GraphNodeCard adaptiveSize 分支
              └─ Task 7: 验证（真实 React Flow 截图 + 指标 + 回归）
```

---

## Task 1: 提取 R3b 内核到 packages/graph-renderers/src/r3b/

**Files:**
- Create: `packages/graph-renderers/src/r3b/types.ts`
- Create: `packages/graph-renderers/src/r3b/partition.ts`
- Create: `packages/graph-renderers/src/r3b/node-size.ts`
- Create: `packages/graph-renderers/src/r3b/force-core.ts`
- Create: `packages/graph-renderers/src/r3b/cluster-force.ts`
- Create: `packages/graph-renderers/src/r3b/incremental.ts`
- Create: `packages/graph-renderers/src/r3b/index.ts`
- Modify: `packages/graph-renderers/src/index.ts`（加 `export * from './r3b';`）

- [ ] **Step 1: 创建 r3b/ 目录，从 tools/layout-lab/src/ 逐文件复制**

每个文件的内容直接从 lab 对应文件复制，调整 import 路径（`@listen-graphic/schema` 替代相对路径）。不改变任何逻辑。

具体映射：
- `incremental-types.ts` → `r3b/types.ts`（含 `IncrementalState`, `ClusterMatch`, `matchClusters`, `computePinK` 等）
- `cluster-partition.ts` → `r3b/partition.ts`
- `round3-types.ts` → `r3b/node-size.ts`（`computeNodeSize`, `computeAllNodeSizes`, `FORCE_PARAMS` 等）
- `force-core-v2.ts` → `r3b/force-core.ts`（`resolveOverlaps`, `CenterPos`）
- `cluster-force-layout.ts` → `r3b/cluster-force.ts`（`computeClusterForceLayout` + 内部 `layoutClusterForce`）
- `incremental-force.ts` → `r3b/incremental.ts`（`computeIncrementalLayout` + 内部 `resolveOverlapsWithMobility`）

每个文件的 import 调整：
- `@listen-graphic/schema` 保持不变（graph-renderers 已依赖它）
- lab 内部相对路径改为 r3b/ 内相对路径（如 `./types` `./force-core` `./node-size` `./partition` `./cluster-force`）
- `../../../apps/extension/src/sidepanel/graph-utils.ts` 和 `../../../packages/graph-renderers/src/hierarchy.ts` 这两个 lab 专用的 import 在 r3b/ 里不需要（cluster-force.ts 里 `layoutClusterForce` 是自包含的，不依赖产品 graph-utils）

**关键**：`cluster-force.ts` 里的 `layoutClusterForce` 函数当前 import 了 `buildStableReactFlowDebugGraph`——这个 import 在 r3b/ 里删掉，因为 r3b 布局不依赖 stable layout。

- [ ] **Step 2: 创建 r3b/index.ts**

```typescript
export * from './types';
export * from './partition';
export * from './node-size';
export * from './force-core';
export * from './cluster-force';
export * from './incremental';
```

- [ ] **Step 3: 修改 packages/graph-renderers/src/index.ts**

在末尾加：
```typescript
export * from './r3b';
```

- [ ] **Step 4: 写等价测试**

Create `packages/graph-renderers/src/r3b/equivalence.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computeIncrementalLayout } from './incremental';
import { createEmptyIncrementalState } from './types';
import type { MergedGraph } from '@listen-graphic/schema';
import fs from 'node:fs';
import path from 'node:path';

// 等价测试：提取后的 r3b 内核产出与 lab 版一致
// 用固定输入（非随机），验证 positions 确定性
describe('R3b 内核等价性', () => {
  it('确定性：相同输入相同输出', () => {
    const graph: MergedGraph = {
      sessionId: 'test', revision: 1, topics: [], updatedAt: 0,
      nodes: [
        { id: 'n1', type: 'claim', text: 'test claim', timestampMs: 0, status: 'confirmed' },
        { id: 'n2', type: 'reason', text: 'test reason', timestampMs: 1000, status: 'confirmed' },
        { id: 'n3', type: 'example', text: 'test example', timestampMs: 2000, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'supports' },
        { id: 'e2', source: 'n2', target: 'n3', type: 'example_of' },
      ],
    };

    const state1 = createEmptyIncrementalState();
    const result1 = computeIncrementalLayout(graph, state1);

    const state2 = createEmptyIncrementalState();
    const result2 = computeIncrementalLayout(graph, state2);

    // 相同输入必须产出完全相同的 positions
    for (const id of Object.keys(result1.positions)) {
      expect(result2.positions[id].cx).toBe(result1.positions[id].cx);
      expect(result2.positions[id].cy).toBe(result1.positions[id].cy);
    }
  });
});
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd packages/graph-renderers && npx vitest run src/r3b/equivalence.test.ts`
Expected: PASS

如果 graph-renderers 没有 vitest 配置，用 lab 的 vitest 配置跑：
Run: `cd tools/layout-lab/run && npx vitest run ../../../packages/graph-renderers/src/r3b/equivalence.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/graph-renderers/src/r3b/
git commit -m "feat(graph-renderers): 提取 R3b 内核到 packages/graph-renderers/src/r3b/"
```

---

## Task 2: NodeGeometry 契约 + computeRealNodeSize

**Files:**
- Create: `packages/graph-renderers/src/r3b/node-geometry.ts`
- Modify: `packages/graph-renderers/src/r3b/node-size.ts`（加 `computeRealNodeSize`）
- Create: `packages/graph-renderers/src/r3b/node-geometry.test.ts`

- [ ] **Step 1: 定义 NodeGeometry 类型 + computeRealNodeSize**

Create `packages/graph-renderers/src/r3b/node-geometry.ts`:

```typescript
import type { NodeType } from '@listen-graphic/schema';
import { truncateText } from './node-size';

export type NodeGeometry = {
  position: { x: number; y: number };  // top-left（React Flow 格式）
  size: { width: number; height: number };
};

export type NodeDisplayMode = 'readable' | 'compact';

// 覆盖真实卡片结构的尺寸计算（spec §5.3）
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

- [ ] **Step 2: 写单测**

Create `packages/graph-renderers/src/r3b/node-geometry.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computeRealNodeSize } from './node-geometry';

describe('computeRealNodeSize', () => {
  it('readable 模式：短文本（10字）不含 speaker/timestamp', () => {
    const s = computeRealNodeSize('短文本测试十个字', 'claim', false, false, 'readable');
    expect(s.width).toBeGreaterThanOrEqual(80);
    expect(s.width).toBeLessThanOrEqual(220);
    expect(s.height).toBeGreaterThanOrEqual(60);
  });

  it('readable 模式：长文本（50字）含 speaker + timestamp 高度更大', () => {
    const noExtra = computeRealNodeSize('x'.repeat(50), 'claim', false, false, 'readable');
    const withExtra = computeRealNodeSize('x'.repeat(50), 'claim', true, true, 'readable');
    expect(withExtra.height).toBeGreaterThan(noExtra.height);
    expect(withExtra.height - noExtra.height).toBeGreaterThanOrEqual(28); // speaker(14) + timestamp(14)
  });

  it('compact 模式：宽度范围 140-200', () => {
    const s = computeRealNodeSize('x'.repeat(30), 'reason', false, false, 'compact');
    expect(s.width).toBeGreaterThanOrEqual(140);
    expect(s.width).toBeLessThanOrEqual(200);
  });

  it('compact 高度 < readable 高度（同文本）', () => {
    const text = 'x'.repeat(40);
    const compact = computeRealNodeSize(text, 'claim', false, false, 'compact');
    const readable = computeRealNodeSize(text, 'claim', false, false, 'readable');
    expect(compact.height).toBeLessThanOrEqual(readable.height);
  });
});
```

- [ ] **Step 3: 运行测试 + commit**

```bash
cd tools/layout-lab/run && npx vitest run ../../../packages/graph-renderers/src/r3b/node-geometry.test.ts
git add packages/graph-renderers/src/r3b/node-geometry.ts packages/graph-renderers/src/r3b/node-geometry.test.ts
git commit -m "feat(graph-renderers): NodeGeometry 契约 + computeRealNodeSize"
```

---

## Task 3: resolveEdgeHandles + auto-tour 改用 NodeGeometry

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.ts`（`resolveEdgeHandles` 加可选 size 参数）
- Modify: `apps/extension/src/sidepanel/auto-tour-utils.ts`（bounds 用实际 size）
- Modify: `apps/extension/src/sidepanel/types.ts`（ReactFlowDebugNodeData 加 `nodeSize?`）

- [ ] **Step 1: 修改 resolveEdgeHandles 支持 NodeGeometry**

在 `graph-utils.ts` 中，`resolveEdgeHandles` 当前签名：
```typescript
export function resolveEdgeHandles(
  sourcePosition: StableNodePosition,
  targetPosition: StableNodePosition,
)
```

改为加可选 size 参数：
```typescript
export function resolveEdgeHandles(
  sourcePosition: StableNodePosition,
  targetPosition: StableNodePosition,
  sourceSize?: { width: number; height: number },
  targetSize?: { width: number; height: number },
)
```

在函数内部，所有用到 `STABLE_LAYOUT_CARD_WIDTH/HEIGHT` 的地方改为：
```typescript
const sw = sourceSize?.width ?? STABLE_LAYOUT_CARD_WIDTH;
const sh = sourceSize?.height ?? STABLE_LAYOUT_CARD_HEIGHT;
const tw = targetSize?.width ?? STABLE_LAYOUT_CARD_WIDTH;
const th = targetSize?.height ?? STABLE_LAYOUT_CARD_HEIGHT;
```

`getNodeRect` 同理加可选 size 参数。

- [ ] **Step 2: 修改 auto-tour-utils.ts bounds**

在 `auto-tour-utils.ts` 中，`STABLE_LAYOUT_CARD_WIDTH/HEIGHT` 改为从 node data 的 `nodeSize` 取：
```typescript
const w = node.data?.nodeSize?.width ?? STABLE_LAYOUT_CARD_WIDTH;
const h = node.data?.nodeSize?.height ?? STABLE_LAYOUT_CARD_HEIGHT;
```

- [ ] **Step 3: ReactFlowDebugNodeData 加 nodeSize 字段**

在 `types.ts` 中：
```typescript
export type ReactFlowDebugNodeData = {
  // ... 现有字段
  nodeSize?: { width: number; height: number };
};
```

- [ ] **Step 4: 运行现有测试确认无回归**

Run: `cd apps/extension && pnpm test:run`
Expected: 全部通过（因为 size 参数是可选的，不传时 fallback 到 220×132）

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/sidepanel/graph-utils.ts apps/extension/src/sidepanel/auto-tour-utils.ts apps/extension/src/sidepanel/types.ts
git commit -m "feat(extension): resolveEdgeHandles + auto-tour 支持可选 NodeGeometry"
```

---

## Task 4: Feature flag 基础设施

**Files:**
- Modify: `apps/extension/src/vite-env.d.ts`（加 `VITE_LAYOUT_ENGINE`）
- Create: `apps/extension/.env.r3b`
- Create: `apps/extension/.env.r3b-fixture-lab`
- Modify: `apps/extension/package.json`（加 `build:r3b` + `build:r3b:fixture-lab`）

- [ ] **Step 1: 更新 vite-env.d.ts**

在 `ImportMetaEnv` 接口加：
```typescript
readonly VITE_LAYOUT_ENGINE?: string;
```

- [ ] **Step 2: 创建 env 文件**

`.env.r3b`:
```
VITE_LAYOUT_ENGINE=r3b
```

`.env.r3b-fixture-lab`:
```
VITE_LAYOUT_ENGINE=r3b
VITE_FIXTURE_LAB=true
```

- [ ] **Step 3: 加 build 脚本**

在 `apps/extension/package.json` 的 scripts 加：
```json
"build:r3b": "vite build --mode r3b",
"build:r3b:fixture-lab": "vite build --mode r3b-fixture-lab",
```

- [ ] **Step 4: 验证三个 build 变体**

```bash
pnpm --filter extension build:r3b  # 应成功
pnpm --filter extension build:r3b:fixture-lab  # 应成功
# 验证 fixture API 只在 fixture-lab build 里
node -e "const f=require('fs').readFileSync('apps/extension/dist/sidepanel/sidepanel.js','utf8'); console.log('fixture API:', f.includes('__listenGraphicFixture') ? 'YES' : 'NO')"
```
Expected: `build:r3b` → NO；`build:r3b:fixture-lab` → YES

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/vite-env.d.ts apps/extension/.env.r3b apps/extension/.env.r3b-fixture-lab apps/extension/package.json
git commit -m "feat(extension): R3b feature flag（VITE_LAYOUT_ENGINE + 三 build 变体）"
```

---

## Task 5: r3b-layout.ts 适配层 + App.tsx 两层集成

**Files:**
- Create: `apps/extension/src/sidepanel/r3b-layout.ts`
- Modify: `apps/extension/src/sidepanel/App.tsx`（两层 useMemo + r3bStateRef）

> 这是最核心的 Task——实现 spec §2.2 的两层拆分。

- [ ] **Step 1: 创建 r3b-layout.ts**

```typescript
import type { MergedGraph, ViewType, EdgeType } from '@listen-graphic/schema';
import type { RendererGraph } from '@listen-graphic/graph-renderers';
import {
  computeIncrementalLayout,
  createEmptyIncrementalState,
  computeRealNodeSize,
  type IncrementalState,
  type NodeGeometry,
} from '@listen-graphic/graph-renderers';
import type { ReactFlowDebugNode, ReactFlowDebugEdge, DebugViewArtifact } from './types';
import type { StableNodePosition } from './types';
import { VIEW_EDGE_PRIORITIES } from './constants';
import { resolveEdgeHandles } from './graph-utils';

const isR3b = import.meta.env.VITE_LAYOUT_ENGINE === 'r3b';

export type R3bLayoutResult = {
  artifacts: Record<ViewType, DebugViewArtifact>;
  positions: Record<string, { cx: number; cy: number }>;
  sizes: Record<string, { width: number; height: number }>;
  nextState: IncrementalState;
};

// 层 1：Geometry Transition（只由 graph revision 触发）
export function buildR3bLayout(
  graph: MergedGraph,
  previousState: IncrementalState,
): R3bLayoutResult {
  // 幂等：相同 revision 直接返回
  if (previousState.appliedRevision === graph.revision && previousState.positions) {
    // 用已有 positions 重新装饰（不重算）
  }

  const result = computeIncrementalLayout(graph, previousState);

  // 算每个节点的真实尺寸
  const sizes: Record<string, { width: number; height: number }> = {};
  for (const n of graph.nodes) {
    sizes[n.id] = computeRealNodeSize(n.text, n.type, !!n.speaker, true, 'readable');
  }

  // 转换 center → top-left
  const nodeGeometries: Record<string, NodeGeometry> = {};
  for (const n of graph.nodes) {
    const cp = result.positions[n.id];
    const s = sizes[n.id];
    if (cp && s) {
      nodeGeometries[n.id] = {
        position: { x: cp.cx - s.width / 2, y: cp.cy - s.height / 2 },
        size: s,
      };
    }
  }

  // 为四个视图构建 artifacts（positions 相同，edges 按视图过滤）
  const artifacts = {} as Record<ViewType, DebugViewArtifact>;
  for (const view of ['causal', 'comparison', 'hierarchy', 'timeline'] as ViewType[]) {
    artifacts[view] = buildArtifactForView(graph, nodeGeometries, sizes, view);
  }

  return {
    artifacts,
    positions: result.positions,
    sizes,
    nextState: { ...result.state, appliedRevision: graph.revision },
  };
}

function buildArtifactForView(
  graph: MergedGraph,
  geometries: Record<string, NodeGeometry>,
  sizes: Record<string, { width: number; height: number }>,
  view: ViewType,
): DebugViewArtifact {
  const priorities = VIEW_EDGE_PRIORITIES[view] ?? VIEW_EDGE_PRIORITIES.causal;

  const nodes: ReactFlowDebugNode[] = graph.nodes
    .filter((n) => geometries[n.id])
    .map((n) => ({
      id: n.id,
      type: 'graphNode' as const,
      position: geometries[n.id].position,
      data: {
        label: n.text,
        nodeType: n.type,
        speaker: n.speaker,
        timestampMs: n.timestampMs,
        status: n.status,
        nodeSize: sizes[n.id],
        isActive: false,
      },
    }));

  const edges: ReactFlowDebugEdge[] = graph.edges
    .filter((e) => {
      const priority = priorities[e.type as EdgeType];
      return priority !== 'hidden';
    })
    .filter((e) => geometries[e.source] && geometries[e.target])
    .map((e) => {
      const sg = geometries[e.source];
      const tg = geometries[e.target];
      const handles = resolveEdgeHandles(sg.position, tg.position, sg.size, tg.size);
      const priority = priorities[e.type as EdgeType] ?? 'secondary';
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'default' as const,
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        label: e.type,
        style: {
          stroke: e.type === 'supports' ? '#10b981' : e.type === 'opposes' ? '#ef4444' : e.type === 'causes' ? '#f59e0b' : '#6b7280',
          opacity: priority === 'primary' ? 1 : 0.35,
        },
        animated: e.type === 'causes' && priority === 'primary',
      };
    });

  return {
    rendererGraph: {} as RendererGraph,  // R3b 不用 renderer graph
    layoutDiagnostics: { reusedPositions: 0, newPositions: nodes.length, movedPositions: 0 },
    reactFlow: { nodes, edges },
  };
}
```

- [ ] **Step 2: 修改 App.tsx 加两层 useMemo**

在 `App.tsx` 中：

1. 加 r3bStateRef：
```typescript
const r3bStateRef = useRef<IncrementalState>(createEmptyIncrementalState());
```

2. 替换现有 `layoutBuild` useMemo（第 611-619 行）为两层：

```typescript
const isR3b = import.meta.env.VITE_LAYOUT_ENGINE === 'r3b';

// 层 1：Geometry Transition（只依赖 graph）
const r3bLayout = useMemo(() => {
  if (!isR3b) return null;
  return buildR3bLayout(panel.graph, r3bStateRef.current);
}, [panel.graph]);

useLayoutEffect(() => {
  if (r3bLayout) {
    r3bStateRef.current = r3bLayout.nextState;
  }
}, [r3bLayout]);

// 层 2：Artifact（stable layout 或 R3b decoration）
const layoutBuild = useMemo(() => {
  if (isR3b && r3bLayout) {
    return { artifacts: r3bLayout.artifacts, nextLayoutCache: layoutCacheRef.current };
  }
  return buildDebugViewArtifacts({
    graph: panel.graph,
    currentTimeMs: panel.currentTimeMs,
    selectedNodeId: panel.selectedNodeId,
    previousLayoutCache: layoutCacheRef.current,
  });
}, [panel.graph, panel.currentTimeMs, panel.selectedNodeId, r3bLayout]);
```

3. session 切换时重置 r3bStateRef（在现有 `resetLayoutCache` 附近）：
```typescript
r3bStateRef.current = createEmptyIncrementalState();
```

- [ ] **Step 3: 在 IncrementalState 加 appliedRevision**

在 `packages/graph-renderers/src/r3b/types.ts` 的 `IncrementalState` 加：
```typescript
appliedRevision?: number;
```

- [ ] **Step 4: 验证编译**

Run: `cd apps/extension && pnpm exec tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 5: 验证现有测试无回归**

Run: `cd apps/extension && pnpm test:run`
Expected: 全部通过（isR3b=false 时走原有路径）

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/sidepanel/r3b-layout.ts apps/extension/src/sidepanel/App.tsx packages/graph-renderers/src/r3b/types.ts
git commit -m "feat(extension): R3b 两层集成（geometry transition + artifact decoration）"
```

---

## Task 6: GraphNodeCard adaptiveSize 分支

**Files:**
- Modify: `packages/ui/src/GraphNodeCard.tsx`

- [ ] **Step 1: 修改 GraphNodeCard 支持 adaptiveSize**

在 `GraphNodeCard.tsx` 中，找到 `minWidth/maxWidth` 的 style（约第 61-62 行）：

```typescript
// 现有
minWidth: isCompact ? 140 : 220,
maxWidth: isCompact ? 200 : 260,
```

改为：
```typescript
// R3b 模式：用 data.nodeSize 设固定宽高；非 R3b：保留 minWidth/maxWidth
...(data.nodeSize
  ? { width: data.nodeSize.width, height: data.nodeSize.height }
  : { minWidth: isCompact ? 140 : 220, maxWidth: isCompact ? 200 : 260 }),
```

加 `box-sizing: border-box; overflow: hidden;` 到 style。

`GraphNodeCardData`（`packages/ui/src/types.ts`）加 `nodeSize?` 字段（如果 Task 3 还没加的话）。

- [ ] **Step 2: 验证现有测试**

Run: `cd apps/extension && pnpm test:run`
Expected: 全部通过（nodeSize 是可选的，不传时用现有逻辑）

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/GraphNodeCard.tsx packages/ui/src/types.ts
git commit -m "feat(ui): GraphNodeCard 支持 adaptiveSize（R3b 模式）"
```

---

## Task 7: 验证（真实 React Flow 截图 + 指标 + 回归）

**Files:**
- Create: `tools/layout-lab/src/round5-verify.ts`

> 这个 Task 用 Playwright 截真实 sidepanel（build:r3b:fixture-lab），灌入真实图，截图 + 算指标。

- [ ] **Step 1: 构建 r3b-fixture-lab 版扩展**

```bash
pnpm --filter extension build:r3b:fixture-lab
```

- [ ] **Step 2: 验证 fixture API + R3b 都在 bundle 里**

```bash
node -e "const f=require('fs').readFileSync('apps/extension/dist/sidepanel/sidepanel.js','utf8'); console.log('fixture:', f.includes('__listenGraphicFixture') ? 'YES' : 'NO'); console.log('r3b:', f.includes('computeIncrementalLayout') || f.includes('buildR3bLayout') ? 'YES' : 'NO')"
```
Expected: fixture YES, r3b YES

- [ ] **Step 3: 截 4 条代表样本**

复用 `e2e-helpers.ts` 的 `launchExtensionContext` + `waitForFixtureGraph` + `loadGraph`：

```typescript
// tools/layout-lab/src/round5-verify.ts 核心流程
import { launchExtensionContext, openSidepanelPage, waitForFixtureReady } from './e2e-helpers';

const SAMPLE = [49, 41, 32, 18];

async function verify() {
  const { context, extensionId } = await launchExtensionContext('.tmp/r3b-verify');
  const page = await openSidepanelPage(context, extensionId);
  await waitForFixtureReady(page);

  for (const idx of SAMPLE) {
    const graph = dump[idx];
    await page.evaluate((g) => globalThis.__listenGraphicFixture?.loadGraph(g), graph);
    await waitForFixtureGraph(page, graph.nodes.length);
    await page.waitForTimeout(500);
    // 点"适配视图"按钮触发 fitView
    const fitBtn = page.getByRole('button', { name: '适配视图' });
    if (await fitBtn.isVisible().catch(() => false)) await fitBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `outputs/round5/real-${idx}.png`, fullPage: true });

    // 读取真实 DOM bounds 算指标
    const metrics = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[data-testid="graph-node"], .react-flow__node');
      // ... 算 avgEdgeLength, edgeCrossings, overlaps 等
    });
    console.log(`#${idx}:`, metrics);
  }

  await context.close();
}
```

- [ ] **Step 4: 人眼审核截图**

打开 `tools/layout-lab/outputs/round5/` 下的截图，确认：
- 节点尺寸自适应合理
- 大图关系可读
- 小图没被破坏

- [ ] **Step 5: 回归测试**

```bash
# prod build 不受影响
pnpm --filter extension build
cd apps/extension && pnpm test:run
# 应全部通过
```

- [ ] **Step 6: Commit**

```bash
git add tools/layout-lab/src/round5-verify.ts
git commit -m "test(layout-lab): Round 5 验证脚本（真实 React Flow 截图 + 指标）"
```

---

## 完成标准

- [ ] 7 个 Task 全部落地
- [ ] 全套测试通过（graph-renderers + extension）
- [ ] `build:r3b` 和 `build:r3b:fixture-lab` 成功
- [ ] `build`（prod）行为零回归
- [ ] 真实 React Flow 截图生成且视觉合理
- [ ] 增量稳定：播放/选中/切视图时旧节点不动
- [ ] 性能：271 节点计算 < 200ms（p95）
