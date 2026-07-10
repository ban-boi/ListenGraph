# Round 4：R3b 实时增长与心理地图稳定性实验

> **状态**：待审阅。
> **日期**：2026-07-10
> **前置**：Round 3 结论 GO → R3b（静态快照可读性远优于 baseline）。

## 0. 背景与 Round 3 的边界

Round 3 证明了 R3b 在**最终态快照**上关系可读性远好于 baseline（穿越 -84%、边长 -80%）。但 Round 3 每次都从圆形初始位置全量重算，没有复用上一 revision 坐标。

用 sequence fixture 逐 revision 实测当前 R3b 全量重算的旧节点位移：
- `seq-incremental-growth` 后期 revision：旧节点中位移动 60-231px，最大 558px
- `seq-late-burst`：旧节点中位移动 ~101px，最大 ~306px

**这不是理论风险，是实测确认的问题。** 用户正在阅读时节点搬家 200-500px 会破坏心理地图。

## 1. 目标

**验证 R3b incremental 在实时增长过程中：旧节点能否少动、新节点能否合理落位、最终态是否仍接近 Round 3 的 R3b 质量。**

两个核心问题必须同时成立：
1. 增长过程中，我还能不能跟住原来的节点？
2. 增长结束后，最终图是否仍接近 Round 3 静态 R3b？

## 2. 架构决策（不在本轮实验范围，但定义方向）

### 2.1 R3b 作为统一坐标布局引擎

```
所有图 → R3b 统一坐标布局
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
  causal  comparison  hierarchy
   镜头       镜头       镜头
```

- R3b 决定所有节点在哪
- causal/comparison/hierarchy 不再各算一套坐标
- 它们只决定边优先级、颜色、标签等视觉层
- 切换视图时节点位置不变（更稳定）

**本轮不实现这个架构，但增量布局的坐标语义必须与之一致（全局坐标，不是簇内 local + offset）。**

### 2.2 detector 降级为视觉提示

不再让 detector 决定布局策略。supports/opposes/causes 关系仍存在，但只影响边的颜色/线型/优先级，不切换几何。

## 3. 三个候选

| 候选 | 增量策略 | 用途 |
|---|---|---|
| **Baseline（产品 stable layout）** | 复用旧坐标，只给新节点找位置 | 稳定性参照 |
| **R3b full-recompute** | 每个 revision 从圆形全量重算 | 暴露跳动有多严重 |
| **R3b incremental** | Pin 弹簧力 + 旧坐标初始 + 新节点邻居落位 | **本轮主验证目标** |

## 4. R3b incremental 的完整力定义

### 4.1 完整力迭代顺序

```
读取上一 revision 全局坐标
        ↓
旧节点原地初始化，新节点放在邻居附近
        ↓
  面积斥力
  边弹簧（spring）
  R3b 宽度惩罚（width penalty）
  Pin 弹簧力（只对旧节点）
        ↓
  Velocity + Damping
        ↓
  旧节点 Max Drift 保护
        ↓
  带 Mobility 的碰撞消除
        ↓
  输出新 revision 坐标
```

### 4.2 Pin 弹簧力（数学定义）

对上一 revision 已存在的节点 i：
- 上一 revision 位置：`p_prev[i]`
- 本轮迭代当前位置：`p[i]`
- Pin 弹簧力：`F_pin = PIN_K × (p_prev[i] - p[i])`

在力迭代的 Apply 之前，与边弹簧、斥力、宽度惩罚一起计算。

### 4.3 动态 Pin 强度

每个 cluster 单独计算变化率：

```
r = (新增节点数 + 0.5 × 受新边影响的旧节点数) / max(1, 旧节点数)
u = clamp(r / 0.30, 0, 1)
PIN_K = (1-u) × 0.10 + u × 0.025
```

效果：
- 新增 1-2 节点：PIN_K ≈ 0.08-0.10，旧节点基本不动
- 新增 ~10%：PIN_K ≈ 0.075
- 新增 ~20%：PIN_K ≈ 0.05
- 新增 ≥30%：PIN_K = 0.025，允许 cluster 明显重组
- 超过 30% 不再继续降低

