# Edge Handle 评分选优算法设计

**日期**：2026-05-14
**状态**：已批准
**影响文件**：`apps/extension/src/sidepanel/graph-utils.ts`、`graph-utils.test.ts`

---

## 问题

`resolveEdgeHandles` 函数存在两个问题：

1. **隐藏 handle 泄漏**：`GraphNodeCard.tsx` 只暴露 4 个可见 handle（source: bottom/right，target: top/left），但算法可以返回使用隐藏 handle（opacity:0）的组合，如 `source-top → target-bottom`。当 AI structurer 返回的 edge 方向和视觉布局方向相反时（如分支→主节点），最容易触发。

2. **对角线死区**：用 `EDGE_AXIS_DOMINANCE_RATIO = 1.25` 分三区，对角线区域一律 fallback 到 `bottom → top`，不根据实际方向选择。

## 方案：评分选优法

只从 4 个可见 handle 组合中选，对每种计算方向对齐评分，取最优。

### 算法

```
输入：source 节点坐标，target 节点坐标

1. 计算 source 和 target 的矩形边界（getNodeRect）
2. 遍历 4 个可见 handle 组合：
   a. 计算 handle 像素坐标（getHandlePosition）
   b. 算 source handle → target handle 的归一化方向向量 (nx, ny)
   c. exitScore = 出口方向向量 · (nx, ny)
   d. entryScore = 入口方向向量 · (nx, ny)
   e. totalScore = exitScore + entryScore
3. 选得分最高者；同分取 handle 间距最短者
4. 返回 { sourceHandle, targetHandle }
```

### 方向向量

| Handle | 方向 | 向量 |
|--------|------|------|
| source-bottom | 出口向下 | (0, 1) |
| source-right | 出口向右 | (1, 0) |
| target-top | 入口向下（线从上方进入） | (0, 1) |
| target-left | 入口向右（线从左方进入） | (1, 0) |

### 4 个可见组合

| 组合 | source handle | target handle | 典型场景 |
|------|---------------|---------------|----------|
| ① | bottom | top | 垂直流 |
| ② | right | left | 水平流 |
| ③ | bottom | left | L 形（对角线） |
| ④ | right | top | 反 L 形（对角线） |

## 改动

### 删除

- `EDGE_AXIS_DOMINANCE_RATIO` 常量
- 旧的三分支 if/else 逻辑

### 新增

- `VISIBLE_HANDLE_COMBINATIONS` 常量（4 个组合）
- `getHandlePosition(rect, handleId)` 辅助函数
- `EXIT_DIRECTIONS` / `ENTRY_DIRECTIONS` 方向向量映射
- 重写 `resolveEdgeHandles` 函数

### 不改

- `GraphNodeCard.tsx`（handle 可见性不变）
- 所有布局函数（`buildStableReactFlowDebugGraph` 等）
- `resolveEdgeHandles` 的函数签名（保持向后兼容）

## 测试用例

| # | 场景 | source 坐标 | target 坐标 | 预期 |
|---|------|-------------|-------------|------|
| 1 | 正上→正下 | (60, 0) | (60, 200) | bottom→top |
| 2 | 正下→正上 | (60, 240) | (60, 0) | bottom→top |
| 3 | 正左→正右 | (60, 0) | (420, 10) | right→left |
| 4 | 正右→正左 | (420, 0) | (60, 10) | right→left |
| 5 | 右下→左上 | (340, 0) | (60, 200) | bottom→top |
| 6 | 左下→右上 | (60, 200) | (340, 0) | right→left |
| 7 | 对角线死区 | (60, 0) | (240, 180) | bottom→left 或 right→top |
| 8 | 分支→主节点 | (340, 100) | (60, 300) | bottom→top |

## 与布局优化的关系

此算法与节点布局完全解耦——只看两个节点的像素坐标，不关心节点是如何被放置的。后续布局模式变更（如层级展开、分组排列）不影响此算法。
