# 第二轮：Cluster-First Layout 验证设计文档

> **状态**：方向已批准（含用户审核修正），待 spec 审阅后转入 writing-plans。
> **日期**：2026-07-09
> **前置**：第一轮诊断集（`docs/superpowers/specs/2026-07-03-layout-lab-round1-design.md`）已完成，结论为"第二轮攻多话题 cluster 组织"。

## 0. 背景与第一轮结论

第一轮对 62 条真实会话图的诊断（DeepSeek V4 Flash 草标 + 结构指标）得出：

| 维度 | 结果 |
|---|---|
| 最大失败类型 | 多话题堆积 46 条（74%） |
| 真实争论 | 仅 4 条（6%） |
| detector 误导率 | 90%（56/62） |
| detector 说 opposition 的 32 条里真是争论的 | 3 条（9%） |
| 大图（10+节点） | 44 条（71%） |
| 多连通分量（2+） | 50 条（81%） |

**修正记录**：`opposesCrossSpeakerRatio` 在当前数据下失效——202 条 opposes 边中 200 条（99%）至少一端缺 speaker 字段。这是 structurer 数据质量问题，记为旁路，不影响布局决策。

**第二轮目标**：验证"连通分量分区 + minor 打包"是否比当前 baseline 更可读。

## 1. 目标与边界

### 1.1 目标

**验证 cluster-first layout 是否比 baseline 更可读。** 这是 go/no-go 决策实验，不是产品化。

### 1.2 定位

- 复用第一轮实验台 `tools/layout-lab/`
- 新增"候选布局渲染器"层：离线纯函数算坐标 + 离线 HTML renderer + Playwright 截图
- **不碰 live 链路、不改产品代码**（第一轮的 `loadGraph` 在本轮不需要——离线 renderer 不走 sidepanel）

### 1.3 三个候选

| 候选 | 描述 |
|---|---|
| **Baseline** | 当前布局坐标算法（从 `graph-utils.ts` 提取为纯函数），用离线 renderer 复刻 |
| **Candidate A** | 连通分量分区 + major cluster 独立布局 + minor loose-notes 打包 |
| **Candidate B** | A + overview/focus（小簇缩略为 summary 块，不做交互） |

**关键约束**：三个候选用**同一套离线 HTML renderer**，保证视觉差异只来自坐标算法。

### 1.4 明确不做

- ❌ Candidate C（opposition 强化）——真实争论 4 条，不值得
- ❌ Louvain/社区发现——控制实验变量
- ❌ 点击展开交互——截图评不了
- ❌ 改产品 ViewType / 改 sidepanel——不碰 live
- ❌ speaker 缺失问题——旁路，不抢焦点

## 2. 渲染路径（离线 HTML + Playwright）

### 2.1 为什么离线而非真实 sidepanel

第一轮走真实 sidepanel + Playwright 截图（`loadGraph` 注入）。第二轮不走这条路，原因：

1. 候选布局要用自己的坐标，但 `loadGraph` 走 `FIXTURE_SEQUENCE_ARM` → React 自己算坐标。塞自定义坐标要改 DEV-only `loadGraph(graph, layoutOverride)` + panel-reducer，比验证本身重。
2. A/B 对比的关键是**布局算法差异**，不是"像不像产品"。只要三个候选用同一套 renderer，差异就纯粹来自算法。
3. `buildStableReactFlowDebugGraph` 的核心是纯坐标计算（已验证零 DOM/React 依赖），可干净提取。

### 2.2 离线 renderer 架构

```
MergedGraph
  → 坐标算法（baseline / A / B，都是纯函数）
  → positions: Record<string, {x, y}>
  → HTML renderer（坐标 → div+css 节点卡片 + svg 边）
  → 静态 HTML 文件
  → Playwright page.goto + screenshot
  → PNG
```

**HTML renderer 规格**：
- 节点：`div` 圆角矩形，宽 220px 高 132px（与产品 `STABLE_LAYOUT_CARD_WIDTH/HEIGHT` 一致）
- 节点样式：类型色边框（claim 蓝 / reason 绿 / example 紫 / question 橙 / conclusion 灰）+ 文本裁剪（超长截断 + tooltip）
- 边：`svg` line/path，按 edge type 着色（supports 绿 / opposes 红 / causes 橙 / 其他灰）
- cluster 边界（A/B 候选）：cluster bounds 半透明背景 + 标题
- 不用 React、不用 jsdom、不用真实扩展

### 2.3 Baseline 复刻

