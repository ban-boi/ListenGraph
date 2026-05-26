# 图谱视图模式优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简视图模式（移除 flow、timeline 降级为排序选项），添加边过滤让各模式视觉上真正不同，修复评分算法，causal 使用拓扑排序。

**Architecture:** 将"视图模式"从"排序方式"中解耦。视图模式（causal/comparison/hierarchy）决定边过滤和车道布局；排序方式（default/chronological）决定节点排列顺序。评分算法改用比例+拓扑奖励替代原始计数。

**Tech Stack:** TypeScript, Vitest, React Flow

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/schema/src/graph.ts` | Modify | 从 ViewType 移除 `flow` |
| `packages/graph-renderers/src/flow.ts` | Delete | 移除流程渲染器 |
| `packages/graph-renderers/src/index.ts` | Modify | 移除 flow 导出 |
| `packages/graph-renderers/src/causal.ts` | Modify | 使用拓扑排序 |
| `packages/graph-renderers/src/topo-sort.test.ts` | Create | 拓扑排序测试 |
| `packages/domain/src/view-selection.ts` | Modify | 重写评分算法 |
| `packages/domain/src/view-selection.test.ts` | Create | 评分算法测试 |
| `apps/extension/src/sidepanel/constants.ts` | Modify | 移除 flow，添加排序模式常量和边优先级配置 |
| `apps/extension/src/sidepanel/types.ts` | Modify | 添加边优先级类型 |
| `apps/extension/src/sidepanel/graph-utils.ts` | Modify | 移除 flow 引用，添加边过滤逻辑，接受排序模式参数 |
| `apps/extension/src/sidepanel/App.tsx` | Modify | 移除 flow 按钮，添加排序切换 UI，传递排序模式 |
| `apps/extension/src/sidepanel/graph-utils.test.ts` | Modify | 添加边优先级测试 |

---

### Task 1: 移除 flow 视图

**Files:**
- Modify: `packages/schema/src/graph.ts:17-22`
- Delete: `packages/graph-renderers/src/flow.ts`
- Modify: `packages/graph-renderers/src/index.ts`
- Modify: `apps/extension/src/sidepanel/constants.ts:52-66`
- Modify: `apps/extension/src/sidepanel/graph-utils.ts:16,57-69`

- [ ] **Step 1: 从 ViewType 联合类型中移除 `flow`**

`packages/schema/src/graph.ts` 修改 ViewType：

```ts
export type ViewType =
  | 'causal'
  | 'timeline'
  | 'comparison'
  | 'hierarchy';
```

- [ ] **Step 2: 删除 flow 渲染器**

删除文件 `packages/graph-renderers/src/flow.ts`。

- [ ] **Step 3: 更新 graph-renderers 导出**

`packages/graph-renderers/src/index.ts`：

```ts
export * from './types';
export * from './causal';
export * from './timeline';
export * from './comparison';
export * from './hierarchy';
```

- [ ] **Step 4: 更新 constants.ts**

```ts
export const VIEW_TYPES: ViewType[] = [
  'causal',
  'timeline',
  'comparison',
  'hierarchy',
];

export const VIEW_LABELS: Record<ViewType, string> = {
  causal: '因果',
  timeline: '时间线',
  comparison: '对比',
  hierarchy: '层级',
};
```

- [ ] **Step 5: 更新 graph-utils.ts — 移除 flow 引用**

移除 `toFlowRendererGraph` 的 import，在 `getRendererGraph` 中移除 `case 'flow'`（`default` 分支已覆盖 causal）。

`createEmptyStableLayoutCache` 移除 `flow` 条目：

```ts
function createEmptyStableLayoutCache(): StableLayoutCache {
  return {
    timeline: { positions: {} },
    causal: { positions: {} },
    comparison: { positions: {} },
    hierarchy: { positions: {} },
  };
}
```

- [ ] **Step 6: 运行类型检查确认无编译错误**

Run: `pnpm typecheck`
Expected: 通过，无 TS 报错

- [ ] **Step 7: 运行现有测试**

Run: `pnpm test:run`
Expected: 全部通过

- [ ] **Step 8: Commit**

```bash
git add packages/schema/src/graph.ts packages/graph-renderers/src/ apps/extension/src/sidepanel/constants.ts apps/extension/src/sidepanel/graph-utils.ts
git commit -m "refactor: 移除 flow 视图（与 timeline 完全重复）"
```

---

### Task 2: 重写评分算法

**Files:**
- Modify: `packages/domain/src/view-selection.ts`
- Create: `packages/domain/src/view-selection.test.ts`

- [ ] **Step 1: 编写评分算法测试**

`packages/domain/src/view-selection.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { scoreViews, pickDefaultView } from './view-selection';
import type { MergedGraph } from '@listen-graphic/schema';