### 4.3.1 跨 revision cluster 身份匹配（必须定义，不能按 clusterId 继承）

现有 `partitionClusters` 的 cluster ID 是 `cluster_${i}`，每轮重新生成 + 重新排序，不能跨 revision 追踪同一个 cluster。必须用 **nodeId 交集匹配**。

**匹配规则**：

```
对每个 newCluster，找上一 revision 中与之有 nodeId 交集的 oldCluster：

无交集           → 新 cluster（无旧坐标继承）
一个前驱         → 继承该前驱的全局 origin + 所有旧节点的全局坐标
多个前驱（merge）→ cluster 合并：所有旧节点保留各自全局坐标，新全局 origin = 旧 origins 加权平均
一个旧簇→多个新簇（split）→ 各子簇继承自己节点的旧坐标
```

**力计算边界**：力计算仍以当前连通分量为边界。不同 cluster 之间不计算斥力。全局坐标只是为了保存 origin 和跨 revision 的位置连续性，不代表所有节点一起跑一个巨型 force simulation。

**major/minor 跨 revision 行为**：
- add-only 序列里 major 状态单调：只要任一前驱曾是 major，后继 cluster 继承保持 major
- minor→major 时（簇长大了），使用旧节点的中心坐标作为完整卡片的初始中心
- major→minor 不会发生（add-only 只增不减）
- 位移指标使用节点中心 `(cx, cy)`，不使用 top-left

### 4.4 最大漂移保护

```
R_max = (1-u) × 50 + u × 100
```

每轮 Apply 后检查旧节点位移是否超过 R_max，超过则 clamp 回 R_max 半径内，并衰减速度到 25%。

```typescript
const anchor = previousPositions[id];
const dx = positions[id].cx - anchor.cx;
const dy = positions[id].cy - anchor.cy;
const distance = Math.hypot(dx, dy);
if (distance > maxDrift) {
  const scale = maxDrift / distance;
  positions[id].cx = anchor.cx + dx * scale;
  positions[id].cy = anchor.cy + dy * scale;
  velocities[id].x *= 0.25;
  velocities[id].y *= 0.25;
}
```

统计"触发漂移上限的旧节点比例"——如果大量节点撞上限，说明 Pin 参数有问题。

### 4.5 新节点初始位置（不再从圆形初始化）

**有旧邻居**：放在所有已存在邻居的重心附近 + 确定性偏移：
```typescript
const neighborCenter = average(neighbors.map(id => positions[id]));
const angle = stableHash(nodeId) % 360 * Math.PI / 180;
positions[newId] = {
  cx: neighborCenter.cx + Math.cos(angle) * SPRING_LENGTH,
  cy: neighborCenter.cy + Math.sin(angle) * SPRING_LENGTH,
};
```

**只有新邻居**：以这批新节点中第一个能连接到旧图的节点为锚点，其他新节点围绕它初始化。

**完全孤立**：作为新 cluster 放在现有图最下方，不触发旧 cluster 重新 packing。

### 4.6 Cluster 外层稳定性

- 已存在 cluster 保留上一 revision 的全局 origin
- cluster 扩大时只扩自己的 bounds
- 新 cluster 追加到现有布局下方
- 两个旧 cluster 被新边连接时，保留两边原坐标，让连接弹簧逐步拉近
- **直接使用上一 revision 的全局坐标运行 force**，避免"簇内 Pin 住了，外层 offset 又搬走"

### 4.7 带 Mobility 的碰撞消除

Mobility 与 PIN_K 共享同一个变化率 u（4.3 节），不是独立调参轴：

```typescript
u = clamp(r / 0.30, 0, 1);  // 与 PIN_K 相同的 u
newNodeMobility = 1.0;
oldNodeMobility = 0.2 + 0.4 × u;
```

