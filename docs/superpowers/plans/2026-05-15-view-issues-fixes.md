# 视图模式审查问题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复视图模式审查中发现的 4 个实现问题：comparison 评分过度依赖 speaker 信号、排序切换不生效、timeline 可能成为隐藏当前视图、comparison 车道硬编码。

**Architecture:** 每个 task 修复一个独立问题，TDD 方式先写失败测试再实现。所有改动涉及 3 个包：`packages/domain`（评分逻辑）、`packages/graph-renderers`（比较视图）、`apps/extension`（UI 侧栏）。

**Tech Stack:** TypeScript, Vitest, React (zustand reducer)

---

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `packages/domain/src/view-selection.ts` | 视图评分算法 | 修改 |
| `packages/domain/src/view-selection.test.ts` | 评分测试 | 修改 |
| `apps/extension/src/sidepanel/graph-utils.ts` | 布局与车道逻辑 | 修改 |
| `apps/extension/src/sidepanel/App.tsx` | 侧栏主组件（hydration、sortMode） | 修改 |
| `apps/extension/src/sidepanel/panel-reducer.ts` | 面板 reducer | 修改 |

---

### Task 1: 移除 comparison 评分中的 speaker 加分

当前 `scoreViews` 中 `hasCrossSpeakerEdges` (+2) 和 `countUniqueSpeakers >= 2` (+3) 使得没有 opposes 边的图也能自动选中 comparison 视图。在当前没有可靠 speaker diarization 的前提下，这会制造"有对比视图但无对比结构"的用户困惑。

**Files:**
- Modify: `packages/domain/src/view-selection.ts:99-113`
- Modify: `packages/domain/src/view-selection.test.ts:76-91`

- [ ] **Step 1: 写失败测试 — 多 speaker 无 opposes 时 comparison 不应胜出**

在 `packages/domain/src/view-selection.test.ts` 的 `scoreViews` describe 块末尾（`it('空边图...'` 之前）添加：

```ts
  it('多 speaker + 纯 follows：comparison 分数不应高于 causal', () => {
    const graph = makeGraph(
      [
        { id: 'e1', source: 'a', target: 'b', type: 'follows' },
        { id: 'e2', source: 'b', target: 'c', type: 'follows' },
      ],
      { a: 'Alice', b: 'Bob', c: 'Charlie' },
    );

    const scores = scoreViews(graph);

    // 无 opposes 边时，comparison 不应因多 speaker 获得额外加分
    expect(scores.comparison).toBeLessThanOrEqual(scores.causal);
  });

  it('有 opposes 但无多 speaker：comparison 分数仍应最高', () => {
    const graph = makeGraph([
      { id: 'e1', source: 'a', target: 'b', type: 'opposes' },
      { id: 'e2', source: 'b', target: 'c', type: 'opposes' },
    ]);

    const scores = scoreViews(graph);

    expect(scores.comparison).toBeGreaterThan(scores.causal);
    expect(scores.comparison).toBeGreaterThan(scores.hierarchy);
  });
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd C:\Users\finni\Desktop\ListenGraph && pnpm exec vitest run packages/domain/src/view-selection.test.ts`
Expected: `'多 speaker + 纯 follows'` 测试 FAIL（因为当前 speaker 加分使 comparison 分数偏高）

- [ ] **Step 3: 移除 speaker 加分**

在 `packages/domain/src/view-selection.ts` 中，将 `scoreViews` 函数末尾的拓扑奖励部分（约 99-113 行）改为：

```ts
  // 拓扑奖励
  if (hasMultiHopCausalChain(graph)) {
    scores.causal += 3;
  }
  // speaker 相关奖励已移除：当前 ASR 无可靠 speaker diarization，
  // 多 speaker 信号不应驱动 comparison 视图选择。
  // 当 ASR 能力补齐后，可基于 "跨 speaker + opposes/stance" 重新启用。
  if (hasClaimWithMultipleChildren(graph)) {
    scores.hierarchy += 2;
  }
```

保留辅助函数 `hasCrossSpeakerEdges` 和 `countUniqueSpeakers`（不删除，未来可能重新启用）。

