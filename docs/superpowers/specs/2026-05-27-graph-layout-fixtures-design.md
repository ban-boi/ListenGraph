# Graph Layout Fixtures 设计

**日期**：2026-05-27  
**状态**：待审阅  
**影响范围**：`packages/graph-fixtures`（新建）、`apps/extension/src/sidepanel/`、`apps/web-demo/`、`docs/testing/`

---

## 背景与目标

ListenGraph 的 Extension 侧栏使用 **stable layout**（`graph-utils.ts`）与 **readable autofit**（`requestAutoFit` / `hasAutoFitRef`）。开发与回归时需要可重复的图谱样本，专测：

- 图随 `revision` 长大时，autofit **仅首屏**生效；
- 用户手动缩放/平移后，新节点到达是否抢视图；
- `layoutCache`、`auto-tour` 与 `MERGED_GRAPH_UPDATED` 的协作。

**目标：**

1. **同一套** graph fixture（以 **revision 序列** 为主）在 Extension 与 web-demo 间复用。
2. Extension **不增加**面向用户的 mock 按钮或「手动 structure 步进」产品功能。
3. 支持 **肉眼**（DEV 控制台 + 侧栏键盘）与 **自动化**（Vitest / Playwright）两条路径。

**非目标：**

- 不实现「全套 ASR + structure mock」作为排版主路径。
- 不要求 web-demo 与 Extension **布局/autofit 视觉一致**。
- 不在生产构建中保留 fixture 代码路径。

---

## 核心概念

### Mock 不创造新产品能力

生产环境中，用户**不能**手动「让 structure 前进一步」；侧栏只响应后台投递的 `MERGED_GRAPH_UPDATED`。

Fixture 实验室做的是：

> **用预置的 `MergedGraph` 序列，由开发者决定何时投递下一帧**，走与 `useChromeMessages` **同构**的 reducer 路径。

这与 `App.graph-updates.test.tsx` 中直接 `dispatch({ type: 'MERGED_GRAPH_UPDATED', ... })` 同类，不是新功能，而是 **DEV/测试用的图状态投递器**。

### 与 Replay 的区分

| 能力 | Replay | Fixture Sequence |
|------|--------|------------------|
| 数据 | 会话 transcripts + 时间轴 | 预置 `steps[].graph`（revision 序列） |
| 驱动 | `PLAYBACK_TIME_UPDATED` | `MERGED_GRAPH_UPDATED` |
| UI | 已有 Replay 面板 | **无**新产品按钮 |
| 用途 | 端到端会话回放 | 排版 / autofit / 缩放冲突 |

---

## 架构概览

```text
packages/graph-fixtures
  fixtures/manifest.json (version: 1)
  fixtures/sequences/*.json
  src: validate, load, computeStepPayload
        │
        ├─► Extension (DEV only)
        │     __listenGraphicFixture (sidepanel window)
        │     keydown on sidepanel when armed
        │     LogPanel 行反馈 [fixture seq-x 3/8]
        │     dispatch MERGED_GRAPH_UPDATED (同构 useChromeMessages)
        │     FIXTURE_SEQUENCE_* + onFixtureLabReset 副作用
        │
        ├─► Vitest: playSequenceAndAssert(...)
        │
        ├─► Playwright: sidepanelPage.evaluate(() => __listenGraphicFixture.next())
        │
        └─► web-demo: ?sequence=... + Arrow keys → setGraph (dagre)
              （仅验证拓扑/视图，不验证 autofit）
```

---

## 1. 包 `@listen-graphic/graph-fixtures`

### 目录结构

```text
packages/graph-fixtures/
  package.json
  fixtures/
    manifest.json
    sequences/
      seq-incremental-growth.json
      seq-late-burst.json
      seq-view-switch-mid.json
    snapshots/                    # v1 可选，后续从 mock-session 迁入
      baseline-medium.json
  src/
    types.ts
    validate.ts                   # Zod
    load.ts
    compute-step-payload.ts       # 纯函数 diff
    index.ts
```

### `manifest.json`

```json
{
  "version": 1,
  "sequences": [
    {
      "id": "seq-incremental-growth",
      "file": "sequences/seq-incremental-growth.json",
      "tags": ["growth", "autofit"],
      "primaryView": "causal",
      "description": "节点 2→24，8 步，专测 autofit 只触发一次"
    }
  ],
  "snapshots": []
}
```

