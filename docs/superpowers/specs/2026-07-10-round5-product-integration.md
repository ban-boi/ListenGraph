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

### 2.1 方案：VITE_LAYOUT_ENGINE

沿用 `VITE_FIXTURE_LAB` 的 build-time flag 模式：

```
VITE_LAYOUT_ENGINE=r3b
```

- `.env.development` 不设（默认 stable layout）
- 新增 `.env.r3b`（`VITE_LAYOUT_ENGINE=r3b`）
- `package.json` 加 `build:r3b` 脚本
- 代码里 `import.meta.env.VITE_LAYOUT_ENGINE === 'r3b'` 分支

**不扩展 `GraphDisplaySettings`**（运行时切换）——第一版只做 build-time flag，降低复杂度。后续可以加运行时 toggle。

### 2.2 分支位置

`App.tsx:611-619` 的 `useMemo` 是唯一集成切入点：

```typescript
const layoutBuild = useMemo(() => {
  if (import.meta.env.VITE_LAYOUT_ENGINE === 'r3b') {
    return buildR3bLayout({
      graph: panel.graph,
      previousState: r3bStateRef.current,
      currentView,
    });
  }
  return buildDebugViewArtifacts({
    graph: panel.graph,
    currentTimeMs: panel.currentTimeMs,
    selectedNodeId: panel.selectedNodeId,
    previousLayoutCache: layoutCacheRef.current,
  });
}, [panel.currentTimeMs, panel.graph, panel.selectedNodeId, currentView]);
```

## 3. R3b 布局内核

### 3.1 从实验台提取

把 `tools/layout-lab/src/` 的以下纯函数提取到一个正式位置（新 package 或 sidepanel 内模块）：

- `cluster-partition.ts` → `partitionClusters`
- `round3-types.ts` → `computeNodeSize`, `computeAllNodeSizes`, `FORCE_PARAMS`
- `force-core-v2.ts` → `resolveOverlaps`, `CenterPos`
- `cluster-force-layout.ts` → `layoutClusterForce`（内部函数，需 export）
- `incremental-force.ts` → `computeIncrementalLayout`
- `incremental-types.ts` → `IncrementalState`, `createEmptyIncrementalState`

**放在哪**：`packages/graph-renderers/src/r3b/`（跟现有 renderer 同级），因为它们是纯布局逻辑，无 React/DOM 依赖。

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

## 5. 需要适配的现有逻辑

| 现有逻辑 | 改动 |
|---|---|
| `buildStableReactFlowDebugGraph` | R3b 开启时跳过，用 `computeIncrementalLayout` |
| `GraphNodeCard` minWidth/maxWidth | 加 adaptiveSize 分支 |
| `fitView`（App.tsx auto-fit） | 不改（React Flow 自动按 node bounds 算） |
| `auto-tour` displayMode | 不改（compact 叠加自适应尺寸） |
| `StableLayoutCache` | R3b 开启时不使用，改用 `IncrementalState` |
| `VIEW_EDGE_PRIORITIES` | 不改（边过滤逻辑复用） |
| `resolveEdgeHandles` | 不改（按 position 算 handle，跟布局算法无关） |

## 6. 验证

### 6.1 真实 React Flow 截图

用第一轮的 `loadGraph` + Playwright 截图管线，截 r3b build 的真实 sidepanel：
- 复用 `e2e-helpers.ts` 的 `launchExtensionContext` + `openSidepanelPage`
- 用 `__listenGraphicFixture.loadGraph()` 灌真实图
- 截 23 条代表样本

### 6.2 增量增长验证

用 `fixture-sequence-dev.ts` 的 `arm`/`next` 逐步灌入 sequence fixture，每步截图，验证旧节点不动。

### 6.3 Go/No-Go 门槛

| 门槛 | 标准 |
|---|---|
| 视觉可读性 | 真实 React Flow 截图中 R3b 大图可读性综合权衡优于 stable layout（边长更短、关系更清晰） |
| 增量稳定 | 旧节点在 sequence 逐步灌入时位移 < 5px |
| 性能 | 271 节点图从 graph 更新到 React Flow 渲染完成 < 500ms（含力导向计算） |
| 无回归 | R3b 关闭时产品行为与改动前完全一致（feature flag 隔离） |
| 自适应尺寸 | 节点尺寸按文本长度合理变化，不破坏 compact/auto-tour |

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
└── package.json              # build:r3b 脚本
```

## 8. 不做

- ❌ 不做运行时 layout toggle（第一版只用 build-time flag）
- ❌ 不做 Worker/分片（先跑，卡了再说）
- ❌ 不改 view scoring / pickDefaultView
- ❌ 不改 edge handle 逻辑
- ❌ 不做 cluster summary / overview（B 候选）——产品化只做 A（分区 + 力导向 + 硬固定增量）

## 9. 残留带入

从 Round 4 带入的两个残留：
1. **净距 <16px 残留**：#49 有 43 对、#41 有 19 对。产品实现中碰撞清理"运行到满足净距或达到上限，记录残留数"。
2. **穿越表述**：causal baseline 的 #49/#41 穿越比 R3b 低。R3b 优势是边长显著缩短和综合可读性，不是穿越数。