即：少量更新（Pin 紧）→ 旧节点 mobility=0.2；大量更新（Pin 松）→ 旧节点 mobility=0.6。

碰撞位移分配（完整公式）：
```
Δp_a =  correction × mobility_a / (mobility_a + mobility_b)
Δp_b = -correction × mobility_b / (mobility_a + mobility_b)
```

碰撞修正后，旧节点再次执行 R_max drift clamp。

**"触发漂移上限比例"定义**：本 revision 中至少触发过一次 clamp 的唯一旧节点数 / 本 revision 旧节点数。不按迭代触发次数统计。

### 4.8 参数配置

```typescript
// 现有（R3b 不变）
SPRING_K = 0.06;
REPULSION_K = 6;
// 新增
PIN_K_TIGHT = 0.10;
PIN_K_LOOSE = 0.025;
PIN_SOFTEN_RATIO = 0.30;
MAX_DRIFT_TIGHT = 50;
MAX_DRIFT_LOOSE = 100;
```

**本轮只调两个轴**：`PIN_K` 和 `MAX_DRIFT`。R3b 的斥力、弹簧、宽度惩罚不再调。

## 5. 坐标语义

- **全局坐标**：不再做"簇内 local + 外层 offset"。旧 revision 的全局坐标直接作为新 revision 的初始位置。
- 力 simulation 内部使用中心点 `(cx, cy)`。
- 输出 top-left 格式 `{x, y}` 供 renderer。

## 6. 验证样本

### 6.1 Sequence fixture（逐步增长，已知步骤）

| fixture | 节点增长 | 用途 |
|---|---|---|
| `seq-incremental-growth` | 2→22 节点，8 步 | 渐进增长 |
| `seq-late-burst` | 0→1→13→16 节点，5 步 | 突发批量 |
| `seq-pattern-question-incremental` | 按步增长 | 语义结构增长 |

### 6.2 真实大图按 timestamp 回放

从 #49(271节点) 和 #41(258节点) 按 timestampMs 分批切成增长序列：
- #49：120 unique timestamps → 14 批（每批 ~20 节点）
- #41：75 unique timestamps → 13 批

**timestamp 回放确定性规则**：
1. 相同 `timestampMs` 的节点不得拆到不同批次（同时间戳的节点作为一个原子批次一起进入）
2. 边仅在 source 和 target 都已进入当前 revision 后才加入（不存在 dangling edge）
3. 最后一个 revision 的 nodes/edges 必须与原始图完全一致（回放完整性验证）

**第一个非空 revision 一致性**：R3b incremental 的第一个非空 revision 必须与 R3b full-recompute 使用**同一初始布局**（相同的圆形初始化 + 相同迭代）。否则后续差异既包含增量策略差异，也包含初始条件差异，无法归因。

### 6.3 小图防伤害

`seq-pattern-opposition`（4-5 节点）确保增量不伤害简单图。

## 7. 验证方式

### 7.1 时序可视化契约（心理地图是时间维度验收，不能只靠独立缩略图）

**固定坐标系**：
- 每个 candidate 在同一个 sequence 内使用**固定原点、固定 1:1 像素比例**
- 画布尺寸取该 sequence **最终 revision** 的 bounds，所有 earlier revision 共用同一画布尺寸
- **不允许每一帧独立 fit-to-content**（独立 fit 会让没动的节点也看起来移动）
- canvas 尺寸不同会导致缩放差异，掩盖或放大真实位移

**Revision 导航**：
- gallery 必须提供 revision slider 或 autoplay（从 rev 0 到最终，按时间间隔播放）
- 3-5 个追踪节点在**所有帧**保持相同的红色圈标记
- 位移热力图（可选）：节点颜色按本 transition 位移大小着色（绿=没动，红=移动大）

### 7.2 指标（自动计算，每 revision）

