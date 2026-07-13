# Round 5：R3b 产品化接入设计文档

> **状态**：待审阅。
> **日期**：2026-07-10
> **前置**：Round 1-4 实验台完成。R3b（cluster-first + 力导向 + 硬固定增量）在实验台验证通过。几何收口达标（bounds 100%、重叠 0、间距 ≥16px）。

## 0. 目标

**把 R3b 接入真实 sidepanel，通过 feature flag 开启，验证在真实 React Flow 中的视觉效果、增量稳定性和性能。**

核心布局方向不再改。本轮只做"把实验台验证过的算法接进产品"。

## 1. 架构决策

### 1.1 统一坐标 + 视图镜头

R3b 是 view-agnostic 的——按图拓扑布局，不管 causal/hierarchy/timeline/comparison。开启 R3b 后：
- **节点位置**由 R3b 统一计算，四个视图共用同一套坐标
- **视图切换**只影响边的过滤/颜色/优先级（`VIEW_EDGE_PRIORITIES`），不改节点位置
- 切换视图时节点不动 → 更稳定

### 1.2 自适应节点尺寸

R3b 开启时，`GraphNodeCard` 的尺寸改为按文本长度自适应：
- readable 模式：80-200px 宽（实验台验证过的范围）
- compact 模式（auto-tour 时）：保留现有 140-200px
- 与现有 `autoFitMinReadableFontPx`（zoom 控制）不冲突——自适应改的是卡片尺寸，autoFit 改的是缩放比例

### 1.3 现有视图/尺寸逻辑保留

- `displayMode: 'readable' | 'compact'` 逻辑保留，自适应尺寸叠加在上面
- `autoFitMinReadableFontPx` 保留
- auto-tour 的 compact 切换保留

## 2. Feature Flag

### 2.1 方案：VITE_LAYOUT_ENGINE + 双 build 变体

沿用 `VITE_FIXTURE_LAB` 的 build-time flag 模式：

```
VITE_LAYOUT_ENGINE=r3b
```

**三个 build 变体**：

| 脚本 | env 文件 | 含 R3b | 含 fixture API | 用途 |
|---|---|---|---|---|
| `build` | `.env.production` | ❌ | ❌ | 生产 |
| `build:r3b` | `.env.r3b` | ✅ | ❌ | R3b 候选产品包 |
| `build:r3b:fixture-lab` | `.env.r3b-fixture-lab` | ✅ | ✅ | Playwright 截图用 |

`.env.r3b`:
```
VITE_LAYOUT_ENGINE=r3b
```

`.env.r3b-fixture-lab`:
```
VITE_LAYOUT_ENGINE=r3b
VITE_FIXTURE_LAB=true
```

`vite-env.d.ts` 加 `VITE_LAYOUT_ENGINE?: string`。

**隔离测试**：`fixture-build.prod.test.ts` 已验证 prod bundle 不含 `__listenGraphicFixture`。需加一个 `fixture-build.r3b.test.ts` 验证 `build:r3b` 产物也不含 fixture API（只有 `build:r3b:fixture-lab` 含）。

**不扩展 `GraphDisplaySettings`**（运行时切换）——第一版只做 build-time flag，降低复杂度。后续可以加运行时 toggle。

### 2.2 分支位置（两层拆分：geometry transition vs artifact decoration）

**不能在同一个 useMemo 里既算 R3b 增量布局又处理选中/时间/视图。** 原因：`useMemo` 依赖 `currentTimeMs`（播放时每秒变）、`selectedNodeId`（点击就变）、`currentView`（切视图就变），而 `computeIncrementalLayout` 是有状态的——每次调用推进 `IncrementalState`，碰撞清理会微调位置。如果这些高频变化触发它，旧节点会反复移动。

**必须拆成两层**：

**层 1 — Geometry Transition（低频，只由 graph revision 触发）**：

```typescript
// 只在 graph revision 变化时算 R3b 布局，推进 IncrementalState
const r3bLayout = useMemo(() => {
  if (!isR3b) return null;
  return buildR3bLayout({
    graph: panel.graph,
    previousState: r3bStateRef.current,
  });
}, [panel.graph]);  // 只依赖 graph，不依赖 time/view/selected

// 用 useLayoutEffect 提交状态（不在 render 中直接写 ref）
useLayoutEffect(() => {
  if (r3bLayout) {
    r3bStateRef.current = r3bLayout.nextState;
  }
}, [r3bLayout]);
```