从 `apps/extension/src/sidepanel/graph-utils.ts` 提取以下纯函数到 `tools/layout-lab/src/baseline-layout.ts`：
- 布局常量（`STABLE_LAYOUT_*`）
- `getLaneX` / `getNodeLaneX` / `isBranchNodeType` / `isSemanticBranchNode`
- `getNodeRect` / `hasCollision` / `findAvailablePosition` / `getMaxYForLane`
- `pickAnchorNodeId`
- `buildStableReactFlowDebugGraph` 的坐标计算部分（去掉 React Flow node/edge 拼装，只保留 positions 产出）

同时复用 `@listen-graphic/graph-renderers` 的 `toHierarchyRendererGraph`（已是公开纯函数）做 renderer graph 转换。

**复刻保真度**：离线 baseline 和真实 sidepanel 不会 100% 像素一致（字体渲染、CSS 变量、React Flow viewport 缩放有差异），但**坐标算法一致**，布局结构一致。A/B 对比看的是结构差异，不是像素差异。

## 3. 分区算法

### 3.1 连通分量（UnionFind 无向）

- 所有合法边参与（`source` 和 `target` 都在节点表里的边）
- **self-loop 边不参与分量**（source === target 的边跳过）
- **dangling edge 不参与分量**（source 或 target 不在节点表里的边跳过）
- self-loop 节点保留为单节点 minor
- dangling edge 进入异常统计（记录但不影响布局）

### 3.2 major / minor 分类

- **major cluster**：`nodeCount >= 3` **或** `edgeCount >= 2` **或** `maxDegree >= 2`
- **minor cluster**：不满足 major 条件的小碎片（1-2 节点、边很少）
- **保护规则**：如果全图没有 major，把最大的 minor 升级为 major（避免小图全被扔进 Loose Notes）

### 3.3 major cluster 内部布局

- 每个 major cluster 内部继续用 baseline 的坐标算法（anchor 排位 + pattern hints）
- 旧 pattern（claim-reason-example、opposition 等）只在簇内生效，不决定全图
- cluster 之间用固定间隔（x 轴 400px + y 轴 200px）

### 3.4 minor cluster → Loose Notes 区

- 不一个个散开画。按时间排序，打包成一条或多列小节点列表
- **这是视觉打包，不是语义合并**——不声称它们是同一话题
- 渲染为紧凑列表项（节点类型色点 + 截断文本），不用完整卡片尺寸

### 3.5 cluster 排序

- 优先按节点数降序，其次按边数降序，最后按最早 timestamp
- 大簇先给阅读入口，小碎片靠后

### 3.6 Candidate B 的 overview/focus

- 展开前 4 个 major clusters
- minor cluster 全部汇总成 Loose Notes
- 如果 major 超过 6 个，第 7 个以后缩略为 cluster summary（标题 + 节点数 + 边数，不画具体节点）
- **缩略块不代表语义合并**，只代表"未展开分区"
- 不做点击展开交互（截图评不了）

## 4. 代表样本（20-24 条）

### 4.1 大图多分量（主战场，12 条）

| # | 节点 | 边 | 分量 | 最大簇占比 | opposes | 选因 |
|---|---|---|---|---|---|---|
| 49 | 271 | 255 | 30 | 15% | 13 | 最大图 |
| 41 | 258 | 242 | 21 | 30% | 18 | 第二大 |
| 48 | 237 | 223 | 17 | 31% | 20 | 大图多 opposes |
| 34 | 187 | 179 | 21 | 13% | 18 | 最大簇极小 |
| 47 | 180 | 171 | 13 | 24% | 9 | |
| 40 | 161 | 154 | 22 | 17% | 12 | 多分量 |
| 29 | 140 | 131 | 15 | 24% | 14 | |
| 28 | 137 | 127 | 16 | 22% | 9 | |
| 39 | 118 | 115 | 10 | 28% | 3 | 少 opposes |
| 61 | 116 | 84 | 35 | 13% | 6 | 极多分量 |
| 31 | 112 | 111 | 7 | 39% | 7 | 大簇占比高 |
| 46 | 105 | 99 | 10 | 27% | 3 | |

### 4.2 中等多分量（4 条）

| # | 节点 | 边 | 分量 | 选因 |
|---|---|---|---|---|
| 37 | 103 | 94 | 11 | 中等多分量 |
| 32 | 91 | 86 | 13 | |
| 57 | ~20-30 | | 多分量 | 中等规模多分量 |
| 58 | ~20-30 | | 多分量 | |

### 4.3 小图 / 单分量（防伤害对照，5 条）