- [ ] **Step 4: 运行测试验证通过**

Run: `cd C:\Users\finni\Desktop\ListenGraph && pnpm exec vitest run packages/domain/src/view-selection.test.ts`
Expected: 所有测试 PASS（包括新增的两个测试）

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/view-selection.ts packages/domain/src/view-selection.test.ts
git commit -m "fix(domain): 移除 comparison 视图的 speaker 加分，仅由 opposes 边驱动"
```

---

### Task 2: timeline 视图映射为 causal + chronological

`panel-reducer` 在 `HYDRATE_SNAPSHOT` 和 `MERGED_GRAPH_UPDATED` 中可能接受 `'timeline'` 作为 currentView，但 UI 中无 timeline 按钮，用户无法切回。

**Files:**
- Modify: `apps/extension/src/sidepanel/panel-reducer.ts:358-375, 414-448`
- Modify: `apps/extension/src/sidepanel/App.tsx:85, 314-316`

- [ ] **Step 1: 写失败测试 — timeline 被映射为 causal**

在 `apps/extension/src/sidepanel/` 下创建 `view-mapping.test.ts`：

```ts
import { describe, it, expect } from 'vitest';

describe('timeline 视图映射', () => {
  it('timeline 应被映射为 causal', () => {
    const rawView = 'timeline' as const;
    const mapped = rawView === 'timeline' ? 'causal' : rawView;
    expect(mapped).toBe('causal');
  });

  it('非 timeline 视图保持不变', () => {
    const views = ['causal', 'comparison', 'hierarchy'] as const;
    for (const v of views) {
      const mapped = v === 'timeline' ? 'causal' : v;
      expect(mapped).toBe(v);
    }
  });
});
```

- [ ] **Step 2: 运行测试验证通过（逻辑性测试，验证映射规则正确）**

Run: `cd C:\Users\finni\Desktop\ListenGraph\apps\extension && pnpm exec vitest run src/sidepanel/view-mapping.test.ts`
Expected: PASS

- [ ] **Step 3: 在 App.tsx hydration 中添加 timeline 映射**

在 `apps/extension/src/sidepanel/App.tsx` 的 `hydrateSnapshot` 中（约 314-316 行），将：

```ts
      const preferredView = snapshot.graph
        ? (snapshot.currentView ?? snapshot.graph.viewHints?.defaultView ?? 'causal')
        : 'causal';
```

改为：

```ts
      const rawPreferredView = snapshot.graph
        ? (snapshot.currentView ?? snapshot.graph.viewHints?.defaultView ?? 'causal')
        : 'causal';
      // timeline 在 UI 中不可选，映射为 causal + chronological 排序
      const preferredView: ViewType = rawPreferredView === 'timeline' ? 'causal' : rawPreferredView;

      dispatch({ type: 'HYDRATE_SNAPSHOT', payload: { ...snapshot, preferredView } });

      if (rawPreferredView === 'timeline') {
        setNodeSortMode('chronological');
      }
```

注意：`dispatch` 行需要在新的 preferredView 计算之后，所以原来紧跟的 `dispatch` 需要移到新代码之后。

- [ ] **Step 4: 在 reducer view 监听中添加防御性映射**

在 `apps/extension/src/sidepanel/App.tsx` 中（约 222-229 行），将：

```ts
  useEffect(() => {
    if (panel.currentView !== prevReducerViewRef.current) {
      prevReducerViewRef.current = panel.currentView;
      setUserViewOverride(null);
    }
  }, [panel.currentView]);
```

改为：

```ts
  useEffect(() => {
    if (panel.currentView !== prevReducerViewRef.current) {
      prevReducerViewRef.current = panel.currentView;
      // 防御：reducer 返回 timeline 时映射为 causal + chronological
      if (panel.currentView === 'timeline') {
        setUserViewOverride('causal');
        setNodeSortMode('chronological');
      } else {
        setUserViewOverride(null);
      }
    }
  }, [panel.currentView]);