**层 2 — Artifact Decoration（高频，处理选中/时间/视图，不推进 R3b 状态）**：

```typescript
const debugViewArtifacts = useMemo(() => {
  if (!isR3b || !r3bLayout) {
    return buildDebugViewArtifacts({ ... });  // 现有 stable layout
  }
  // R3b：用已有 positions 做纯装饰（边过滤、handle、active 状态），不重算布局
  return decorateR3bArtifacts({
    positions: r3bLayout.positions,
    sizes: r3bLayout.sizes,
    graph: panel.graph,
    currentView,
    currentTimeMs: panel.currentTimeMs,
    selectedNodeId: panel.selectedNodeId,
  });
}, [r3bLayout, panel.currentView, panel.currentTimeMs, panel.selectedNodeId, panel.graph]);
```

**IncrementalState 幂等性**：增加 `appliedRevision` 字段。`buildR3bLayout` 如果收到相同 revision 的 graph，直接返回已有 positions（幂等），不重算。

**明确触发规则**：

| 事件 | 层 1（Geometry） | 层 2（Decoration） |
|---|---|---|
| 新 revision（structurer 产出新节点/边） | ✅ 推进 R3b | ✅ 重装饰 |
| 播放时间更新（currentTimeMs 变） | ❌ 不动 | ✅ 重装饰（active 状态） |
| 选中节点（selectedNodeId 变） | ❌ 不动 | ✅ 重装饰（高亮） |
| 视图切换（currentView 变） | ❌ 不动 | ✅ 重装饰（边过滤） |
| 文本/尺寸变化（同 revision 节点内容变） | ✅ 重算（节点尺寸变了 → 碰撞失效） | ✅ 重装饰 |
| 仅新增边（无新节点） | ❌ 不推进布局 | ✅ 重装饰（边列表变） |
| Session 切换 | ✅ 重置 + 首布局 | ✅ 重装饰 |
| 节点删除 | ✅ 重算（连通分量可能变） | ✅ 重装饰 |

## 3. R3b 布局内核

### 3.1 从实验台提取（单一实现来源）

把 `tools/layout-lab/src/` 的以下纯函数提取到 `packages/graph-renderers/src/r3b/`：

- `cluster-partition.ts` → `partition.ts`
- `round3-types.ts` → `node-size.ts`
- `force-core-v2.ts` → `force-core.ts`
- `cluster-force-layout.ts` → `cluster-force.ts`
- `incremental-force.ts` → `incremental.ts`
- `incremental-types.ts` → `types.ts`

**提取后，`tools/layout-lab/` 反向 import `@listen-graphic/graph-renderers/r3b`**，删除实验台里的重复实现。这样实验台和产品永远用同一份代码。

**等价测试**：用 Round 3/4 的固定样本（#49/#41/#32 + seq-incremental-growth），对比提取前后的 positions 完全一致。

### 3.2 坐标转换

R3b 内部用中心点 `(cx, cy)`，React Flow 需要 top-left `{x, y}`。转换在 `buildR3bLayout` 出口做：

```typescript
function centerToTopLeft(cx: number, cy: number, size: NodeSize): Position {
  return { x: cx - size.width / 2, y: cy - size.height / 2 };
}
```

### 3.3 增量状态

新增 `r3bStateRef = useRef<IncrementalState>(createEmptyIncrementalState())`，与现有 `layoutCacheRef` 平行。

Session 切换时重置（跟 `layoutCacheRef` 同步重置）。

### 3.4 输出格式

`buildR3bLayout` 返回与 `buildDebugViewArtifacts` 相同的结构：

```typescript
{
  artifacts: Record<ViewType, DebugViewArtifact>,
  nextR3bState: IncrementalState,
}
```

所有四个视图的 `artifacts[view].reactFlow.nodes` 用相同 positions（R3b 算的），但 edges 按 `VIEW_EDGE_PRIORITIES[view]` 过滤。

## 4. GraphNodeCard 自适应

### 4.1 改动范围

`GraphNodeCard.tsx` 的 `minWidth`/`maxWidth` 改为接收外部传入的尺寸：

```typescript
interface GraphNodeCardData {
  // ... 现有字段
  adaptiveSize?: { width: number; height: number };  // R3b 模式传入
}
```