| 指标 | 含义 | 目标 |
|---|---|---|
| 旧节点中位位移 | 上一 revision 到本 revision，已存在节点的位移中位数 | < 30px |
| 旧节点最大位移 | 位移最大的旧节点 | < 100px |
| 触发漂移上限比例 | 旧节点中撞 R_max 的比例 | < 10% |
| 最终态 vs Round 3 静态 | 最后一个 revision 的布局与 Round 3 全量重算的差异 | 边长/穿越接近 |

### 7.3 可视化辅助

- **节点标记**：选 3-5 个旧节点，在所有 revision 截图里用红色圈标记，方便肉眼追踪它们有没有乱跑
- **位移热力图**（可选）：节点颜色按位移大小着色（绿=没动，红=移动大）

### 7.4 Go/No-Go 门槛

**位移门槛（每个相邻 revision transition 单独判定，不可聚合后掩盖坏步骤）**：

| 门槛 | 聚合方式 | 标准 |
|---|---|---|
| 旧节点中位位移 | 每个 transition 单独算，只统计两 revision 都存在的节点。**所有 transition 都必须满足。** 同时输出全 sequence 的 p50/p95。 | median < 30px |
| 旧节点最大位移 | 同上。R_max clamp 保证 ≤ 100px。 | max ≤ 100px（硬上限，无例外） |
| 触发漂移上限比例 | 每 transition：至少触发过一次 clamp 的唯一旧节点数 / 旧节点数 | < 10%（否则 Pin 参数应 NO-GO） |

**最终态质量门槛（最后一个 revision vs Round 3 全量重算，逐项判定，不可平均）**：

对每个指标，定义退化率：

```
degradation = max(0, incremental_value - static_value) / max(static_value, 1)
```

| 指标 | 标准 |
|---|---|
| avgEdgeLength | degradation < 15% |
| edgeCrossings | degradation < 15% |
| overlapPairs / nodeCount | degradation < 15%（Pin 最容易用重叠换稳定，必须查） |
| longEdgeRatio | degradation < 15% |

**每项都必须满足**。不能平均后判定。

| 门槛 | 标准 |
|---|---|
| 新节点落位 | 新节点有合理初始位置（不是随机散开），肉眼判断 |

## 8. 文件结构

```
tools/layout-lab/src/
├── incremental-types.ts        # Pin 参数 + mobility + 增量状态类型
├── incremental-force.ts        # R3b incremental 力导向（Pin + drift + mobility）
├── incremental-force.test.ts   # 单测（Pin 力正确性、drift clamp、mobility 分配）
├── replay-sequence.ts          # 读 sequence fixture → 逐 revision 跑三候选 → 截图
├── split-real-graph.ts         # 真实大图按 timestamp 切成增长序列
├── round4-gallery.ts           # 逐步对比 gallery + 指标 + 位移追踪
└── ...（Round 1-3 文件保留不动）
tools/layout-lab/outputs/
├── round4-replay/              # 每个序列每个 revision 的截图
├── round4-gallery.html         # 逐步对比 + 旧节点追踪标记
├── round4-metrics.json         # 逐 revision 指标
└── round4-decision.md          # 决策记录
```

## 9. 明确不做

- ❌ 不接入 sidepanel / 不改产品代码
- ❌ 不做 Worker / 分片 / cluster cache（出现真实延迟后再说）
- ❌ 不继续调 R3b 的斥力/弹簧/宽度惩罚参数
- ❌ 不实现"统一布局引擎 + 视图镜头"架构（只验证增量稳定性）
- ❌ 不做 feature flag（本轮是实验台验证）

## 10. Round 3 的实验台使命已完成

layout-lab 的前三轮已经回答了：
- Round 1：detector 误导 90%，主战场是多话题堆积
- Round 2：cluster-first 方向对，但簇内 hierarchy 布局不行
- Round 3：力导向 R3b 在静态快照上远优于 baseline

Round 4 是 layout-lab 的最后一轮——回答"R3b 在动态增长中是否稳定"。如果通过，layout-lab 使命完成，下一步进入产品接入（feature flag + React Flow + 增量稳定性的产品实现）。