function makeGraph(edges: Array<{ type: string }>, speakers?: string[]): MergedGraph {
  const nodeCount = speakers ? speakers.length : edges.length + 1;
  return {
    sessionId: 'test',
    revision: 1,
    topics: [],
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `n${i}`,
      type: 'claim' as const,
      text: `node ${i}`,
      timestampMs: i * 1000,
      status: 'draft' as const,
      ...(speakers?.[i] ? { speaker: speakers[i] } : {}),
    })),
    edges: edges.map((e, i) => ({
      id: `e${i}`,
      source: `n${i}`,
      target: `n${i + 1}`,
      type: e.type as any,
    })),
    updatedAt: Date.now(),
  };
}

describe('scoreViews', () => {
  it('纯 follows 边：所有视图分数都很低', () => {
    const graph = makeGraph([
      { type: 'follows' }, { type: 'follows' }, { type: 'follows' },
    ]);
    const scores = scoreViews(graph);
    expect(scores.timeline).toBeLessThanOrEqual(1);
    expect(scores.causal).toBeLessThanOrEqual(1);
  });

  it('有 causes 边：causal 分数显著高于其他', () => {
    const graph = makeGraph([
      { type: 'causes' }, { type: 'causes' },
    ]);
    const scores = scoreViews(graph);
    expect(scores.causal).toBeGreaterThan(scores.comparison);
    expect(scores.causal).toBeGreaterThan(scores.hierarchy);
  });

  it('有 opposes 边 + 多 speaker：comparison 分数最高', () => {
    const graph = makeGraph(
      [{ type: 'opposes' }, { type: 'supports' }],
      ['主持人', '嘉宾A'],
    );
    const scores = scoreViews(graph);
    expect(scores.comparison).toBeGreaterThan(scores.causal);
    expect(scores.comparison).toBeGreaterThan(scores.hierarchy);
  });

  it('有 example_of 边：hierarchy 分数较高', () => {
    const graph = makeGraph([
      { type: 'example_of' }, { type: 'example_of' }, { type: 'supports' },
    ]);
    const scores = scoreViews(graph);
    expect(scores.hierarchy).toBeGreaterThan(scores.comparison);
  });

  it('多跳因果链给 causal 额外加分', () => {
    const graph: MergedGraph = {
      sessionId: 'test',
      revision: 1,
      topics: [],
      nodes: [
        { id: 'n0', type: 'claim', text: 'A', timestampMs: 0, status: 'draft' },
        { id: 'n1', type: 'claim', text: 'B', timestampMs: 1000, status: 'draft' },
        { id: 'n2', type: 'claim', text: 'C', timestampMs: 2000, status: 'draft' },
      ],
      edges: [
        { id: 'e0', source: 'n0', target: 'n1', type: 'causes' },
        { id: 'e1', source: 'n1', target: 'n2', type: 'causes' },
      ],
      updatedAt: Date.now(),
    };
    const scores = scoreViews(graph);
    expect(scores.causal).toBeGreaterThan(5);
  });
});