- **`version`**：数据格式版本；将来支持 `sequence-delta` 时递增，loader 做向前兼容。
- v1 仅实现 `kind: "sequence"` 与可选 `kind: "snapshot"`。

### Sequence 文件格式（v1）

```json
{
  "id": "seq-incremental-growth",
  "kind": "sequence",
  "description": "…",
  "sessionId": "fixture-seq-incremental-growth",
  "playback": {
    "preserveView": true
  },
  "steps": [
    {
      "label": "rev-1",
      "graph": {
        "sessionId": "fixture-seq-incremental-growth",
        "revision": 1,
        "topics": [],
        "nodes": [],
        "edges": [],
        "viewHints": { "defaultView": "causal", "scores": { "causal": 5 } },
        "updatedAt": 0
      }
    }
  ]
}
```

**校验规则（`validate.ts`，CI 必跑）：**

1. `steps.length >= 2`
2. 每步 `graph` 满足 `MergedGraph` 形状（Zod）
3. 所有 `graph.sessionId === fixture.sessionId`
4. `graph.revision` 严格递增（建议连续整数）
5. **单调累积**：`steps[i].nodes` / `edges` 的 id 集合 ⊆ `steps[i+1]`（违反则 fail；允许 warn 模式用于草稿）
6. `playback.preserveView` 默认 `true`（投递时 `shouldPreserveView` 与真实会话一致）

### 数据量与演进

- **v1**：每步存**完整** `MergedGraph`；首批 3 条 sequence（约 8 步 × 中等节点）可接受。
- **将来**（manifest `version: 2`）：可选 `kind: "sequence-delta"`，磁盘存 add/patch，`load.ts` 运行时 fold；`computeStepPayload` 接口不变。
- **将来**：`loadSequence(id, { parseSteps: 'lazy' })` 大文件按需解析，避免一次性载入全部 step。

### `computeStepPayload(prev, next)`

纯函数，与 `auto-tour-utils` 对齐，供 Extension / Vitest 共用：

```ts
export function computeStepPayload(
  previousGraph: MergedGraph,
  nextGraph: MergedGraph,
): {
  addedNodeIds: string[];
  anchorNodeIds: string[];
  shouldPreserveView: boolean; // sessionId 相同 → true
};
```

实现复用或抽取 `getAddedNodeIds`、`getAutoRevealAnchorNodeIds` 的逻辑（避免 sidepanel 与包之间重复算法）。

### 公开 API

```ts
listSequences(): ManifestEntry[];
listSnapshots(): ManifestEntry[];
loadSequence(id: string): SequenceFixture;
loadSnapshot(id: string): MergedGraph;
validateAllFixtures(): ValidationReport; // Vitest + 可选 CLI
```

---

## 2. Extension：DEV-only 投递器

### 构建与打包

- 模块：`apps/extension/src/sidepanel/fixture-sequence-controller.ts`（及 DEV 入口 `fixture-sequence-dev.ts`）
- 仅当 `import.meta.env.DEV` 时由 `App.tsx` 动态挂载；**生产构建不得包含** `__listenGraphicFixture` 字符串（验收：对 `dist/sidepanel/*.js` grep）。

### 控制台 API（侧栏 `window`）

挂载在 **sidepanel 的 `globalThis`**，不是 content script 页，不是父页面。

```ts
interface ListenGraphicFixtureAPI {
  list(): string[];
  arm(id: string): void;
  disarm(): void;
  next(): boolean;
  prev(): boolean;
  reset(): void;
  status(): {
    isArmed: boolean;
    id: string | null;
    step: number;
    total: number;
    revision: number;
    nodeCount: number;
    edgeCount: number;
  };
}
```

**语义：**

| 方法 | 行为 |
|------|------|
| `arm(id)` | 加载 sequence；`step=0`；执行 **Lab Reset**（见下）；可选自动 `next()` 到 step 0 图或保持空图再第一步 |
| `disarm()` | 卸载键盘监听；`isArmed=false` |
| `next()` / `prev()` | 投递 `steps[i].graph`；同构 `useChromeMessages` 的 `MERGED_GRAPH_UPDATED` payload |
| `reset()` | 回到 step 0 + Lab Reset |
| `status()` | 含 **`isArmed`**，避免猜 arm 是否生效 |

### 同构投递（与 `useChromeMessages` 一致）

对每个 step：

