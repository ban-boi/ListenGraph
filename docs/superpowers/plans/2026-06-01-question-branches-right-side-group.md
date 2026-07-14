# question-branches 右侧分组列表布局 Implementation Plan

> **状态：✅ 已完成（commit 3dbc5c4，2026-06）。** 所有 5 个 Task 已实现并通过测试，fixture `seq-pattern-question-incremental.json` 已加入 runtime registry。下方 checkbox 全部为已勾选状态。本文件保留作设计参考，**不要再当作待办执行**。

> **For agentic workers:** 本 plan 已全部实现，下方 checkbox 为历史记录（均已勾选）。如需在此基础上扩展其余 4 类语义模式的布局强化，参考 commit 3dbc5c4 的实现路径（Phase 3 reflow + handle 覆盖）。

**Goal:** 将 question-branches 语义模式从"几何扇形 fanout"改为"右侧分组列表"，实现强稳定、强可读的图形语法。

**Architecture:** question 节点固定左侧（x=60），所有 branch 节点在右侧（x=340）形成垂直分组列表。分支从问题节点的 y 位置开始，逐个向下排列。边 handle 强制 source-right → target-left。增量到达时整个分支组 reflown 重排。

**Tech Stack:** TypeScript, Vitest, React Flow

---

## File Structure

| File | 职责 |
|------|------|
| `apps/extension/src/sidepanel/graph-utils.ts` | 布局算法核心：移除 fanout 居中，新增分支组 reflow + handle 覆盖 |
| `apps/extension/src/sidepanel/graph-utils.test.ts` | 测试：移除居中断言，新增分组、handle、reflow 测试 |
| `packages/graph-fixtures/fixtures/sequences/seq-pattern-question-incremental.json` | 新 fixture：测试增量到达场景 |

---

### Task 1: 移除 fanout 居中代码，回退到原始分支定位

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.ts:50-54` (删除 FANOUT_PATTERNS)
- Modify: `apps/extension/src/sidepanel/graph-utils.ts:309-326` (删除 fanout 预计算)
- Modify: `apps/extension/src/sidepanel/graph-utils.ts:372-387` (删除 fanout 居中公式)

- [x] **Step 1: 删除 FANOUT_PATTERNS 常量**

在 `graph-utils.ts` 中，删除第 50-54 行：

```typescript
// 删除以下内容：
/** fanout 模式：分支以锚点垂直中心居中分布 */
const FANOUT_PATTERNS: ReadonlySet<string> = new Set([
  'question-branches',
  'opposition',
]);
```

- [x] **Step 2: 删除 buildStableReactFlowDebugGraph 中的 fanout 预计算块**

在函数内部，删除第 309-326 行的 fanout 预计算代码：

```typescript
// 删除以下内容：
  // 预计算 fanout 模式下每个锚点的分支总数，用于居中分布
  const semanticPattern = params.rendererGraph.layoutHints?.semanticPattern;
  const isFanout = params.view === 'hierarchy' && semanticPattern && FANOUT_PATTERNS.has(semanticPattern);
  const fanoutBranchCountByAnchor = new Map<string, number>();
  if (isFanout) {
    for (const node of params.rendererGraph.nodes) {
      if (node.layoutRole === 'branch') {
        // 找到该分支节点的锚点（root 节点）
        const anchorEdge = params.rendererGraph.edges.find(
          (edge) => edge.target === node.id,
        );
        if (anchorEdge) {
          const count = fanoutBranchCountByAnchor.get(anchorEdge.source) ?? 0;
          fanoutBranchCountByAnchor.set(anchorEdge.source, count + 1);
        }
      }
    }
  }