- R3b 开启时：`style.width = adaptiveSize.width`, `style.height = adaptiveSize.height`
- R3b 关闭时：保留现有 `minWidth/maxWidth` 逻辑
- compact 模式叠加：`min(adaptiveSize.width, compactMaxWidth)`

### 4.2 React Flow node style

React Flow 的 node `style` 需要设 `width` 和 `height`，否则自适应尺寸的碰撞检测和 fitView 不准确。在 `App.tsx` 构建 `flowNodes` 时注入：

```typescript
style: {
  ...(isR3b ? { width: adaptiveSize.width, height: adaptiveSize.height } : {}),
}
```

## 5. 统一 NodeGeometry 契约

### 5.1 问题

当前多个地方写死 `220×132`：
- `graph-utils.ts:35-36`：`STABLE_LAYOUT_CARD_WIDTH/HEIGHT`
- `graph-utils.ts:145-147`：`getNodeRect` 用它算碰撞矩形
- `graph-utils.ts:243`：`resolveEdgeHandles` 用它算 handle 位置
- `auto-tour-utils.ts:49-50`：用它算 tour bounds

R3b 的自适应尺寸意味着这些地方**全部需要改**。不能只改 GraphNodeCard。

### 5.2 NodeGeometry 定义

```typescript
export type NodeGeometry = {
  position: { x: number; y: number };  // top-left（React Flow 格式）
  size: { width: number; height: number };
};
```

所有消费节点几何的代码都从 `NodeGeometry` 取尺寸，不再用固定常量：
- React Flow `node.style.width/height`
- `resolveEdgeHandles`：按实际 size 算矩形中心
- `auto-tour-utils.ts`：按实际 size 算 bounds
- `fitView`：React Flow 自动按实际 style 算（不改）
- 布局碰撞检测：按实际 size 算 AABB

### 5.3 尺寸公式必须覆盖真实卡片结构

实验台公式 `computeNodeSize(text)` 只看文本长度，但真实 `GraphNodeCard` 还有：
- 类型标签（`text-2xs`，约 16px 高）
- 时间戳（可选，约 16px 高）
- speaker 标签（可选，约 16px 高）
- padding（`var(--sp-4)` 约 16px）
- 行截断（`-webkit-line-clamp` 2-3 行）

**更新尺寸公式**，让它覆盖真实卡片结构：

```typescript
// 真实卡片高度 = 标签区 + 文本区 + 可选区 + padding
function computeRealNodeSize(
  text: string,
  nodeType: NodeType,
  hasSpeaker: boolean,
  hasTimestamp: boolean,
  displayMode: 'readable' | 'compact',
): NodeSize {
  const isCompact = displayMode === 'compact';
  const maxTextChars = isCompact ? 56 : 80;
  const displayText = truncate(text, maxTextChars);
  const charWidth = isCompact ? 7 : 12;
  const padding = isCompact ? 8 : 16;

  // 宽度
  const idealWidth = Math.min(
    isCompact ? 200 : 220,   // maxWidth
    Math.max(isCompact ? 140 : 80, displayText.length * charWidth + padding * 2),
  );
  // 行数
  const charsPerLine = Math.floor((idealWidth - padding * 2) / charWidth);
  const lineCount = Math.max(1, Math.ceil(displayText.length / Math.max(1, charsPerLine)));
  const lineHeight = isCompact ? 16 : 18;

  // 高度 = type标签 + 文本行 + speaker(可选) + timestamp(可选) + padding
  const typeLabelH = 16;
  const textH = lineCount * lineHeight;
  const speakerH = hasSpeaker ? 14 : 0;
  const timestampH = hasTimestamp ? 14 : 0;
  const height = typeLabelH + textH + speakerH + timestampH + padding * 2;

  return { width: idealWidth, height: Math.max(isCompact ? 50 : 60, height) };
}
```

**compact 模式只改变内容密度**（字宽、行高、maxTextChars），不改变外层布局盒尺寸的计算方式。auto-tour 切换 readable→compact 时，外层尺寸会按新公式重算，但因为层 1（Geometry）不在 compact 切换时触发，不会导致位移。

### 5.4 box-sizing / overflow

```css
box-sizing: border-box;
overflow: hidden;
```

所有卡片统一，确保 `width/height` 是外框尺寸（含 padding），文本超出截断。

## 6. 验证

### 6.1 真实 React Flow 截图

