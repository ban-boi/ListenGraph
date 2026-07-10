# Round 3：Constrained Force Layout + Cluster + 自适应节点设计文档

> **状态**：方向已确认，待 spec 审阅后转入 writing-plans。
> **日期**：2026-07-10
> **前置**：
> - Round 1 诊断集结论：多话题 74%，真实争论 6%，detector 误导 90%
> - Round 2 验证结论：cluster-first 分区方向对，但簇内复用 hierarchy 固定 lane 布局不行；力导向（Strategy D）"好太多了"
> - 簇内对比实验结论：D2（力导向 + 软宽度惩罚）是甜点——窄到 sidepanel 友好（宽高比 0.23），关系可读性好（长边 0%，穿越 23 vs baseline 39）

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

**尺寸范围**（基于真实数据 P50=21字、P90=42字）：
- 21 字节点：宽 ~200px（MAX_WIDTH），高 ~82px（3 行）
- 42 字节点：宽 200px，高 ~100px（4 行）
- 10 字节点：宽 ~140px，高 ~64px（2 行）

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

## 2. 候选定义

| 候选 | 簇内布局 | 节点大小 | 外层 |
|---|---|---|---|
| **Baseline** | 当前产品布局（viewHints.defaultView） | 固定 220×132 | 无分簇 |
| **Candidate R3** | D2 力导向（面积斥力 + 碰撞消除） | 自适应（80-200px 宽） | cluster-first packing |

只做 1 个候选（R3），不做多候选对比。因为 Round 2 已经证明 D2 是最好的力导向变体，现在验证的是"D2 + 自适应 + 全图组合"的整体效果，不是 D2 变体之间的对比。

## 3. 代表样本

复用 Round 2 的 23 条样本（覆盖大图/中图/小图/碎片图/长标签）：
- 大图多分量：#49(271), #41(258), #48(237), #34(187), #47(180), #40(161), #29(140), #28(137), #39(118), #61(116), #31(112), #46(105)
- 中等：#37(103), #32(91), #58(31), #57(13)
- 小图/防伤害：#18(8), #21(5), #16(2), #12(2), #6(12 孤立)
- 长标签：#33(64), #51(66)

每条图截 2 张（baseline + R3）→ 46 张截图。

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

打开 `outputs/round3-gallery.html`，两栏并排（baseline | R3），含指标。

**主要看**：
1. 大图是否不再"一片乱"？关系一眼能看懂？
2. 节点是否不重叠了？自适应大小是否合理？
3. 画布是否竖向收窄了？sidepanel 友好？
4. 小图是否没被伤害？

### 4.4 Go/No-Go 门槛

| 门槛 | 标准 |
|---|---|
| 大图收益 | 大图样本里 R3 在 70%+ 被人眼判为优于 baseline |
| 小图防伤害 | 小图样本里 R3 不超 20% 被判为明显更差 |
| 节点重叠 | R3 的节点重叠对数 < 节点数 × 0.3 |
| 宽高比 | R3 大图的画布宽高比中位数 < 0.5 |

## 5. 文件结构

```
tools/layout-lab/src/
├── round3-types.ts           # 自适应节点尺寸类型 + NodeSize 计算
├── force-layout-v2.ts        # D2 升级：面积斥力 + 碰撞消除 + 自适应节点
├── cluster-force-layout.ts   # cluster 外层 + D2 簇内 = 完整 R3 候选
├── html-renderer-v2.ts       # 自适应节点 HTML 渲染（升级 html-renderer.ts）
├── render-round3.ts          # 主流程：baseline + R3 坐标 → HTML → Playwright 截图
├── round3-gallery.ts         # 两栏 gallery + 指标 + 评分模板
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