```

- [x] **Step 3: 回退分支定位到原始公式**

将第 372-387 行的 fanout 居中逻辑替换回简单公式：

```typescript
// 将以下代码：
      // fanout 模式：分支以锚点垂直中心居中分布
      let branchY: number;
      if (isFanout && node.layoutRole === 'branch') {
        const totalBranches = fanoutBranchCountByAnchor.get(anchorId) ?? 1;
        const anchorCenter = anchorPosition.y + STABLE_LAYOUT_CARD_HEIGHT / 2;
        // 间距必须大于卡片高度+碰撞间距，否则相邻分支会碰撞
        const step = Math.max(
          STABLE_LAYOUT_BRANCH_GAP,
          STABLE_LAYOUT_CARD_HEIGHT + STABLE_LAYOUT_COLLISION_GAP,
        );
        const totalSpan = (totalBranches - 1) * step;
        const startY = anchorCenter - totalSpan / 2;
        branchY = startY + branchCount * step;
      } else {
        branchY = anchorPosition.y + STABLE_LAYOUT_BRANCH_GAP * (branchCount + 1);
      }

// 替换为：
      const branchY = anchorPosition.y + STABLE_LAYOUT_BRANCH_GAP * (branchCount + 1);
```

- [x] **Step 4: 删除 fanout 居中测试**

在 `graph-utils.test.ts` 中，删除以下 3 个测试：
- `fanout 模式下分支围绕锚点垂直中心居中分布`
- `fanout 模式下两个分支也居中分布`
- `fanout 模式下五个分支居中且无重叠`

- [x] **Step 5: 运行测试验证**

Run: `pnpm --filter extension test:run -- --reporter=verbose src/sidepanel/graph-utils.test.ts`
Expected: 所有 19 个测试通过（回到 fanout 居中之前的状态）

- [x] **Step 6: Commit**

```
refactor(graph-utils): 移除 fanout 居中逻辑，为右侧分组列表布局做准备
```

---

### Task 2: 添加分支组 reflow 后处理阶段

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.ts` (Phase 2 结束后、node 构建之前)

核心设计：在 Phase 2 之后增加 Phase 3，对 question-branches 模式的所有 branch 节点统一重排为右侧垂直分组。

- [x] **Step 1: 在 buildStableReactFlowDebugGraph 中，Phase 2 结束后添加 reflow 逻辑**

在 `occupied.push(nextPosition);` 的 `}` 闭合花括号之后（约第 418 行），`const nodes: ReactFlowDebugNode[]` 之前，插入：

```typescript
  // Phase 3: question-branches 分支组 reflown
  // 对 question-branches 语义模式，将所有 branch 节点统一重排为右侧垂直分组列表
  const semanticPattern = params.rendererGraph.layoutHints?.semanticPattern;
  const isQuestionBranches =
    params.view === 'hierarchy' && semanticPattern === 'question-branches';
  const qbRootId = isQuestionBranches
    ? params.rendererGraph.layoutHints?.rootNodeId
    : undefined;
  const qbBranchIds = isQuestionBranches
    ? (params.rendererGraph.layoutHints?.branchNodeIds ?? [])
    : [];

  if (qbRootId && qbBranchIds.length > 0 && positions[qbRootId]) {
    const rootPos = positions[qbRootId];
    const groupStep = Math.max(
      STABLE_LAYOUT_BRANCH_GAP,
      STABLE_LAYOUT_CARD_HEIGHT + STABLE_LAYOUT_COLLISION_GAP,
    );
    const branchLaneX = rootPos.x + STABLE_LAYOUT_BRANCH_OFFSET_X;

    for (let i = 0; i < qbBranchIds.length; i++) {
      const branchId = qbBranchIds[i];
      if (validNodeIds.has(branchId)) {
        positions[branchId] = { x: branchLaneX, y: rootPos.y + i * groupStep };
      }
    }

    // 重建 occupied 列表
    occupied.length = 0;
    for (const pos of Object.values(positions)) {
      occupied.push(pos);
    }
  }
```

- [x] **Step 2: 写测试验证分组布局的 y 位置**

在 `graph-utils.test.ts` 的 `describe('semantic hierarchy layout grammar')` 内，在现有 `问题分三点` 测试之后，添加：