1. `previousGraph = graphRef.current`
2. `nextGraph = steps[i].graph`
3. `const { addedNodeIds, anchorNodeIds, shouldPreserveView } = computeStepPayload(previousGraph, nextGraph)`
4. `dispatch({ type: 'MERGED_GRAPH_UPDATED', payload: { graph, shouldPreserveView, previousGraph, addedNodeIds, anchorNodeIds } })`
5. `graphRef.current = nextGraph`；若 `addedNodeIds.length > 0` 则 `setAutoTourSeed(...)`（与线上一致）

**不经过 service worker**，不测 merge/assembler。

### Lab Reset：Reducer + 副作用契约

**禁止**在 controller 内 scattered 地改 `hasAutoFitRef`、`layoutCacheRef` 等。

#### Reducer：`FIXTURE_SEQUENCE_ARM` / `FIXTURE_SEQUENCE_RESET`

新增 `PanelAction`（名称可二选一，实现时保持语义清晰）：

```ts
| {
    type: 'FIXTURE_SEQUENCE_ARM';
    payload: {
      sessionId: string;
      initialGraph: MergedGraph; // 通常 steps[0].graph 或 createEmptyGraph()
    };
  }
| { type: 'FIXTURE_SEQUENCE_RESET' }
```

**Reducer 负责（`panelReducer`）：**

- `sessionId` ← fixture `sessionId`
- `graph` ← `initialGraph` 或空图
- `sessionState` ← `'stopped'` 或专用 `'idle'`（与现有 dev 会话不冲突即可）
- 清空与图实验无关的 runtime 字段可参考 `RESET_RUNTIME_UI` 子集（timeline 可保留 fixture 日志行）
- **不**直接操作 React Flow ref

**App 负责（`onFixtureLabReset` 回调，由 controller 在 arm/reset 时调用）：**

与 `useSessionControl` 停会话时对齐，必须清：

| 状态 | 清理方式 |
|------|----------|
| `layoutCacheRef` | 现有 `resetLayoutCache()` |
| `hasAutoFitRef` | `hasAutoFitRef.current = false` |
| auto-tour | 现有 `resetAutoTourState()` / `useAutoTour` 的 reset |
| `activeViewSessionRef` | 设为 fixture `sessionId` |
| `userPinnedViewRef` | 按产品默认（通常 false） |
| `lastUserViewportChangeAtRef` | 置 0（实验用户缩放冲突时可选保留，文档说明） |

在 spec 实现阶段维护 **「Lab Reset 清单」** 单测或注释表，与 `resetLayoutCache` 路径对照，防止遗漏。

### 键盘（无按钮）

- 监听挂在 **sidepanel `window`**，`arm()` 后注册，`disarm()` 卸载。
- 默认映射：`]` → `next()`，`[` → `prev()`，`Esc` → `reset()`。
- 输入框 focus 时不触发（`target` 为 `input/textarea` 则跳过）。
- **无** Overflow / Settings 菜单项。

### 可见反馈（无产品按钮）

**优先级：**

1. **LogPanel**：每步 `addLog('[fixture] seq-incremental-growth 3/8 | rev=3 | nodes=12')`。
2. **可选（实现时若 Log 不够）**：`arm` 后仅在 DEV 显示一行状态条 ` [fixture 3/8] `，**不是**「下一步 structure」按钮；生产构建不存在。

### 与 `isDevMode` 的关系

现有 `constants.ts` 中 `isDevMode = false` 的本地模拟会话**不**与本方案合并。Fixture 实验室独立由 `import.meta.env.DEV` + `__listenGraphicFixture` 驱动，避免两套 dev 行为纠缠。

---

## 3. Vitest

### 文件

- `apps/extension/src/sidepanel/graph-fixtures.test-helper.ts`（高层 API）
- `apps/extension/src/sidepanel/App.fixture-sequence.test.tsx`（或扩展现有 `App.graph-updates.test.tsx`）

### 高层 API（不暴露 spy 细节）

```ts
await playSequenceAndAssert({
  fixtureId: 'seq-incremental-growth',
  assertions: [
    { step: 0, expectFitViewCalls: 1 },
    { step: 1, expectFitViewCalls: 0 },
    // 可扩展： autoTourStatus, nodeCount, ...
  ],
});
```

- 内部使用 `renderApp` + mock `chrome.runtime.sendMessage`。
- **`fitView` spy** 封装在 helper 内，fixture 测试文件不依赖 `app-test-helpers` 私有实现。

### 建议断言（`seq-incremental-growth`）