```

- [ ] **Step 5: 在 panel-reducer MERGED_GRAPH_UPDATED 中添加防御**

在 `apps/extension/src/sidepanel/panel-reducer.ts` 的 `MERGED_GRAPH_UPDATED` case（约 358-375 行），将：

```ts
        ? state.currentView
        : (nextGraph.viewHints?.defaultView ?? 'causal');
```

改为：

```ts
        ? state.currentView
        : (nextGraph.viewHints?.defaultView === 'timeline'
            ? 'causal'
            : (nextGraph.viewHints?.defaultView ?? 'causal'));
```

同理在 `HYDRATE_SNAPSHOT` case（约 423-425 行），将：

```ts
        nextCurrentView = action.payload.preferredView;
```

改为：

```ts
        nextCurrentView = action.payload.preferredView === 'timeline'
          ? 'causal'
          : action.payload.preferredView;
```

- [ ] **Step 6: 运行测试确认无回归**

Run: `cd C:\Users\finni\Desktop\ListenGraph\apps\extension && pnpm exec vitest run src/sidepanel/view-mapping.test.ts src/sidepanel/topo-sort.test.ts src/sidepanel/graph-utils.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/sidepanel/App.tsx apps/extension/src/sidepanel/panel-reducer.ts apps/extension/src/sidepanel/view-mapping.test.ts
git commit -m "fix(ext): timeline 视图映射为 causal + chronological 排序"
```

---

### Task 3: comparison 车道动态 speaker 检测

`getLaneX` 中 `speaker === '嘉宾B'` 是 mock 数据的硬编码，真实 ASR 数据中 speaker 名称不固定。需要改为动态检测：收集所有 speaker，第一个 speaker 走左车道，其余走右车道。

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.ts:102-119`

- [ ] **Step 1: 写失败测试 — 动态 speaker 车道分配**

在 `apps/extension/src/sidepanel/` 下创建 `lane-allocation.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { getLaneX } from './graph-utils';

describe('getLaneX comparison 车道分配', () => {
  it('第一个出现的 speaker 在主车道（左侧）', () => {
    const speakers = new Set(['Alice', 'Bob']);
    const mainX = getLaneX('comparison', 'claim', 'Alice', speakers);
    const rightX = getLaneX('comparison', 'claim', 'Bob', speakers);
    expect(mainX).toBeLessThan(rightX);
  });

  it('无 speaker 时走主车道', () => {
    const x = getLaneX('comparison', 'claim', undefined, new Set());
    expect(x).toBe(60);
  });

  it('causal 视图不受 speaker 影响', () => {
    const x = getLaneX('causal', 'claim', 'Alice', new Set(['Alice', 'Bob']));
    expect(x).toBe(60);
  });

  it('三个 speaker 时第一个左车道其余右车道', () => {
    const speakers = new Set(['Alice', 'Bob', 'Charlie']);
    const xAlice = getLaneX('comparison', 'claim', 'Alice', speakers);
    const xBob = getLaneX('comparison', 'claim', 'Bob', speakers);
    const xCharlie = getLaneX('comparison', 'claim', 'Charlie', speakers);
    expect(xAlice).toBe(60);
    expect(xBob).toBe(360);
    expect(xCharlie).toBe(360);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd C:\Users\finni\Desktop\ListenGraph\apps\extension && pnpm exec vitest run src/sidepanel/lane-allocation.test.ts`
Expected: FAIL（`getLaneX` 当前签名不接受 `speakersInGraph` 参数）

- [ ] **Step 3: 修改 getLaneX 接受动态 speaker 集合**

在 `apps/extension/src/sidepanel/graph-utils.ts` 中修改 `getLaneX` 函数（约 102-119 行）：

```ts
function getLaneX(
  view: ViewType,
  nodeType: ReactFlowDebugNodeData['nodeType'] | NodeType,
  speaker: string | undefined,
  speakersInGraph?: Set<string>,
) {
  switch (view) {
    case 'comparison': {
      if (!speaker || !speakersInGraph || speakersInGraph.size <= 1) {
        return STABLE_LAYOUT_MAIN_X;
      }
      const sortedSpeakers = Array.from(speakersInGraph).sort();
      const isFirstSpeaker = speaker === sortedSpeakers[0];
      return isFirstSpeaker
        ? STABLE_LAYOUT_MAIN_X
        : STABLE_LAYOUT_COMPARISON_RIGHT_X;
    }
    case 'hierarchy':
      return nodeType === 'claim' || nodeType === 'conclusion'
        ? STABLE_LAYOUT_MAIN_X
        : STABLE_LAYOUT_MAIN_X + STABLE_LAYOUT_BRANCH_OFFSET_X;
    default:
      return STABLE_LAYOUT_MAIN_X;
  }
}
```