```typescript
  it('question-branches：分支从锚点顶部开始垂直分组排列', () => {
    const graph = makeGraph(
      [
        {
          id: 'q1',
          type: 'question',
          text: '三个问题？',
          timestampMs: 0,
          status: 'confirmed',
        },
        {
          id: 'p1',
          type: 'claim',
          text: '问题一',
          timestampMs: 1000,
          status: 'confirmed',
        },
        {
          id: 'p2',
          type: 'claim',
          text: '问题二',
          timestampMs: 2000,
          status: 'confirmed',
        },
        {
          id: 'p3',
          type: 'claim',
          text: '问题三',
          timestampMs: 3000,
          status: 'confirmed',
        },
      ],
      [
        { id: 'e1', source: 'q1', target: 'p1', type: 'supports' },
        { id: 'e2', source: 'q1', target: 'p2', type: 'supports' },
        { id: 'e3', source: 'q1', target: 'p3', type: 'supports' },
      ],
    );

    const { reactFlow, positions } = layoutHierarchy(graph);
    expectNoOverlaps(reactFlow.nodes);

    // 所有分支在同一 x 列
    expectSameLane(positions, ['p1', 'p2', 'p3']);

    // 第一个分支顶部与锚点顶部对齐
    expect(positions.p1.y).toBe(positions.q1.y);

    // 分支按顺序向下排列，间距 = CARD_HEIGHT + COLLISION_GAP = 156
    expect(positions.p2.y).toBe(positions.p1.y + 156);
    expect(positions.p3.y).toBe(positions.p2.y + 156);
  });
```

- [x] **Step 3: 运行测试验证**

Run: `pnpm --filter extension test:run -- --reporter=verbose src/sidepanel/graph-utils.test.ts`
Expected: PASS（20 tests）

- [x] **Step 4: Commit**

```
feat(graph-utils): question-branches 分支组 reflown 为右侧垂直分组列表
```

---