1. 第一步有节点后 `fitView` 调用 1 次。
2. 后续 `next()` 无 `force` 时不增加 `fitView` 调用。
3. 模拟用户 viewport 变化后 `next()`，auto-tour 不误触发（可对接现有 `App.graph-updates` 用例风格）。

---

## 4. Playwright

- 在 **sidepanel page** 上执行：

```ts
await sidepanelPage.evaluate(() => {
  globalThis.__listenGraphicFixture.arm('seq-incremental-growth');
  globalThis.__listenGraphicFixture.next();
});
```

- **不要**在 content script / fixture HTML 页上调用 API。
- 可用于本地排版抽检；非 CI 必需（CI 以 Vitest 为主）。

---

## 5. web-demo

### 行为

- 依赖 `@listen-graphic/graph-fixtures`。
- URL：`?sequence=seq-incremental-growth`（或开发态下拉，**仅 web-demo**）。
- `ArrowRight` / `ArrowLeft`：`setGraph(steps[i].graph)`。
- 布局仍用 **dagre**（`getLayoutedElements`）。

### 文档边界（必须在 `docs/testing/graph-layout-fixtures.md` 写明）

> web-demo sequence **只验证**：节点/边数量变化、视图类型切换、`graph-renderers` 过滤结果。  
> **不验证**：stable layout、readable autofit、`layoutCache`、auto-tour、用户缩放冲突。  
> **autofit 与排版结论以 Extension 为准。**

### `mock-session.ts`

迁移为 `snapshots/baseline-medium.json`，web-demo 从包内加载，删除重复定义。

---

## 6. 文档

新建 `docs/testing/graph-layout-fixtures.md`：

- 控制台命令速查（arm / next / status）
- 键盘映射
- 推荐实验脚本（例如：arm → 等 autofit → 手动缩小 → next ×3）
- web-demo 与 Extension 能力边界
- Playwright `evaluate` 示例（sidepanel window）
- 与 `test:ext:replay`、双 mock E2E 的分工

---

## 7. 首批 Fixture

| id | 目的 |
|----|------|
| `seq-incremental-growth` | 约 8 步，节点 2→24，autofit 仅首屏 |
| `seq-late-burst` | 前 2 步极少节点，3–5 步突增 ~15 节点，测 burst + auto-tour |
| `seq-view-switch-mid` | 中段变更 `viewHints.defaultView`，测 `preserveView` / 切视图 |

---

## 8. 分阶段交付

### Step 1 — 数据包（可独立验收）

- [ ] 新建 `packages/graph-fixtures`
- [ ] `manifest.json` `version: 1`
- [ ] Zod 校验 + `validateAllFixtures` Vitest
- [ ] 手写 3 条 sequence
- [ ] `computeStepPayload` 单测

### Step 2 — Extension DEV 投递器

- [ ] `FIXTURE_SEQUENCE_ARM` / `FIXTURE_SEQUENCE_RESET` + `onFixtureLabReset`
- [ ] `__listenGraphicFixture` API + LogPanel 反馈
- [ ] sidepanel 键盘（arm 后）
- [ ] 生产构建无 fixture 符号

### Step 3 — 自动化与文档

- [ ] `playSequenceAndAssert` + `seq-incremental-growth` autofit 断言
- [ ] `docs/testing/graph-layout-fixtures.md`
- [ ] web-demo `?sequence=` + 方向键（可选与本步并行）

---

## 9. 验收标准（整体）

- [ ] `pnpm --filter graph-fixtures test` 通过
- [ ] DEV：`arm` + `next` × N 肉眼可复现「首屏 fit、后续不抢缩放」
- [ ] Vitest 至少 1 条 sequence 断言 autofit 次数
- [ ] `dist/` 侧栏 bundle 无 `__listenGraphicFixture`
- [ ] 文档明确 web-demo 不验证 layout/autofit

---

## 10. 明确不做

- Overflow / Settings / Replay 上新增 fixture 入口
- 「手动 structure 步进」产品文案或 SW structurer 控制
- 用 mock structurer 实时生成 sequence
- v1 实现 `sequence-delta` 磁盘格式（仅 manifest 预留 version）
- 统一 web-demo dagre 与 Extension stable layout（长期另立项）

---

## 审阅后下一步

1. 审阅人确认本 spec。  
2. 使用 superpowers `writing-plans` 生成 `docs/superpowers/plans/2026-05-27-graph-layout-fixtures.md` 实施计划。  
3. 按 Step 1 → 2 → 3 执行；每步独立验收。
