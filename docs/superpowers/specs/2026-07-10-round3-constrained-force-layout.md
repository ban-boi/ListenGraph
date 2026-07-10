# Round 3：Constrained Force Layout + Cluster + 自适应节点设计文档

> **状态**：方向已确认，待 spec 审阅后转入 writing-plans。
> **日期**：2026-07-10
> **前置**：
> - Round 1 诊断集结论：多话题 74%，真实争论 6%，detector 误导 90%
> - Round 2 验证结论：cluster-first 分区方向对，但簇内复用 hierarchy 固定 lane 布局不行；力导向（Strategy D）"好太多了"
> - 簇内对比实验结论：力导向（Strategy D 系列）远好于直线排布（拓扑/扇形/列分组）；D1（center-axis gravity）和 D2（soft width penalty）在单簇对比上看不出明显差异，两者都推到 Round 3 做全图验证

## 0. 目标

**验证"D2 力导向簇内布局 + cluster-first 外层组织 + 自适应节点大小"是否比当前 baseline 更可读。**

这是 go/no-go 决策实验。如果收益明显，下一步产品化；如果没收益，砍掉不背债。

## 1. 三个组件

### 1.1 自适应节点大小

**为什么**：当前固定 220×132px 卡片对 sidepanel 太大，导致力导向空间不足、节点重叠多。真实数据里 85% 的节点文本在 10-40 字，不需要这么大的卡片。

**怎么算**：

```typescript
// 宽高都根据文本长度自适应
// 字符宽度估算：中文约 14px，英文约 8px，混合取 12px/字
const CHAR_WIDTH = 12;
const LINE_HEIGHT = 18;
const PADDING = 12;           // 卡片内 padding
const MIN_WIDTH = 80;         // 最小宽度（极短文本）
const MAX_WIDTH = 200;        // 最大宽度（超长截断）
const MIN_HEIGHT = 50;        // 最小高度（1行 + type 标签）
const TYPE_LABEL_HEIGHT = 16; // 类型标签高度

function computeNodeSize(text: string): { width: number; height: number } {
  const textLen = text.length;
  // 宽度：按字符数估算，限制在 MIN-MAX 之间
  const idealWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, textLen * CHAR_WIDTH + PADDING * 2));
  // 行数：按理想宽度能放多少字
  const charsPerLine = Math.floor((idealWidth - PADDING * 2) / CHAR_WIDTH);
  const lineCount = Math.max(1, Math.ceil(textLen / charsPerLine));
  // 高度：类型标签 + 文本行 + padding
  const height = Math.max(MIN_HEIGHT, TYPE_LABEL_HEIGHT + lineCount * LINE_HEIGHT + PADDING * 2);
  return { width: idealWidth, height };
}
```

**尺寸范围**（基于真实数据 P50=21字、P90=42字，公式实际输出已验证）：
- 21 字节点：宽 200px，高 76px（2 行，14 字/行）
- 42 字节点：宽 200px，高 94px（3 行，14 字/行）
- 10 字节点：宽 144px，高 58px（1 行）
- 60 字节点：宽 200px，高 130px（5 行）

### 1.2 D2 力导向簇内布局（升级版）

**基于 Round 2 的 D2 原型，两个改进**：

1. **斥力按实际节点尺寸算**：两个节点之间的斥力不再是固定常数，而是跟它们面积成正比——大节点斥力更大，自然推开得更远，减少重叠。

```typescript
// 替代固定 REPULSION：
// 斥力 ∝ 节点A面积 × 节点B面积 / 距离²
const areaA = sizeA.width * sizeA.height;
const areaB = sizeB.width * sizeB.height;
const repulsion = REPULSION_K * Math.sqrt(areaA * areaB) / (dist * dist);
```

2. **碰撞检测用实际矩形**：弹簧松弛后做一次碰撞消除——如果两个节点矩形重叠，把它们沿连线方向轻微推开。这是 D0-D2 原型缺的后处理。