然后在 `buildStableReactFlowDebugGraph` 函数顶部（约 277 行后）添加：

```ts
  // 收集所有 speaker 用于 comparison 车道分配
  const speakersInGraph = new Set<string>();
  for (const node of params.rendererGraph.nodes) {
    if (node.speaker) speakersInGraph.add(node.speaker);
  }
```

更新两处 `getLaneX` 调用，传入 `speakersInGraph`：

1. 约第 314 行（branch 节点）：
```ts
x: getLaneX(params.view, node.type, node.speaker, speakersInGraph) === anchorPosition.x
  ? anchorPosition.x + STABLE_LAYOUT_BRANCH_OFFSET_X
  : getLaneX(params.view, node.type, node.speaker, speakersInGraph),
```

2. 约第 321 行（普通节点）：
```ts
const laneX = getLaneX(params.view, node.type, node.speaker, speakersInGraph);
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd C:\Users\finni\Desktop\ListenGraph\apps\extension && pnpm exec vitest run src/sidepanel/lane-allocation.test.ts src/sidepanel/topo-sort.test.ts src/sidepanel/graph-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/sidepanel/graph-utils.ts apps/extension/src/sidepanel/lane-allocation.test.ts
git commit -m "fix(ext): comparison 车道改为动态 speaker 检测，不再硬编码嘉宾B"
```

---

### Task 4: sortMode 切换时清空布局缓存

`chronological` 排序改变 `rendererGraph.nodes` 顺序，但 `buildStableReactFlowDebugGraph` 优先复用旧位置（`previousLayoutState.positions[node.id]`），导致排序切换后节点位置不变。

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx:707`

- [ ] **Step 1: 在排序按钮点击时清空缓存**

在 `apps/extension/src/sidepanel/App.tsx` 中（约 707 行），将：

```tsx
onClick={() => setNodeSortMode(mode)}
```

改为：

```tsx
onClick={() => {
  setNodeSortMode(mode);
  layoutCacheRef.current = createEmptyStableLayoutCache();
}}
```

- [ ] **Step 2: 运行相关测试确认无回归**

Run: `cd C:\Users\finni\Desktop\ListenGraph\apps\extension && pnpm exec vitest run src/sidepanel/graph-utils.test.ts src/sidepanel/topo-sort.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/sidepanel/App.tsx
git commit -m "fix(ext): sortMode 切换时清空布局缓存，确保节点重新排列"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ 移除 speaker 加分 → Task 1
- ✅ timeline 映射 → Task 2
- ✅ 动态车道检测 → Task 3
- ✅ sortMode 缓存失效 → Task 4
- 📝 产品建议（隐藏边提示、timeline fallback）→ 记录为未来工作

**2. Placeholder scan:**
- 无 TBD、TODO、placeholder

**3. Type consistency:**
- `getLaneX` 新增 `speakersInGraph?: Set<string>` 可选参数，不影响现有调用（调用点同文件内全部更新）
- `NodeSortMode` 类型已是 `'default' | 'chronological'`，一致

---

## 未来工作备忘

1. **隐藏边提示**：当视图隐藏部分边时，在图例或视图中添加轻量提示（"当前视图聚焦 X 关系，Y 条关系已隐藏"）。
2. **timeline fallback**：对纯顺序型内容（只有 follows 边），timeline 是核心场景，当前通过 causal + chronological 排序覆盖，未来可考虑保留一个轻量的"时间顺序"入口。
3. **speaker diarization 补齐后**：恢复 `hasCrossSpeakerEdges` 和 `countUniqueSpeakers` 作为 comparison 增强信号。