describe('pickDefaultView', () => {
  it('空图返回 causal', () => {
    const graph: MergedGraph = {
      sessionId: 'test', revision: 1, topics: [], nodes: [], edges: [],
      updatedAt: Date.now(),
    };
    expect(pickDefaultView(graph)).toBe('causal');
  });

  it('有因果链返回 causal', () => {
    const graph = makeGraph([{ type: 'causes' }, { type: 'supports' }]);
    expect(pickDefaultView(graph)).toBe('causal');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/domain && npx vitest run src/view-selection.test.ts`
Expected: 测试失败（新评分逻辑还未实现）

- [ ] **Step 3: 实现新评分算法**

`packages/domain/src/view-selection.ts`：

```ts
import type { MergedGraph, ViewType } from '@listen-graphic/schema';

const VIEW_NAMES: ViewType[] = ['timeline', 'causal', 'comparison', 'hierarchy'];

/** 检测是否存在多跳因果链（A→B→C） */
function hasMultiHopCausalChain(graph: MergedGraph): boolean {
  const causesTargets = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === 'causes') causesTargets.add(edge.target);
  }
  for (const edge of graph.edges) {
    if (edge.type === 'causes' && causesTargets.has(edge.source)) return true;
  }
  return false;
}

/** 检测是否存在跨 speaker 的边 */
function hasCrossSpeakerEdges(graph: MergedGraph): boolean {
  const speakerMap = new Map<string, string | undefined>();
  for (const node of graph.nodes) {
    speakerMap.set(node.id, node.speaker);
  }
  for (const edge of graph.edges) {
    const sourceSpeaker = speakerMap.get(edge.source);
    const targetSpeaker = speakerMap.get(edge.target);
    if (sourceSpeaker && targetSpeaker && sourceSpeaker !== targetSpeaker) return true;
  }
  return false;
}

/** 统计不重复 speaker 数量 */
function countUniqueSpeakers(graph: MergedGraph): number {
  const speakers = new Set<string>();
  for (const node of graph.nodes) {
    if (node.speaker) speakers.add(node.speaker);
  }
  return speakers.size;
}

/** 检测是否有 claim 节点作为多条边的源 */
function hasClaimWithMultipleChildren(graph: MergedGraph): boolean {
  for (const node of graph.nodes) {
    if (node.type !== 'claim' && node.type !== 'conclusion') continue;
    let count = 0;
    for (const edge of graph.edges) {
      if (edge.source === node.id && (edge.type === 'supports' || edge.type === 'example_of')) {
        count++;
      }
    }
    if (count >= 2) return true;
  }
  return false;
}

export function scoreViews(graph: MergedGraph): Record<ViewType, number> {
  const scores: Record<ViewType, number> = {
    timeline: 0,
    causal: 0,
    comparison: 0,
    hierarchy: 0,
  };

  const totalEdges = graph.edges.length || 1;
  let causesCount = 0;
  let opposesCount = 0;
  let supportsCount = 0;
  let exampleOfCount = 0;

  for (const edge of graph.edges) {
    switch (edge.type) {
      case 'causes': causesCount++; break;
      case 'opposes': opposesCount++; break;
      case 'supports': supportsCount++; break;
      case 'example_of': exampleOfCount++; break;
    }
  }

  // 比例化评分（乘以 10 方便阅读）
  scores.causal = (causesCount * 3 + supportsCount * 1) / totalEdges * 10;
  scores.comparison = (opposesCount * 3) / totalEdges * 10;
  scores.hierarchy = (exampleOfCount * 2 + supportsCount * 1) / totalEdges * 10;
  // timeline 不再参与有意义的评分
  scores.timeline = 0;

  // 拓扑奖励
  if (hasMultiHopCausalChain(graph)) scores.causal += 3;
  if (hasClaimWithMultipleChildren(graph)) scores.hierarchy += 2;

  const numSpeakers = countUniqueSpeakers(graph);
  if (numSpeakers >= 2) {
    scores.comparison += 3;
    if (hasCrossSpeakerEdges(graph)) scores.comparison += 2;
  }

  return scores;
}

export function pickDefaultView(graph: MergedGraph): ViewType {
  if (graph.edges.length === 0 || graph.nodes.length === 0) return 'causal';

  const scores = scoreViews(graph);
  let best: ViewType = 'causal';
  let bestScore = -1;

  for (const view of VIEW_NAMES) {
    if (scores[view] > bestScore) {
      bestScore = scores[view];
      best = view;
    }
  }

  return best;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/domain && npx vitest run src/view-selection.test.ts`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/view-selection.ts packages/domain/src/view-selection.test.ts
git commit -m "refactor(domain): 重写视图评分算法 — 比例化+拓扑奖励，移除 follows 权重"
```

---

### Task 3: 添加边过滤

**Files:**
- Modify: `apps/extension/src/sidepanel/types.ts`
- Modify: `apps/extension/src/sidepanel/constants.ts`
- Modify: `apps/extension/src/sidepanel/graph-utils.ts`
- Modify: `apps/extension/src/sidepanel/graph-utils.test.ts`

- [ ] **Step 1: 定义边优先级类型**

在 `apps/extension/src/sidepanel/types.ts` 末尾添加：

```ts
// ===== 边过滤 =====

export type EdgePriority = 'primary' | 'secondary' | 'hidden';
```

- [ ] **Step 2: 添加边优先级配置**

在 `apps/extension/src/sidepanel/constants.ts` 的 `VIEW_LABELS` 之后添加：

```ts
import type { EdgePriority } from './types';

export const VIEW_EDGE_PRIORITIES: Record<ViewType, Record<string, EdgePriority>> = {
  causal: {
    causes: 'primary',
    supports: 'primary',
    opposes: 'secondary',
    example_of: 'secondary',
    follows: 'hidden',
  },
  comparison: {
    opposes: 'primary',
    supports: 'primary',
    causes: 'secondary',
    example_of: 'hidden',
    follows: 'hidden',
  },
  hierarchy: {
    example_of: 'primary',
    supports: 'primary',
    causes: 'secondary',
    opposes: 'hidden',
    follows: 'hidden',
  },
  timeline: {
    follows: 'primary',
    causes: 'primary',
    supports: 'secondary',
    opposes: 'secondary',
    example_of: 'secondary',
  },
};
```

- [ ] **Step 3: 编写边过滤测试**

在 `apps/extension/src/sidepanel/graph-utils.test.ts` 末尾追加：

```ts
import { VIEW_EDGE_PRIORITIES } from './constants';
import type { ViewType } from '@listen-graphic/schema';

describe('VIEW_EDGE_PRIORITIES', () => {
  it('causal 视图隐藏 follows 边', () => {
    expect(VIEW_EDGE_PRIORITIES.causal.follows).toBe('hidden');
  });

  it('causal 视图将 causes 设为 primary', () => {
    expect(VIEW_EDGE_PRIORITIES.causal.causes).toBe('primary');
  });

  it('hierarchy 视图隐藏 opposes 和 follows', () => {
    expect(VIEW_EDGE_PRIORITIES.hierarchy.opposes).toBe('hidden');
    expect(VIEW_EDGE_PRIORITIES.hierarchy.follows).toBe('hidden');
  });

  it('comparison 视图隐藏 follows 和 example_of', () => {
    expect(VIEW_EDGE_PRIORITIES.comparison.follows).toBe('hidden');
    expect(VIEW_EDGE_PRIORITIES.comparison.example_of).toBe('hidden');
  });

  it('每个视图的五种边类型都有定义', () => {
    const edgeTypes = ['supports', 'opposes', 'causes', 'follows', 'example_of'];
    const views: ViewType[] = ['causal', 'timeline', 'comparison', 'hierarchy'];
    for (const view of views) {
      for (const et of edgeTypes) {
        expect(VIEW_EDGE_PRIORITIES[view][et]).toBeDefined();
      }
    }
  });
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/extension && npx vitest run src/sidepanel/graph-utils.test.ts`
Expected: 全部通过

- [ ] **Step 5: 在 graph-utils.ts 应用边过滤**

在文件顶部添加 import：

```ts
import { VIEW_EDGE_PRIORITIES } from './constants';
```

`buildStableReactFlowDebugGraph` 函数中，定位到创建 `edges` 的代码块（原约 307-331 行），替换为：

```ts
  const edgePriorities = VIEW_EDGE_PRIORITIES[params.view] ?? VIEW_EDGE_PRIORITIES.causal;

  const edges: ReactFlowDebugEdge[] = params.rendererGraph.edges
    .filter((edge) => {
      if (!positions[edge.source] || !positions[edge.target]) return false;
      const priority = edgePriorities[edge.relation];
      return priority !== 'hidden';
    })
    .map((edge) => {
      const handles = resolveEdgeHandles(positions[edge.source], positions[edge.target]);
      const priority = edgePriorities[edge.relation] ?? 'secondary';
      const isPrimary = priority === 'primary';
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'default' as const,
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        label: edge.relation,
        style: {
          stroke:
            edge.relation === 'supports'
              ? '#10b981'
              : edge.relation === 'opposes'
                ? '#ef4444'
                : edge.relation === 'causes'
                  ? '#f59e0b'
                  : '#6b7280',
          opacity: isPrimary ? 1 : 0.35,
        },
        animated: edge.relation === 'causes' && isPrimary,
      };
    });
```

- [ ] **Step 6: 运行类型检查和测试**

Run: `pnpm typecheck && pnpm test:run`
Expected: 全部通过

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/sidepanel/constants.ts apps/extension/src/sidepanel/types.ts apps/extension/src/sidepanel/graph-utils.ts apps/extension/src/sidepanel/graph-utils.test.ts
git commit -m "feat(sidepanel): 添加视图边过滤 — 各模式隐藏/淡化无关边类型"
```

---

### Task 4: 添加排序切换 UI

**Files:**
- Modify: `apps/extension/src/sidepanel/constants.ts`
- Modify: `apps/extension/src/sidepanel/graph-utils.ts`
- Modify: `apps/extension/src/sidepanel/App.tsx`

- [ ] **Step 1: 添加排序模式常量**

在 `apps/extension/src/sidepanel/constants.ts` 末尾添加：

```ts
export type NodeSortMode = 'default' | 'chronological';

export const SORT_MODE_LABELS: Record<NodeSortMode, string> = {
  default: '默认',
  chronological: '按时间',
};
```

- [ ] **Step 2: 修改 getRendererGraph 接受排序模式**

`apps/extension/src/sidepanel/graph-utils.ts` 中 `getRendererGraph` 添加 `sortMode` 参数：

```ts
import type { NodeSortMode } from './constants';

function getRendererGraph(
  graph: MergedGraph,
  view: ViewType,
  sortMode: NodeSortMode = 'default',
): RendererGraph {
  let rendererGraph: RendererGraph;
  switch (view) {
    case 'timeline':
      rendererGraph = toTimelineRendererGraph(graph);
      break;
    case 'comparison':
      rendererGraph = toComparisonRendererGraph(graph);
      break;
    case 'hierarchy':
      rendererGraph = toHierarchyRendererGraph(graph);
      break;
    default:
      rendererGraph = toCausalRendererGraph(graph);
      break;
  }

  if (sortMode === 'chronological') {
    const sortedNodes = [...rendererGraph.nodes].sort(
      (a, b) => a.timestampMs - b.timestampMs,
    );
    return { ...rendererGraph, nodes: sortedNodes };
  }

  return rendererGraph;
}
```

- [ ] **Step 3: 修改 buildDebugViewArtifacts 接受排序模式**

`buildDebugViewArtifacts` 签名添加 `sortMode`：

```ts
function buildDebugViewArtifacts(params: {
  graph: MergedGraph;
  currentTimeMs: number;
  selectedNodeId: string | null;
  previousLayoutCache: StableLayoutCache;
  sortMode: NodeSortMode;
}) {
  const rendererGraphs = VIEW_TYPES.reduce(
    (acc, view) => {
      acc[view] = getRendererGraph(params.graph, view, params.sortMode);
      return acc;
    },
    {} as Record<ViewType, RendererGraph>,
  );

  return buildReactFlowDebugGraph({
    rendererGraphs,
    currentTimeMs: params.currentTimeMs,
    selectedNodeId: params.selectedNodeId,
    previousLayoutCache: params.previousLayoutCache,
  });
}
```

- [ ] **Step 4: 在 App.tsx 添加排序状态**

在现有 import 中添加：

```ts
import { SORT_MODE_LABELS } from './constants';
import type { NodeSortMode } from './constants';
```

在 `const [userViewOverride, setUserViewOverride]` 附近添加：

```ts
const [nodeSortMode, setNodeSortMode] = useState<NodeSortMode>('default');
```

修改 `buildDebugViewArtifacts` 调用（约 425-433 行），添加 `sortMode`：

```ts
const layoutBuild = useMemo(
  () => buildDebugViewArtifacts({
    graph: panel.graph,
    currentTimeMs: panel.currentTimeMs,
    selectedNodeId: panel.selectedNodeId,
    previousLayoutCache: layoutCacheRef.current,
    sortMode: nodeSortMode,
  }),
  [panel.currentTimeMs, panel.graph, panel.selectedNodeId, nodeSortMode],
);
```

- [ ] **Step 5: 添加排序切换 UI，从视图按钮移除 timeline**

视图按钮区域（约 647 行），将 `VIEW_TYPES.map` 改为过滤掉 timeline：

```tsx
{VIEW_TYPES.filter((v) => v !== 'timeline').map((v) => (
```

在同一 `</div>` 结束前（视图按钮之后），添加排序切换：

```tsx
      {/* 排序切换 */}
      <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
        {(['default', 'chronological'] as NodeSortMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setNodeSortMode(mode)}
            style={{
              padding: '2px 6px', borderRadius: 3, fontSize: 10,
              border: nodeSortMode === mode ? '1.5px solid #6b7280' : '1px solid #e5e7eb',
              backgroundColor: nodeSortMode === mode ? '#f3f4f6' : 'white',
              color: '#6b7280',
              cursor: 'pointer',
            }}
          >
            {SORT_MODE_LABELS[mode]}
          </button>
        ))}
      </div>
```

- [ ] **Step 6: 运行类型检查和测试**

Run: `pnpm typecheck && pnpm test:run`
Expected: 全部通过

- [ ] **Step 7: 手动验证**

Run: `pnpm dev:ext`，在 Chrome 中加载扩展，确认：
- 视图按钮只显示：因果、对比、层级
- 排序按钮（默认/按时间）出现在视图按钮旁
- 点击"按时间"后节点按时间戳排序
- 各视图下不同边类型有不同可见性

- [ ] **Step 8: Commit**

```bash
git add apps/extension/src/sidepanel/constants.ts apps/extension/src/sidepanel/graph-utils.ts apps/extension/src/sidepanel/App.tsx
git commit -m "feat(sidepanel): 添加排序切换 UI，timeline 降级为排序选项"
```

---

### Task 5: causal 视图使用拓扑排序

**Files:**
- Modify: `packages/graph-renderers/src/causal.ts`
- Create: `packages/graph-renderers/src/topo-sort.test.ts`

- [ ] **Step 1: 编写拓扑排序测试**

`packages/graph-renderers/src/topo-sort.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { topologicalSort } from './causal';
import type { RendererNode, RendererEdge } from './types';

function n(id: string, ms: number): RendererNode {
  return { id, label: id, type: 'claim', speaker: undefined, timestampMs: ms, status: 'draft' };
}

function e(source: string, target: string, relation: RendererEdge['relation'] = 'supports'): RendererEdge {
  return { id: `e-${source}-${target}`, source, target, relation };
}

describe('topologicalSort', () => {
  it('空节点返回空数组', () => {
    expect(topologicalSort([], [])).toEqual([]);
  });

  it('单个节点无边', () => {
    const nodes = [n('a', 0)];
    expect(topologicalSort(nodes, []).map((nd) => nd.id)).toEqual(['a']);
  });

  it('线性链 A→B→C 按拓扑序排列', () => {
    const nodes = [n('c', 2000), n('a', 0), n('b', 1000)];
    const edges = [e('a', 'b', 'causes'), e('b', 'c', 'causes')];
    expect(topologicalSort(nodes, edges).map((nd) => nd.id)).toEqual(['a', 'b', 'c']);
  });

  it('无连接的节点按时间戳排列', () => {
    const nodes = [n('c', 2000), n('a', 0)];
    expect(topologicalSort(nodes, []).map((nd) => nd.id)).toEqual(['a', 'c']);
  });

  it('有环时按时间戳兜底（不无限循环）', () => {
    const nodes = [n('a', 0), n('b', 1000)];
    const edges = [e('a', 'b', 'supports'), e('b', 'a', 'supports')];
    const result = topologicalSort(nodes, edges);
    expect(result).toHaveLength(2);
    expect(result.map((nd) => nd.id)).toEqual(['a', 'b']);
  });

  it('忽略 follows 边（不参与拓扑）', () => {
    const nodes = [n('a', 0), n('b', 1000)];
    const edges = [e('a', 'b', 'follows')];
    // follows 不参与依赖图，节点按时间戳排列
    expect(topologicalSort(nodes, edges).map((nd) => nd.id)).toEqual(['a', 'b']);
  });

  it('钻石形依赖 A→B, A→C, B→D, C→D', () => {
    const nodes = [n('d', 3000), n('b', 1000), n('a', 0), n('c', 2000)];
    const edges = [e('a', 'b'), e('a', 'c'), e('b', 'd'), e('c', 'd')];
    const result = topologicalSort(nodes, edges).map((nd) => nd.id);
    expect(result[0]).toBe('a');
    expect(result[3]).toBe('d');
    expect(result).toContain('b');
    expect(result).toContain('c');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/graph-renderers && npx vitest run src/topo-sort.test.ts`
Expected: 失败，`topologicalSort` 未导出

- [ ] **Step 3: 实现拓扑排序并更新 causal 渲染器**

`packages/graph-renderers/src/causal.ts`：

```ts
import type { MergedGraph } from '@listen-graphic/schema';
import type { RendererGraph, RendererNode, RendererEdge } from './types';

/**
 * 拓扑排序（Kahn 算法），带环检测和时间戳兜底。
 * 只考虑结构性边类型（causes, supports, example_of）构建依赖图。
 */
export function topologicalSort(
  nodes: RendererNode[],
  edges: RendererEdge[],
): RendererNode[] {
  if (nodes.length <= 1) return nodes;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));

  const structuralEdgeTypes = new Set(['causes', 'supports', 'example_of']);
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!structuralEdgeTypes.has(edge.relation)) continue;
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // 入度为 0 的节点作为起始队列，按时间戳排序保证稳定
  const queue: string[] = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => (nodeMap.get(a)?.timestampMs ?? 0) - (nodeMap.get(b)?.timestampMs ?? 0));

  const sorted: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    sorted.push(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0 && !visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
    // 按时间戳排序队列保证稳定
    queue.sort(
      (a, b) => (nodeMap.get(a)?.timestampMs ?? 0) - (nodeMap.get(b)?.timestampMs ?? 0),
    );
  }

  // 环中的节点追加到末尾（按时间戳）
  const unvisited = nodes
    .filter((n) => !visited.has(n.id))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  for (const node of unvisited) {
    sorted.push(node.id);
  }

  return sorted.map((id) => nodeMap.get(id)!).filter(Boolean);
}

export function toCausalRendererGraph(graph: MergedGraph): RendererGraph {
  const baseNodes: RendererNode[] = graph.nodes.map((n) => ({
    id: n.id,
    label: n.text,
    type: n.type,
    speaker: n.speaker,
    timestampMs: n.timestampMs,
    status: n.status,
  }));

  const baseEdges: RendererEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    relation: e.type,
  }));

  const sortedNodes = topologicalSort(baseNodes, baseEdges);

  return {
    viewType: 'causal',
    nodes: sortedNodes,
    edges: baseEdges,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/graph-renderers && npx vitest run src/topo-sort.test.ts`
Expected: 全部通过

- [ ] **Step 5: 运行全部测试**

Run: `pnpm test:run`
Expected: 全部通过

- [ ] **Step 6: Commit**

```bash
git add packages/graph-renderers/src/causal.ts packages/graph-renderers/src/topo-sort.test.ts
git commit -m "feat(graph-renderers): causal 视图使用拓扑排序替代原始顺序"
```

---

## Self-Review

**1. Spec coverage:**
- 移除 flow → Task 1
- 重写评分 → Task 2
- 边过滤 → Task 3
- timeline 降级为排序选项 + UI → Task 4
- causal 拓扑排序 → Task 5

**2. Placeholder scan:** 无 TBD、TODO、implement later。所有步骤包含完整代码。

**3. Type consistency:**
- `NodeSortMode` 定义在 constants.ts，在 graph-utils.ts 和 App.tsx 中使用一致
- `EdgePriority` 定义在 types.ts，在 constants.ts 中使用
- `VIEW_TYPES` 移除 flow 后为 4 项，`VIEW_LABELS` 同步更新
- `topologicalSort` 接受 `RendererNode[]` 和 `RendererEdge[]`，与 causal.ts 内部数据一致