```typescript
// 力导向迭代结束后，做 N 轮碰撞消除
function resolveOverlaps(positions, sizes, edges, rounds = 20) {
  for (let r = 0; r < rounds; r++) {
    for (each pair (a, b) that overlaps) {
      // 沿 a→b 方向推开，位移 ∝ 重叠量
      const overlap = computeOverlap(positions[a], sizes[a], positions[b], sizes[b]);
      push apart by overlap * 0.5;
    }
  }
}
```

### 1.3 Cluster-first 外层组织

复用 Round 2 已验证的 cluster partition + row packing：
- UnionFind 连通分量分区
- major/minor 分类（major: nodeCount≥3 或 edgeCount≥2 或 maxDegree≥2）
- major 簇独立布局（这次用 D2 力导向，不再用 hierarchy）
- minor 簇 → loose notes 打包
- cluster 间 row packing（bounds + gap）

**不变**：分区算法、major/minor 规则、排序、row packing 逻辑都复用 Round 2 已测试的代码。

**改变**：外层 packing 的 `MAX_ROW_WIDTH` 从 Round 2 的 1200 改为 `OUTER_TARGET_WIDTH = 800`（sidepanel/mobile 友好）。major cluster 默认纵向堆叠（一个簇占一行），不横向并排。

## 2. 候选定义

| 候选 | 簇内布局 | 节点大小 | 外层 |
|---|---|---|---|
| **Baseline** | 当前产品布局，view 跟随 `graph.viewHints?.defaultView ?? 'causal'`（已修正，见 commit `0af2a38`） | 固定 220×132 | 无分簇 |
| **Candidate R3a** | D1 力导向（引力收窄 + 面积斥力 + 碰撞消除） | 自适应（80-200px 宽） | cluster-first packing |
| **Candidate R3b** | D2 力导向（宽度惩罚 + 面积斥力 + 碰撞消除） | 自适应（80-200px 宽） | cluster-first packing |

做 2 个候选（R3a/R3b），因为单簇对比看不出 D1/D2 谁更好，需要全图 + 自适应节点后才能判定。

### 2.1 力定义（R3a 和 R3b 共用，区别只在竖向约束力）

每个力导向簇内布局包含以下力的完整组合：

1. **Spring attraction**（边弹簧）：相连节点之间有弹簧力，目标长度 `SPRING_LENGTH`，刚度 `SPRING_K`。
2. **Area repulsion**（面积斥力）：所有节点对之间有斥力，斥力大小 ∝ `√(areaA × areaB)`（大节点斥力更大）。
3. **Damping**（阻尼）：每轮迭代速度乘以 `DAMPING`。
4. **竖向约束力**（R3a vs R3b 的唯一区别）：
   - **R3a（center-axis gravity）**：每个节点受一个朝向 X 中心轴的持续引力 `force.x = (centerX - node.x) × GRAVITY_STRENGTH`。温和收窄。
   - **R3b（soft width penalty）**：只有节点 X 超出 `[0, targetWidth]` 时才有反推力 `force.x = overshoot × PENALTY_STRENGTH`。越界才管。
5. **Post-process: resolveOverlaps**（碰撞消除）：力导向迭代结束后，做 N 轮碰撞消除——重叠的节点对沿连线方向推开。

**`targetWidth`**：R3a 和 R3b 都用 `targetWidth = 600`（sidepanel 友好宽度）。

### 2.2 坐标语义（必须统一）

力 simulation 内部使用**节点中心点** `(cx, cy)`。
- 渲染时：`left = cx - width/2`，`top = cy - height/2`
- 边端点：用中心点 `(cx, cy)`
- 碰撞矩形：由中心点 + 尺寸推出 `{left: cx-w/2, right: cx+w/2, top: cy-h/2, bottom: cy+h/2}`
- 面积斥力：用 `width × height`

## 3. 代表样本

复用 Round 2 的 23 条样本（覆盖大图/中图/小图/碎片图/长标签）：
- 大图多分量：#49(271), #41(258), #48(237), #34(187), #47(180), #40(161), #29(140), #28(137), #39(118), #61(116), #31(112), #46(105)
- 中等：#37(103), #32(91), #58(31), #57(13)
- 小图/防伤害：#18(8), #21(5), #16(2), #12(2), #6(12 孤立)
- 长标签：#33(64), #51(66)