用第一轮的 `loadGraph` + Playwright 截图管线，截 r3b build 的真实 sidepanel：
- 复用 `e2e-helpers.ts` 的 `launchExtensionContext` + `openSidepanelPage`
- 用 `__listenGraphicFixture.loadGraph()` 灌真实图
- 截 23 条代表样本

### 6.2 增量增长验证

用 `fixture-sequence-dev.ts` 的 `arm`/`next` 逐步灌入 sequence fixture，每步截图，验证旧节点不动。

### 6.3 Go/No-Go 门槛（可重复、可自动化）

**固定 23 条样本**（Round 2 的 `SAMPLE_INDICES`），分为大图（16 条）和小图（7 条）。

| 门槛 | 度量方式 | 标准 |
|---|---|---|
| 大图可读性 | 基于**真实 DOM bounds** 的指标（通过 Playwright `getBoundingClientRect` 读取，不用布局算法内部坐标） | 大图中 R3b 的 `avgEdgeLength` 比稳定布局 (stable) 短 ≥40%；`edgeCrossings` 不恶化超 15%（注意：稳定布局 causal 本身穿越可能更低，但边长远长于 R3b，综合权衡） |
| 小图防伤害 | 同上指标 | 小图中 R3b 的 `overlapPairs/nodeCount` = 0；`avgEdgeLength` 恶化不超过 20% |
| 增量稳定 | 选中/时间 tick/view 切换时旧节点位移 | **0px**（层 2 装饰不推进 R3b 状态，位置不变） |
| 净距 | 真实 DOM bounds，相邻节点对最小净距 | ≥16px（允许 ≤5% 残留对，记录残留数） |
| 性能 | 多次运行 p95（计算 + React commit） | 计算（`computeIncrementalLayout`）p95 < 200ms；graph 更新到 React Flow commit p95 < 500ms（271 节点） |
| 无回归 | R3b 关闭时 `build`（prod）运行现有全部 sidepanel 测试 | 全部通过，零行为差异 |

**关于净距残留**：Round 4 实测 #49 有 43 对、#41 有 19 对略低于 16px。产品实现中碰撞清理运行到满足净距或达到明确上限（如 30 轮），记录残留数。残留率 <5% 算通过。

## 7. 文件结构

```
packages/graph-renderers/src/r3b/
├── index.ts                  # re-export
├── partition.ts              # partitionClusters（从 lab 提取）
├── force-core.ts             # resolveOverlaps, CenterPos
├── node-size.ts              # computeNodeSize, computeAllNodeSizes, FORCE_PARAMS
├── cluster-force.ts          # layoutClusterForce（首次布局）
├── incremental.ts            # computeIncrementalLayout（增量布局）
└── types.ts                  # IncrementalState, NodeSize, etc.

apps/extension/src/sidepanel/
├── r3b-layout.ts             # buildR3bLayout（适配层：R3b → DebugViewArtifact）
└── App.tsx                   # useMemo 分支 + r3bStateRef

packages/ui/src/
└── GraphNodeCard.tsx         # adaptiveSize 分支

apps/extension/
├── .env.r3b                  # VITE_LAYOUT_ENGINE=r3b
├── .env.r3b-fixture-lab      # VITE_LAYOUT_ENGINE=r3b + VITE_FIXTURE_LAB=true
└── package.json              # build:r3b + build:r3b:fixture-lab 脚本
```

## 8. 不做

- ❌ 不做运行时 layout toggle（第一版只用 build-time flag）
- ❌ 不做 Worker/分片（先跑，卡了再说）
- ❌ 不改 view scoring / pickDefaultView
- ❌ 不改 edge handle 逻辑
- ❌ 不做 cluster summary / overview（B 候选）——产品化只做 A（分区 + 力导向 + 硬固定增量）

## 9. 残留带入

从 Round 4 带入的两个残留：
1. **净距 <16px 残留**：#49 有 43 对、#41 有 19 对。Go/No-Go 门槛允许 ≤5% 残留率。产品实现中碰撞清理"运行到满足净距或达到上限（如 30 轮），记录残留数"。
2. **穿越表述**：causal baseline 的 #49 穿越比 R3b 低。R3b 优势是**边长显著缩短和综合可读性**，不是穿越数。Go/No-Go 中 edgeCrossings 门槛改为"不恶化超 15%"而非"优于 baseline"。
