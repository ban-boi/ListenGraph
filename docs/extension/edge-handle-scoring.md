# Edge Handle 评分选优算法

## 目的

本文记录 `resolveEdgeHandles` 从分区逻辑改为评分选优算法的设计理由、实现与测试结论。

**说明**：代码与行为若有出入，以代码为准。完整设计规格见 [评分选优设计文档](C:/Users/finni/Desktop/ListenGraph/docs/superpowers/specs/2026-05-14-edge-handle-scoring-design.md)。

---

## 问题

旧算法存在两个缺陷：

1. **隐藏 handle 泄漏**：`GraphNodeCard.tsx` 只暴露 4 个可见 handle（source: bottom/right，target: top/left），其余 4 个设为 `opacity: 0`。旧算法不感知此约束，可以返回 `source-top → target-bottom` 等使用隐藏 handle 的组合。当 AI structurer 返回的 edge 语义方向与视觉布局方向相反时（典型：分支节点 → 主节点），最容易触发——线看起来穿过了整个节点。

2. **对角线死区**：旧算法用 `EDGE_AXIS_DOMINANCE_RATIO = 1.25` 将空间分为「垂直」「水平」「对角线」三区，对角线区域一律 fallback 到 `bottom → top`，不根据实际几何方向选择。

---

## 方案

只从 4 个可见 handle 组合中选最优，对每种组合计算方向对齐评分（方向向量点积），取最高分。

### 算法流程

1. 计算 source 和 target 节点的矩形边界
2. 遍历 4 个可见 handle 组合：
   - 计算 handle 在矩形上的像素坐标
   - 算 source handle → target handle 的归一化方向向量
   - 出口对齐分 = 出口方向向量 · 方向向量
   - 入口对齐分 = 入口方向向量 · 方向向量
   - 总分 = 出口对齐分 + 入口对齐分
3. 选得分最高者；同分取 handle 间距最短者
4. 返回 `{ sourceHandle, targetHandle }`

### 4 个可见组合

| 组合 | source handle | target handle | 典型场景 |
|------|---------------|---------------|----------|
| ① | bottom | top | 垂直流 |
| ② | right | left | 水平流 |
| ③ | bottom | left | L 形（对角线） |
| ④ | right | top | 反 L 形（对角线） |

### 方向向量

| Handle | 角色 | 向量 |
|--------|------|------|
| source-bottom | 出口向下 | (0, 1) |
| source-right | 出口向右 | (1, 0) |
| target-top | 入口向下（线从上方进入） | (0, 1) |
| target-left | 入口向右（线从左方进入） | (1, 0) |

---

## 反向路径的处理

当 source 节点在 target 节点下方或右方时（语义 source→target 与视觉方向相反），不存在"出口方向与连线方向一致"的可见组合。此时算法选出的是「最不别扭」的可见组合——出口方向虽与连线方向不一致，但贝塞尔曲线仍然可以从节点出发后弯曲回到目标。

例如：source 在 (60, 240)、target 在 (60, 0) 的「正下→正上」场景，算法返回 `source-bottom → target-top`。虽然线从底部出发后要弯曲向上，但这是 4 个可见组合中评分最高的，且曲线自然。

---

## 实现

**改动文件**：
- `apps/extension/src/sidepanel/graph-utils.ts` — 替换 `resolveEdgeHandles`，删除 `EDGE_AXIS_DOMINANCE_RATIO`，新增常量和辅助函数
- `apps/extension/src/sidepanel/graph-utils.test.ts` — 8 个测试覆盖典型场景

**未改动**：
- `GraphNodeCard.tsx`（handle 可见性不变）
- 所有布局函数（`buildStableReactFlowDebugGraph` 等）
- 函数签名（保持向后兼容）

**提交**：`f2a8061` — `feat(graph): resolveEdgeHandles 改用评分选优算法，只选可见 handle 组合`

---

## 测试结论

| # | 场景 | 预期 | 实际 |
|---|------|------|------|
| 1 | 正上→正下 | bottom→top | PASS |
| 2 | 正下→正上 | 不用隐藏 handle | PASS |
| 3 | 正左→正右 | right→left | PASS |
| 4 | 正右→正左 | 不用隐藏 handle | PASS |
| 5 | 右下→左上 | bottom→top | PASS |
| 6 | 左下→右上 | right→left | PASS |
| 7 | 对角线死区 | bottom/left 或 right/top | PASS |
| 8 | 分支→主节点 | bottom→top | PASS |

场景 2 和 4 不锁定具体组合，只断言不使用隐藏 handle——因为对反向路径来说，4 个可见组合都涉及弯曲，算法选出的「最顺组合」可能因坐标微调而变化。

---

## 与布局优化的关系

此算法与节点布局完全解耦——只看两个节点的像素坐标，不关心节点是如何被放置的。后续布局模式变更（如层级展开、分组排列、接入 dagre/elk）不影响此算法的正确性。

---

## 相关文档

- [图谱几何：边锚点与 dagre / elk 布局器备忘](C:/Users/finni/Desktop/ListenGraph/docs/extension/graph-layout-dagre-elk-memo.md)
- [扩展增量图稳定性](C:/Users/finni/Desktop/ListenGraph/docs/extension/incremental-graph-stability.md)
- [评分选优设计规格](C:/Users/finni/Desktop/ListenGraph/docs/superpowers/specs/2026-05-14-edge-handle-scoring-design.md)
- [实现计划](C:/Users/finni/Desktop/ListenGraph/docs/superpowers/plans/2026-05-14-edge-handle-scoring.md)