| # | 节点 | 边 | 分量 | 选因 |
|---|---|---|---|---|
| 18 | ~5-8 | | 1 | 单分量解释图 |
| 21 | ~5-8 | | 1 | 单分量 |
| 16 | 2 | 2 | 2 | 真争论小图 |
| 12 | 2 | 1 | 1 | 解释小图 |
| 6 | 12 | 0 | 12 | 纯碎片图（Loose Notes 极限） |

### 4.4 长标签压力（已覆盖）

#61、#39、#40、#34 已在大图样本里。补 #33 或 #51。

**总数约 22-24 条。** 每条截 3 张（baseline/A/B）→ 约 66-72 张截图。

## 5. 评估

### 5.1 LLM 草评（辅助，非终判）

用 opencode-serve + DeepSeek V4 Flash（复用第一轮管线），纯文本。**只回答三个问题**：

1. cluster 分区是否符合 graph 结构？（是否过度拆分/合并不当）
2. 哪些图不适合 cluster-first？（如真实争论、纯因果链）
3. baseline vs candidate 的语义组织哪个更清晰？

**不让 LLM 评"压迫感更低""更好看"**——它看不到截图，评不了视觉。

### 5.2 人眼终判

打开 `outputs/round2-gallery.html`，三栏并排（baseline | A | B），含指标 + cluster 统计。

**主要看**：
- 大图是否不再"一片乱"？
- 主话题是否能一眼定位？
- 小图是否没被伤害？

**最终 go/no-go 由人决定。**

### 5.3 Go/No-Go 门槛（可操作）

| 门槛 | 标准 |
|---|---|
| 大图收益 | 大图样本（10+ 节点多分量）里，A 或 B 至少有一个在 **70% 以上**被人眼判为优于 baseline |
| 小图防伤害 | 小图/单分量样本里，A/B 不得有 **超过 20%** 被判为明显更差 |
| B 的额外价值 | B 必须比 A 在超大图（100+ 节点）上有额外收益，否则第三轮只推进 A，不推进 overview/focus |
| 弱收益处理 | 如果 A 只让画面更整齐，但找主话题没有更快，算弱收益，不直接产品化 |

## 6. 文件结构

```
tools/layout-lab/src/
├── baseline-layout.ts      # 从 graph-utils.ts 提取的 baseline 坐标算法（纯函数）
├── cluster-layout.ts       # Candidate A：连通分量分区 + minor 打包
├── cluster-overview.ts     # Candidate B：A + overview/focus 缩略
├── html-renderer.ts        # 坐标 → HTML（三候选共用）
├── render-round2.ts        # 主流程：读 dump → 算三候选坐标 → 生成 HTML → Playwright 截图
├── round2-evaluate.ts      # LLM 草评 + 生成 round2-gallery.html
└── ...（第一轮文件保留不动）
tools/layout-lab/outputs/
├── round2-html/            # 每条图 3 个 HTML 文件（baseline/A/B）
├── round2-screenshots/     # 每条图 3 张 PNG
├── round2-gallery.html     # 三栏并排对比
└── round2-llm-eval.json    # LLM 草评结果
```

## 7. 不做的事 / 旁路记录

- ❌ Candidate C（opposition 强化）
- ❌ Louvain/社区发现
- ❌ 点击展开交互
- ❌ 改产品代码 / 改 ViewType
- 📝 **旁路**：speaker 字段大面积缺失（202 条 opposes 边中 200 条缺 speaker）是 structurer 数据质量问题，第二轮不管，但不应该被遗忘

## 附录 A：用户审核修正对照

| # | 原设计 | 修正后 | 依据 |
|---|---|---|---|
| 1 | 渲染路径留悬念（"实现时再定"） | 明确离线 HTML + Playwright，不走 sidepanel | 第 3 节内在矛盾：纯函数 vs 复用 graph-utils |
| 2 | major/minor 无保护 | 全图无 major 时最大 minor 升级为 major | 避免小图全进 Loose Notes |
| 3 | dangling edge 未处理 | 不参与分量，进异常统计 | 统计口径 |
| 4 | self-loop 未处理 | 节点保留为单节点 minor，边不参与分量 | 统计口径 |
| 5 | Candidate B 规则模糊 | 明确：top 4 展开 + minor 全汇总 + major>6 缩略 | 可实现 |
| 6 | 样本偏大 | 补小图 #18/#21、纯碎片 #6、中等 #57/#58 | 防伤害 + 边界覆盖 |
| 7 | go/no-go "明显更可读"太主观 | 改为 70%/20%/B 额外价值/弱收益处理 四条可操作门槛 | 可判定 |
| 8 | LLM 评"压迫感更低" | 收窄为只评分区合理性 + 不适合图 + 语义组织 | LLM 看不到截图 |