每条图截 3 张（baseline + R3a + R3b）→ 69 张截图。

## 4. 验证方式

**离线 HTML + Playwright 截图**（不碰产品代码）。

### 4.1 离线 renderer 升级

Round 2 的 `html-renderer.ts` 需要两个改动：
1. 节点 div 用自适应宽高（不再固定 220×132）
2. 边的 svg line 端点用实际节点中心（不再是固定 CARD_WIDTH/2）

### 4.2 指标（自动计算）

每条图每个候选算这些指标：

| 指标 | 含义 | 目标 |
|---|---|---|
| 画布宽高比 | W/H | < 0.5（竖向） |
| 平均边长 | 所有边的欧氏距离均值 | 越短越好 |
| 长边比例 | 长度 > 画布对角线 30% 的边占比 | < 10% |
| 节点重叠对数 | 矩形相交的节点对数 | < 节点数 × 0.3 |
| 边穿越节点数 | 边直线穿过其他节点矩形的次数 | 越低越好 |

**注意**：节点重叠和边穿越要分开统计（Round 2 的教训：重叠会污染穿越数）。

### 4.3 人眼终判

打开 `outputs/round3-gallery.html`，三栏并排（baseline | R3a | R3b），含指标。

**主要看**：
1. 大图是否不再"一片乱"？关系一眼能看懂？
2. R3a（引力收窄）和 R3b（宽度惩罚）在全图上谁更好？（单簇看不出差异，全图才能判定）
3. 节点是否不重叠了？自适应大小是否合理？
4. 画布是否竖向收窄了？sidepanel 友好？
5. 小图是否没被伤害？

### 4.4 Go/No-Go 门槛

| 门槛 | 标准 |
|---|---|
| 大图收益 | 大图样本里 R3 在 70%+ 被人眼判为优于 baseline |
| 小图防伤害 | 小图样本里 R3 不超 20% 被判为明显更差 |
| 节点重叠 | 大图样本中，R3a 和 R3b 的 `overlapPairs / nodeCount` 中位数均 < 0.3 |
| 宽高比 | R3a 和 R3b 大图画布宽高比中位数 < 0.5 |

## 5. 文件结构

```
tools/layout-lab/src/
├── round3-types.ts           # 自适应节点尺寸类型 + NodeSize 计算
├── force-layout-v2.ts        # 力导向核心（面积斥力 + spring + damping + resolveOverlaps）
├── cluster-force-layout.ts   # cluster 外层 + 力导向簇内 = R3a/R3b 候选
├── html-renderer-v2.ts       # 自适应节点 HTML 渲染（升级 html-renderer.ts）
├── render-round3.ts          # 主流程：baseline + R3a + R3b → HTML → Playwright 截图
├── round3-gallery.ts         # 三栏 gallery + 指标 + 评分模板
└── ...（Round 1/2 文件保留不动）
tools/layout-lab/outputs/
├── round3-html/              # 每条图 2 个 HTML
├── round3-screenshots/       # 每条图 2 张 PNG
├── round3-gallery.html       # 两栏并排对比
├── round3-metrics.json       # 全部指标数据
└── round3-human-review-template.json
```

## 6. 明确不做

- ❌ 不做 D0/D1 对比（Round 2 已证明 D2 最好）
- ❌ 不做 Candidate C（opposition 强化）
- ❌ 不碰产品代码（不改 graph-utils / React Flow / panel-reducer）
- ❌ 不做点击展开交互
- ❌ 不做 layoutIntent / layoutMemory 大架构

## 7. 旁路记录

- 📝 speaker 缺失：structurer 数据质量问题，不在此轮处理
- 📝 `pickDefaultView` 偏向 hierarchy：supports 密集图天然给 hierarchy 高分，这是产品行为，不在此轮改
- 📝 自适应节点大小的真实效果要在产品 React Flow 里才能完全验证（离线 HTML 的字体渲染有差异）