### Task 3: 强制 question-branches 边使用 source-right → target-left

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.ts` (edge 构建部分，约第 454 行)

- [x] **Step 1: 在 edge 构建中添加 handle 覆盖**

在 `const edges: ReactFlowDebugEdge[] = params.rendererGraph.edges` 的 `.map((edge) => {` 内部，将第 455 行：

```typescript
      const handles = resolveEdgeHandles(positions[edge.source], positions[edge.target]);
```

替换为：

```typescript
      // question-branches：强制 source-right → target-left
      const isBranchEdge =
        qbRootId && edge.source === qbRootId && qbBranchIds.includes(edge.target);
      const handles = isBranchEdge
        ? { sourceHandle: 'source-right' as SourceHandleId, targetHandle: 'target-left' as TargetHandleId }
        : resolveEdgeHandles(positions[edge.source], positions[edge.target]);
```

- [x] **Step 2: 写测试验证 5 分支全部 source-right → target-left**

在 `graph-utils.test.ts` 的 `describe('semantic hierarchy layout grammar')` 内添加：

```typescript
  it('question-branches：5 个分支全部使用 source-right → target-left', () => {
    const nodes: MergedGraph['nodes'] = [
      {
        id: 'q1',
        type: 'question',
        text: '五个问题？',
        timestampMs: 0,
        status: 'confirmed',
      },
    ];
    const edges: MergedGraph['edges'] = [];
    for (let i = 1; i <= 5; i += 1) {
      nodes.push({
        id: `p${i}`,
        type: 'claim',
        text: `问题 ${i}`,
        timestampMs: i * 1000,
        status: 'confirmed',
      });
      edges.push({ id: `e${i}`, source: 'q1', target: `p${i}`, type: 'supports' });
    }

    const graph = makeGraph(nodes, edges);
    const { reactFlow } = layoutHierarchy(graph);
    expectNoOverlaps(reactFlow.nodes);

    for (const edge of reactFlow.edges) {
      expect(edge.sourceHandle).toBe('source-right');
      expect(edge.targetHandle).toBe('target-left');
    }
  });
```

- [x] **Step 3: 运行测试验证**

Run: `pnpm --filter extension test:run -- --reporter=verbose src/sidepanel/graph-utils.test.ts`
Expected: PASS（21 tests）

- [x] **Step 4: Commit**

```
feat(graph-utils): question-branches 强制 source-right → target-left，不依赖几何评分
```

---

### Task 4: 增量到达时分支组 reflown 重排

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.test.ts` (新增测试)
- Modify: `apps/extension/src/sidepanel/graph-utils.ts` (无需改动 — Phase 3 reflow 天然支持增量)

Phase 3 reflow 每次都根据当前图的 `branchNodeIds` 全量重排，不依赖 `previousLayoutState`。因此增量到达时：
1. Phase 1 复用旧位置（包括旧分支）
2. Phase 2 放置新分支
3. Phase 3 将所有分支（旧+新）统一重排

- [x] **Step 1: 写增量 reflow 测试**

在 `graph-utils.test.ts` 的 `describe('semantic hierarchy layout grammar')` 内添加辅助函数和测试：

```typescript
function layoutHierarchyIncremental(
  graphs: MergedGraph[],
): Array<SemanticLayoutResult & { layoutState: StableViewLayoutState }> {
  const results: Array<SemanticLayoutResult & { layoutState: StableViewLayoutState }> = [];
  let previousLayoutState: StableViewLayoutState = { positions: {} };

  for (const graph of graphs) {
    const rendererGraph = toHierarchyRendererGraph(graph);
    const result = buildStableReactFlowDebugGraph({
      rendererGraph,
      view: 'hierarchy',
      currentTimeMs: 0,
      selectedNodeId: null,
      previousLayoutState,
    });

    const entry: SemanticLayoutResult & { layoutState: StableViewLayoutState } = {
      rendererGraph,
      reactFlow: result.reactFlow,
      positions: Object.fromEntries(
        result.reactFlow.nodes.map((node) => [node.id, node.position]),
      ),
      layoutState: result.layoutState,
    };
    results.push(entry);
    previousLayoutState = result.layoutState;
  }
  return results;
}

it('question-branches：增量到达时整个分支组 reflown 重排', () => {
  // rev1: q1 + p1 + p2
  const rev1 = makeGraph(
    [
      { id: 'q1', type: 'question', text: '问题？', timestampMs: 0, status: 'confirmed' },
      { id: 'p1', type: 'claim', text: '分点一', timestampMs: 1000, status: 'confirmed' },
      { id: 'p2', type: 'claim', text: '分点二', timestampMs: 2000, status: 'confirmed' },
    ],
    [
      { id: 'e1', source: 'q1', target: 'p1', type: 'supports' },
      { id: 'e2', source: 'q1', target: 'p2', type: 'supports' },
    ],
  );

  // rev2: q1 + p1 + p2 + p3（新增 p3）
  const rev2 = makeGraph(
    [
      { id: 'q1', type: 'question', text: '问题？', timestampMs: 0, status: 'confirmed' },
      { id: 'p1', type: 'claim', text: '分点一', timestampMs: 1000, status: 'confirmed' },
      { id: 'p2', type: 'claim', text: '分点二', timestampMs: 2000, status: 'confirmed' },
      { id: 'p3', type: 'claim', text: '分点三', timestampMs: 3000, status: 'confirmed' },
    ],
    [
      { id: 'e1', source: 'q1', target: 'p1', type: 'supports' },
      { id: 'e2', source: 'q1', target: 'p2', type: 'supports' },
      { id: 'e3', source: 'q1', target: 'p3', type: 'supports' },
    ],
  );

  const [step1, step2] = layoutHierarchyIncremental([rev1, rev2]);

  // rev1: 2 分支
  expect(step1.positions.p1.y).toBe(step1.positions.q1.y);
  expect(step1.positions.p2.y).toBe(step1.positions.q1.y + 156);

  // rev2: 3 分支，所有分支 reflown
  expect(step2.positions.p1.y).toBe(step2.positions.q1.y);
  expect(step2.positions.p2.y).toBe(step2.positions.q1.y + 156);
  expect(step2.positions.p3.y).toBe(step2.positions.q1.y + 312);

  // rev2 中 p1/p2 位置与 rev1 一致（顶部对齐策略天然稳定）
  expect(step2.positions.p1.y).toBe(step1.positions.p1.y);
  expect(step2.positions.p2.y).toBe(step1.positions.p2.y);

  // 所有边使用 source-right → target-left
  for (const edge of step2.reactFlow.edges) {
    expect(edge.sourceHandle).toBe('source-right');
    expect(edge.targetHandle).toBe('target-left');
  }

  expectNoOverlaps(step2.reactFlow.nodes);
});
```

- [x] **Step 2: 运行测试验证**

Run: `pnpm --filter extension test:run -- --reporter=verbose src/sidepanel/graph-utils.test.ts`
Expected: PASS（22 tests）

- [x] **Step 3: Commit**

```
test(graph-utils): 增量到达时分支组 reflown 重排测试
```

---

### Task 5: 创建增量 fixture 用于 DEV 视觉验收

**Files:**
- Create: `packages/graph-fixtures/fixtures/sequences/seq-pattern-question-incremental.json`

- [x] **Step 1: 创建增量 fixture 文件**

创建 `packages/graph-fixtures/fixtures/sequences/seq-pattern-question-incremental.json`：

```json
{
  "id": "seq-pattern-question-incremental",
  "kind": "sequence",
  "description": "Semantic pattern: question branches arriving incrementally (1 → 2 → 3 → 5)",
  "sessionId": "fixture-seq-pattern-question-incremental",
  "visualExpectations": {
    "rootNode": "q1",
    "branchNodes": ["p1", "p2", "p3", "p4", "p5"],
    "layout": "right-side-group",
    "noOverlap": true,
    "edgeHandlesReasonable": true,
    "allBranchesSourceRight": true
  },
  "playback": {
    "preserveView": true
  },
  "steps": [
    {
      "label": "incremental-root",
      "graph": {
        "sessionId": "fixture-seq-pattern-question-incremental",
        "revision": 1,
        "topics": [],
        "nodes": [
          { "id": "q1", "type": "question", "text": "这个项目开源前还有哪些问题？", "timestampMs": 0, "status": "confirmed" }
        ],
        "edges": [],
        "viewHints": { "defaultView": "hierarchy", "scores": { "hierarchy": 5, "causal": 1, "comparison": 1, "timeline": 1 } },
        "updatedAt": 1000
      }
    },
    {
      "label": "incremental-two-branches",
      "graph": {
        "sessionId": "fixture-seq-pattern-question-incremental",
        "revision": 2,
        "topics": [],
        "nodes": [
          { "id": "q1", "type": "question", "text": "这个项目开源前还有哪些问题？", "timestampMs": 0, "status": "confirmed" },
          { "id": "p1", "type": "claim", "text": "UI 还不统一", "timestampMs": 1000, "status": "confirmed" },
          { "id": "p2", "type": "claim", "text": "图形逻辑不够清楚", "timestampMs": 2000, "status": "confirmed" }
        ],
        "edges": [
          { "id": "e1", "source": "q1", "target": "p1", "type": "supports" },
          { "id": "e2", "source": "q1", "target": "p2", "type": "supports" }
        ],
        "viewHints": { "defaultView": "hierarchy", "scores": { "hierarchy": 5, "causal": 1, "comparison": 1, "timeline": 1 } },
        "updatedAt": 2000
      }
    },
    {
      "label": "incremental-three-branches",
      "graph": {
        "sessionId": "fixture-seq-pattern-question-incremental",
        "revision": 3,
        "topics": [],
        "nodes": [
          { "id": "q1", "type": "question", "text": "这个项目开源前还有哪些问题？", "timestampMs": 0, "status": "confirmed" },
          { "id": "p1", "type": "claim", "text": "UI 还不统一", "timestampMs": 1000, "status": "confirmed" },
          { "id": "p2", "type": "claim", "text": "图形逻辑不够清楚", "timestampMs": 2000, "status": "confirmed" },
          { "id": "p3", "type": "claim", "text": "代码架构需要清理", "timestampMs": 3000, "status": "confirmed" }
        ],
        "edges": [
          { "id": "e1", "source": "q1", "target": "p1", "type": "supports" },
          { "id": "e2", "source": "q1", "target": "p2", "type": "supports" },
          { "id": "e3", "source": "q1", "target": "p3", "type": "supports" }
        ],
        "viewHints": { "defaultView": "hierarchy", "scores": { "hierarchy": 5, "causal": 1, "comparison": 1, "timeline": 1 } },
        "updatedAt": 3000
      }
    },
    {
      "label": "incremental-five-branches",
      "graph": {
        "sessionId": "fixture-seq-pattern-question-incremental",
        "revision": 4,
        "topics": [],
        "nodes": [
          { "id": "q1", "type": "question", "text": "这个项目开源前还有哪些问题？", "timestampMs": 0, "status": "confirmed" },
          { "id": "p1", "type": "claim", "text": "UI 还不统一", "timestampMs": 1000, "status": "confirmed" },
          { "id": "p2", "type": "claim", "text": "图形逻辑不够清楚", "timestampMs": 2000, "status": "confirmed" },
          { "id": "p3", "type": "claim", "text": "代码架构需要清理", "timestampMs": 3000, "status": "confirmed" },
          { "id": "p4", "type": "claim", "text": "测试覆盖不足", "timestampMs": 4000, "status": "confirmed" },
          { "id": "p5", "type": "claim", "text": "文档需要补全", "timestampMs": 5000, "status": "confirmed" }
        ],
        "edges": [
          { "id": "e1", "source": "q1", "target": "p1", "type": "supports" },
          { "id": "e2", "source": "q1", "target": "p2", "type": "supports" },
          { "id": "e3", "source": "q1", "target": "p3", "type": "supports" },
          { "id": "e4", "source": "q1", "target": "p4", "type": "supports" },
          { "id": "e5", "source": "q1", "target": "p5", "type": "supports" }
        ],
        "viewHints": { "defaultView": "hierarchy", "scores": { "hierarchy": 5, "causal": 1, "comparison": 1, "timeline": 1 } },
        "updatedAt": 4000
      }
    }
  ]
}
```

- [x] **Step 2: 验证 fixture 能被加载**

确认 `fixture-sequence-dev.ts` 会自动扫描 `sequences/` 目录下的 JSON 文件。运行 dev 服务器后在侧栏 console 输入：

```
__listenGraphicFixture.list()
```

Expected: 返回的列表中包含 `seq-pattern-question-incremental`

- [x] **Step 3: 手动视觉验收**

在 DEV 侧栏中：

1. `__listenGraphicFixture.arm('seq-pattern-question-incremental')` — 加载 root
2. `__listenGraphicFixture.next()` — 2 个分支
3. `__listenGraphicFixture.next()` — 3 个分支
4. `__listenGraphicFixture.next()` — 5 个分支

每步验证：
- 所有分支在问题节点右侧
- 所有连线从问题节点右边出来，进入分支左边
- 分支不重叠
- 新分支到达后旧分支位置不变（顶部对齐天然稳定）

- [x] **Step 4: Commit**

```
feat(graph-fixtures): 新增 question-branches 增量 fixture 用于视觉验收
```

---

## Self-Review

### 1. Spec coverage

| 需求 | 对应 Task |
|------|----------|
| 移除 fanout 居中 | Task 1 |
| 右侧垂直分组列表布局 | Task 2 |
| 强制 source-right → target-left | Task 3 |
| 增量到达时 reflown 重排 | Task 4 |
| 增量 fixture 用于视觉验收 | Task 5 |

### 2. Placeholder scan

无 TBD/TODO/placeholder。所有代码块完整。

### 3. Type consistency

- `StableViewLayoutState = { positions: Record<string, StableNodePosition> }` — 贯穿一致
- `SourceHandleId` / `TargetHandleId` — handle 覆盖中使用相同类型断言
- `SemanticLayoutResult` — 新增 `layoutState` 字段用于增量测试

### 关键设计决策

**为什么顶部对齐而不是居中：** 顶部对齐 (`startY = anchor.y`) 天然支持增量稳定——新分支永远追加在列表末尾，旧分支位置不变。居中每次都要移动所有分支。

**为什么 Phase 3 而不是修改 Phase 2：** Phase 1/Phase 2 的"旧节点不动"逻辑是全局稳定性的基础。在 Phase 3 做定向重排，既保留全局稳定性，又允许语义分组内部灵活调整。影响范围最小。
