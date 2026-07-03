# 第 1 轮布局实验台（诊断集）设计文档

> **状态**：方向已批准（带 5 项修改），待 spec 审阅后转入 writing-plans。
> **日期**：2026-07-03
> **背景交接**：见 `~/.zcode/tmp/paste-attachments/2026-07-03/pasted-text-20260703-105056-ffd9bc3a.txt`（语义图硬信息交接）。

## 0. 背景与动机

ListenGraph 的语义图布局当前走"五选一 pattern detection"（`packages/graph-renderers/src/hierarchy.ts:177-185`，固定优先级链式调用 5 个 detector）。基于 62 条真实会话最终态图的统计（脚本 `.tmp/stat-real-patterns.mts`，复用生产 `detectHierarchyLayoutPattern`）显示：

| 模式 | 命中 | 占比 |
|---|---|---|
| opposition | 32 | 51.6% |
| 未匹配 | 19 | 30.6% |
| claim-reason-example | 11 | 17.7% |
| question-branches / causal-chain / timeline-note | 0 | 0% |

**核心问题**：`detectOpposition`（`hierarchy.ts:96-112`）的门槛是**任意一条 opposes 边即命中**。51.6% 很可能是 detector 偏差而非真实语义分布。如果直接据此决定"第二轮攻 opposition 布局"，会把检测错误放大成路线错误。

**因此第一轮不是做候选布局，而是做诊断**：在不信任现有 detector 的前提下，弄清 62 条真实图的主要可读性失败类型，据此校准第二轮方向。

## 1. 目标与边界

### 1.1 目标

回答一个问题：**"在不信任现有 pattern detector 的前提下，62 条真实图的主要可读性失败类型是什么？"**

产物是一张**路线校准表**（不是最终验收集、不是布局算法），驱动第二轮 go/no-go 决策。

### 1.2 产物定位（硬边界）

> **第一轮产物不是"LLM 判定真相"，而是"LLM 草标 + 人眼校准后的路线诊断表"。**
> 这是为了避免又把一个弱 judge（无论 detector 还是 LLM）变成新的路线锚点。

每条图四件套中间产物：
1. **简化 graph JSON**（节点 id/type/text/speaker + 边 source/target/type）
2. **结构指标**（全新独立计算，不依赖现有 detector 的判断逻辑）—— 见第 3 节
3. **fixture-lab build 下最接近真实 sidepanel 的可复现截图** —— 见第 4 节
4. **LLM 草标**（semantic_reading / layout_failure / detector_mismatch / visual_treatment / confidence）+ 人工抽样校正 —— 见第 5、6 节

### 1.3 明确不做（对冲过度工程化）

- ❌ 不做候选布局 A/B 对比（推迟到第二轮）
- ❌ 不写新布局引擎、不动 `buildStableReactFlowDebugGraph`
- ❌ 不碰 live 链路、不上 layoutMemory / layoutIntent
- ❌ 不在本轮决定第二轮做什么（等表出来再定）

### 1.4 硬约束

- 整条管线位于 `tools/layout-lab/`，与 `apps/`、`packages/` 平级，**不进 monorepo 构建图**。
- 实验台代码**不 import 任何 sidepanel 产品模块的产品逻辑**。允许的两类复用：
  - 纯函数 `detectHierarchyLayoutPattern`（仅用于指标对照列"detector 说了什么"，不做判断）
  - `MergedGraph` schema 类型（用于灌图时的类型契约）
- 唯一允许碰的产品代码是 `loadGraph`（DEV-only，见第 4 节）。
- `inputs/` 与 `outputs/` **必须 gitignore**（含真实用户对话数据）。

---

## 2. 管线架构与文件结构

### 2.1 目录结构

```
tools/layout-lab/
├── README.md                      # 复现步骤
├── .gitignore                     # 忽略 inputs/real-graphs-dump.json 和 outputs/
├── inputs/
│   └── real-graphs-dump.json      # 从 ~/Downloads/real-graphs-dump.json 复制（gitignore）
├── src/
│   ├── metrics.ts                 # 纯函数：MergedGraph -> StructureMetrics（不依赖 detector）
│   ├── metrics.test.ts            # Vitest 单测
│   ├── simplify.ts                # MergedGraph -> SimplifiedGraphJSON
│   ├── detector-check.ts          # 调 detectHierarchyLayoutPattern 做"detector 说了什么"对照（只读）
│   ├── export-snapshot.ts         # 阶段 1 主流程：dump -> metrics + simplify + detector-check
│   ├── capture-screenshots.ts     # 阶段 2：Playwright 灌图 -> 截图（新建 waitForFixtureGraph）
│   ├── e2e-helpers.ts             # lab 专用 Playwright helpers（复用 helpers.ts 的 launch/open，新建等待）
│   ├── llm-annotate.ts            # 阶段 3：调 LLM 草标
│   ├── render-gallery.ts          # 阶段 4：拼静态 HTML gallery + 生成 review-sample.json
│   └── types.ts                   # StructureMetrics / SimplifiedGraphJSON / Annotation 等类型
├── run/
│   ├── run-all.mjs                # 串起 export -> capture -> annotate -> gallery
│   └── package.json               # 独立 deps（tsx, playwright, vitest），不污染根 package.json
└── outputs/                       # gitignore
    ├── metrics/*.json
    ├── screenshots/*.png
    ├── annotations/*.json
    ├── gallery.html
    ├── review-sample.json
    ├── calibrated-diagnosis.json  # 人工校正后产物
    └── diagnosis-table.md         # 最终路线校准表
```

### 2.2 四阶段串行

`run/run-all.mjs` 编排，**每阶段独立可跑、独立可重试**：

| 阶段 | 输入 | 输出 | 失败处理 |
|---|---|---|---|
| 1. export | `inputs/real-graphs-dump.json` | `outputs/metrics/*.json` + `outputs/simplified/*.json` | 纯函数，秒级重跑 |
| 2. capture | dump + 阶段1 | `outputs/screenshots/*.png` | 单条图重截（Playwright 单测模式） |
| 3. annotate | 阶段1+2 | `outputs/annotations/*.json` | 单条重调，不重跑整批（省钱） |
| 4. gallery | 阶段1+2+3 | `outputs/gallery.html` + `outputs/review-sample.json` | 纯拼装，无损重跑 |

**拆分理由**：export 纯函数极易单测；capture 是最脆一环（浏览器/扩展环境）单独隔离；annotate 花钱且依赖外部 API 单独跑；gallery 只是拼装。任何一阶段失败不影响其他阶段已产物。

---

## 3. 结构指标清单（`metrics.ts`）

### 3.1 设计原则

指标**只描述"图长什么样"，不下"这是争论/解释/因果"的结论**。结论留给 LLM + 人。这样诊断不被任何先验分类（detector 或人为）污染。

### 3.2 类型定义

```typescript
// tools/layout-lab/src/types.ts

import type { MergedGraph, NodeType, GraphEdge } from '@listen-graphic/schema';

// NodeType 来自 schema：'question' | 'claim' | 'conclusion' | 'reason' | 'example'
// EdgeType：'supports' | 'opposes' | 'causes' | 'example_of' | 'follows'

export type StructureMetrics = {
  // —— 规模 ——
  nodeCount: number;
  edgeCount: number;
  isLargeGraph: boolean;              // nodeCount >= 10

  // —— 类型分布 ——
  nodeTypeCounts: Partial<Record<NodeType, number>>;
  edgeTypeCounts: Partial<Record<GraphEdge['type'], number>>;

  // —— 对立信号（不靠 detector 判定，只数原始边）——
  opposesCount: number;
  opposesRatio: number;               // opposesCount / edgeCount

  // —— 连通性 ——
  connectedComponents: number;        // 无向图连通分量数（忽略边方向）
  largestComponentRatio: number;      // 最大连通子图节点数 / nodeCount

  // —— 度分布 ——
  maxOutDegree: number;
  maxOutDegreeNodeId: string | null;
  maxInDegree: number;
  maxInDegreeNodeId: string | null;
  avgDegree: number;                  // 2 * edgeCount / nodeCount

  // —— 时间/序列 ——
  spanMs: number;                     // 最早最晚节点 timestampMs 之差
  // 不做"是不是时间线"的判定，只给原始 span

  // —— 说话人（判断"是否真争论"的关键信号）——
  speakerCounts: Record<string, number>;          // 每个 speaker 的节点数
  crossSpeakerEdgeRatio: number;      // 跨 speaker 边数 / edgeCount
  opposesCrossSpeakerRatio: number;   // 跨 speaker 的 opposes 边数 / opposesCount（opposesCount=0 时为 null）

  // —— 空间可读性信号（判断"布局会不会挤/标签会不会重叠"）——
  longLabelNodeCount: number;         // text 长度 > LONG_LABEL_THRESHOLD（默认 40 字符）的节点数
};

export const LONG_LABEL_THRESHOLD = 40;
```

### 3.3 新增 4 个指标的理由（用户审核要求补的）

- `speakerCounts` / `crossSpeakerEdgeRatio`：opposition detector 把"任意一条 opposes"都算对立，但**真正的争论应该是跨 speaker 的 opposes**。这两个指标让 LLM/人能识别"detector 说 opposition 但其实是同一个人自我修正"。
- `opposesCrossSpeakerRatio`：直接量化"这条对立是不是两个不同观点阵营的对立"。比单纯数 opposes 边强得多。
- `longLabelNodeCount`：长标签节点是空间布局失败的高频来源（重叠/溢出），给 LLM 一个客观信号判断"挤不挤"。

### 3.4 第一轮 YAGNI（明确不加）

- ❌ 平均路径长度、聚类系数（结构信号弱，第二轮需要再加）
- ❌ speaker 切换次数（crossSpeakerEdgeRatio 已覆盖核心信号）
- ❌ 任何基于 detector 的派生指标

### 3.5 detector-check（对照，非判断）

```typescript
// tools/layout-lab/src/detector-check.ts
import { detectHierarchyLayoutPattern } from '@listen-graphic/graph-renderers';
import type { MergedGraph } from '@listen-graphic/schema';

// 只用于"detector 说了什么"对照列，绝不参与 metrics 判断
export function whatDetectorSays(graph: MergedGraph): {
  pattern: string;
  rootNodeId?: string;
} {
  const result = detectHierarchyLayoutPattern(graph);
  return {
    pattern: result?.pattern ?? '(未匹配)',
    rootNodeId: result?.rootNodeId,
  };
}
```

---

## 4. 截图管线（Playwright 灌图）—— 含 3 项关键修改

### 4.1 灌图方案：新增 DEV-only `loadGraph`

**位置**：`apps/extension/src/sidepanel/fixture-sequence-dev.ts`（仅 DEV 构建）。

**修改类型**：`ListenGraphicFixtureAPI` 增加 `loadGraph` 方法。

### 4.2 ⚠️ 修改 1：`loadGraph` 必须静态装载，不复用 `deliverStep`

**问题**：现有 `deliverStep`（`fixture-sequence-controller.ts:60-86`）会：
- 调 `setAutoTourSeed`（第 78 行）→ 触发导览高亮/动画，污染截图
- 把所有节点当"新增"处理

**正确路径**：走 `FIXTURE_SEQUENCE_ARM` action（`fixture-sequence-controller.ts:162-168`）。该 action 只 dispatch + 设 `graphRef`，**不调 `setAutoTourSeed`**，是静态装载。

**`loadGraph` 实现要点**：

```typescript
// fixture-sequence-dev.ts 新增（仅 DEV 构建，受现有 import.meta.env.DEV 守卫保护）
// ListenGraphicFixtureAPI 类型新增方法：
//   loadGraph: (graph: MergedGraph) => void;

// fixture-sequence-controller.ts 内 api 对象新增：
loadGraph: (graph: MergedGraph) => {
  const deps = getDeps();
  // 1. reset（清掉任何已 armed 的键盘监听/状态）
  if (state.armed) {
    removeKeyboardListener();
    state.armed = false;
    state.fixtureId = null;
    state.sequence = null;
  }
  // 2. 触发 sidepanel 的 fixture reset（清 layout cache / session）
  deps.onFixtureLabReset(graph.sessionId);
  // 3. 静态装载：走 FIXTURE_SEQUENCE_ARM，不触发 auto-tour seed
  deps.dispatch({
    type: 'FIXTURE_SEQUENCE_ARM',
    payload: { sessionId: graph.sessionId, initialGraph: graph },
  });
  // 4. 更新 graphRef，让 status() 能读到
  deps.graphRef.current = graph;
  deps.addLog(`[fixture-lab] loaded graph rev=${graph.revision} nodes=${graph.nodes.length}`);
},
```

> **注意**：此方法**不**设置 `state.armed = true`，因此不注册键盘监听（`]`/`[`/`Esc`），避免误操作。它是纯装载。

### 4.3 ⚠️ 修改 2：新建 `waitForFixtureGraph`，不复用 `waitForGraph`

**问题**：现有 `waitForGraph`（`apps/extension/e2e/helpers.ts:246`）→ `getRuntimeSnapshot`（`helpers.ts:190`）→ 发 `GET_RUNTIME_SNAPSHOT` 消息到 **service worker**。DEV fixture `loadGraph` 直接 dispatch 到 **sidepanel React state**，service worker 完全不知情。`waitForGraph` 永远等不到 fixture 灌的图。

**正确做法**：新建 `waitForFixtureGraph`，轮询 `__listenGraphicFixture.status().nodeCount`（`fixture-sequence-controller.ts:221-234` 的 `status()` 已返回 `nodeCount`/`edgeCount`）。

```typescript
// tools/layout-lab/src/e2e-helpers.ts
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function waitForFixtureGraph(
  page: Page,
  expectedNodeCount: number,
  timeout = 10_000,
) {
  await expect
    .poll(
      async () => {
        return await page.evaluate(() => {
          return globalThis.__listenGraphicFixture?.status()?.nodeCount ?? 0;
        });
      },
      { timeout },
    )
    .toBeGreaterThanOrEqual(expectedNodeCount);
}
```

**为什么用 `status()` 而不是数 DOM**：`status()`（`fixture-sequence-controller.ts:221-234`）读 `graphRef.current`，与 React state 同源；数 DOM 节点（`graph-node-card-*`）耦合渲染细节且可能受动画/虚拟化影响。`status()` 更可靠。

### 4.4 ⚠️ 修改 3：截图口径改为"fixture-lab build 下最接近真实 sidepanel"

**不写"视觉 100% 一致"**，原因（用户指出）：
- `__listenGraphicFixture` 不在生产 bundle，需要 `VITE_FIXTURE_LAB=true` 或 DEV build
- headless viewport 与真实 sidepanel 有差异

**准确口径**：**"fixture-lab build 下最接近真实 sidepanel 的可复现截图"**。

### 4.5 截图流程（`capture-screenshots.ts`）

```typescript
// 伪代码
import { launchExtensionContext, openSidepanelPage } from './e2e-helpers';

async function captureAll(dumpPath: string, outDir: string) {
  const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8')) as MergedGraph[];
  const { context, extensionId } = await launchExtensionContext('.tmp/lab-user-data');
  const page = await openSidepanelPage(context, extensionId);

  for (let i = 0; i < dump.length; i++) {
    const graph = dump[i];
    // 1. 灌图（静态装载）
    await page.evaluate((g) => {
      globalThis.__listenGraphicFixture?.loadGraph(g);
    }, graph);

    // 2. 等 React 渲染完成（读 status，不查 service worker）
    await waitForFixtureGraph(page, graph.nodes.length);

    // 3. 等 fitView 稳定（固定等待，避免捕获中动画）
    await page.waitForTimeout(600);

    // 4. 固定视图状态：确保 hierarchy 视图、关闭设置面板、关闭 auto-tour
    await stabilizeForScreenshot(page);

    // 5. 截图
    await page.screenshot({
      path: path.join(outDir, `${pad(i)}.png`),
      fullPage: true,
    });
  }

  await context.close();
}
```

### 4.6 `stabilizeForScreenshot` 要点

截图前确保可比性：
- 视图切到 `hierarchy`（若不在）
- 关闭设置面板
- 显式关闭 auto-tour（防止任何残留导览高亮）
- 等 React Flow `fitView` 完成（可监听 `onLoad`/`onMove` end，或固定 timeout）

### 4.7 构建要求

截图脚本要求扩展以 fixture-lab build 启动。README 写明：
```bash
# 构建 fixture-lab 版扩展 dist
VITE_FIXTURE_LAB=true pnpm --filter extension build
# 然后跑截图
npx tsx tools/layout-lab/run/run-all.mjs --stage=capture
```

---

## 5. LLM 草标协议

### 5.1 输入三件套（per graph）

1. 简化 graph JSON（`simplify.ts` 产物）
2. `StructureMetrics`（`metrics.ts` 产物）
3. 截图（`outputs/screenshots/*.png`，base64 编码进多模态请求）

### 5.2 草标 schema

```typescript
// tools/layout-lab/src/types.ts
export type Annotation = {
  graphIndex: number;
  semanticReading: string;       // 语义上像什么：争论/解释/因果/多话题/...
  layoutFailures: string[];      // 当前空间布局的阅读问题（数组，可多个）
  detectorMismatch: boolean;     // detector 命中是否误导
  detectorHitNote?: string;      // 误导说明（detectorMismatch=true 时必填）
  visualTreatment: string;       // 需要什么视觉处理
  confidence: 'high' | 'medium' | 'low';
};
```

### 5.3 prompt 设计：分开判断

LLM 必须**分开判断**，不混为一谈：

- **semanticReading**：主要基于 graph JSON + 指标（语义判断），截图仅作辅助参考
- **layoutFailures**：重点看截图（空间判断），结合 `longLabelNodeCount`/`isLargeGraph` 等空间信号
- **detectorMismatch**：对照 whatDetectorSays 的 pattern 与自己的 semanticReading

### 5.4 模型可配置（不绑死）

LLM 模型与 provider **不在 spec 绑定**，通过环境变量配置：
- `LAYOUT_LAB_LLM_PROVIDER`（如 `openai` / `anthropic` / `gemini`）
- `LAYOUT_LAB_LLM_MODEL`（如 `gpt-4o` / `claude-sonnet` / `gemini-2.5-flash`）
- `LAYOUT_LAB_LLM_API_KEY`

**降级**：若无多模态 API，降级为纯文本（只给 JSON + 指标，跳过截图输入）。草标质量下降，gallery 里该条标注"无视觉判断"。

### 5.5 成本控制

- 单条失败可独立重调，不重跑整批
- 预计 62 次多模态调用，成本 $1-3（取决于模型）
- prompt 缓存：相同 system prompt 复用

---

## 6. 人工审核与抽样策略

### 6.1 ⚠️ 修改 5：全量快速扫 + 重点校正（不要求手写 62 条）

**两层审核**：

**第 1 层：全量快速扫（必做）**
- 人在 `gallery.html` 里把 62 张缩略图**全部扫一遍**（每张 5-10 秒）
- 目的： catching LLM 系统性偏差（如 LLM 把某类图全标错）
- 不写详细校正，只标"看起来对/看起来不对"

**第 2 层：重点详细校正（15-25 条）**

`review-sample.json` 自动选出必看样本：
1. 所有 `confidence = low`（LLM 自己都没把握）
2. 所有 `isLargeGraph`（10+ 节点）
3. 所有 `detectorMismatch = true`（detector 与 LLM 冲突）
4. 每类 `semanticReading` 抽样 2-3 条（覆盖各类失败）
5. `opposesCrossSpeakerRatio` 极端值：>0.5（强跨人对对立）和 opposesCount>0 但 ratio=0（同 speaker 自我对立，detector 误检）

### 6.2 校正字段

人在 LLM 草标基础上覆盖：
- `layoutFailures`（可增删）
- `visualTreatment`（可改写）
- 新增 `humanNote`（自由文本）
- **不改** `semanticReading`（保留 LLM 原判做对照）

输出 `outputs/calibrated-diagnosis.json`。

### 6.3 防止"弱 judge 变新锚点"

> 重申第 1.2 节边界：**第一轮产物是"LLM 草标 + 人眼校准后的路线诊断表"，不是"LLM 判定真相"。**

LLM 草标只是起点，人的校准才是产物。即使 LLM 系统性误判某类图，全量快速扫（6.1 第 1 层）能在 5-10 分钟内发现，不会被带偏。

---

## 7. 输出：路线校准表

最终产物 `outputs/diagnosis-table.md`（+ JSON），驱动第二轮决策：

| 图 | detector 命中 | LLM 语义读法 | 人工校正的主要失败 | 需要的视觉处理 |
|---|---|---|---|---|
| g01 | opposition | 多观点解释 | 中心观点不突出 | 中心节点强调 |
| g02 | opposition | 双方争论 | 对立边不明显 | 对立双方拉开 |
| g03 | none | 多话题堆积 | 话题混在一起 | cluster 分组 |
| g04 | claim-reason-example | 观点解释 | 例子离 claim 太远 | evidence stack |

### 7.1 汇总统计驱动 go/no-go

- 若"真双方争论"实际只 ~12 条（而非 detector 的 32 条）→ opposition 收紧门槛，不优先攻
- 若"多话题堆积"是最大失败类 → 第二轮攻 cluster
- 若"主线不突出"最普遍 → 第二轮攻 central spine / emphasis
- 若"例子离太远"高频 → 第二轮攻 evidence stack

### 7.2 终止条件

表完成后，**人**（不是 LLM）根据失败类型频次决定第二轮方向。第一轮实验台到此结束。

> **第二轮是否做、做什么，等表出来再决定，不预先承诺。**

---

## 8. 失败处理与成本控制

### 8.1 各阶段独立失败重跑

| 阶段 | 失败时 | 重跑成本 |
|---|---|---|
| export | 修 metrics.ts，重跑 | 秒级 |
| capture | 单条图重截（`--only=<index>`） | 单条 ~3 秒 |
| annotate | 单条重调（`--only=<index>`） | 单次 API 调用 |
| gallery | 纯拼装，重跑 | 秒级 |

### 8.2 成本

- **LLM**：62 条 × 1 次多模态调用 ≈ $1-3
- **Playwright**：headless 本机跑，零外部成本
- **人时**：全量扫 5-10 分钟 + 详细校正 15-25 条 × 1-2 分钟 ≈ 30-50 分钟

### 8.3 数据安全

- `inputs/real-graphs-dump.json` 与整个 `outputs/` 目录 **必须 gitignore**（含真实用户对话）
- `.gitignore` 显式列：
  ```
  tools/layout-lab/inputs/
  tools/layout-lab/outputs/
  tools/layout-lab/.tmp/
  ```
- README 记录 dump 来源路径（`~/Downloads/real-graphs-dump.json`），不复制内容进 git

---

## 9. 待定/开放问题（实现时再决）

- **LLM 模型选择**：spec 不绑死，环境变量配置（5.4）。实现时由用户指定。
- **`stabilizeForScreenshot` 的具体实现**：是监听 React Flow `onMoveEnd` 还是固定 timeout，实现时根据实际渲染稳定性决定（4.6）。
- **`FIXTURE_SEQUENCE_ARM` handler 是否依赖 sequence 结构**：`loadGraph`（4.2）复用该 action 但传任意 `MergedGraph`，而非 `sequence.steps[0].graph`。实现时**必须先读 `panel-reducer` 的 `FIXTURE_SEQUENCE_ARM` handler**，确认它只消费 `payload.initialGraph` + `payload.sessionId`，不依赖 sequence 步骤。若 handler 有 sequence 耦合，需新增一个独立的 `LAYOUT_LAB_LOAD` action（同样静态、不触发 auto-tour），而非复用 ARM。这是 4.2 落地前的**前置验证**。
- **第二轮方向**：本轮不预设（7.2）。

---

## 附录 A：5 项修改对照（用户审核要求）

| # | 原设计 | 修改后 | 依据 |
|---|---|---|---|
| 1 | "复用 `waitForGraph`" | 新建 `waitForFixtureGraph`，轮询 `status().nodeCount` | `waitForGraph` 查 service worker，fixture 灌 sidepanel，源不同 |
| 2 | "`loadGraph` 复用 `deliverStep`" | 走 `FIXTURE_SEQUENCE_ARM` 静态装载，不触发 auto-tour | `deliverStep` 触发 auto-tour seed，污染截图 |
| 3 | "真实扩展截图 100% 一致" | "fixture-lab build 下最接近真实 sidepanel 的可复现截图" | fixture API 不在生产 bundle，需 lab build |
| 4 | metrics 12 个字段 | 加 `speakerCounts`/`crossSpeakerEdgeRatio`/`opposesCrossSpeakerRatio`/`longLabelNodeCount` | 判断"是否真争论"和"空间失败"的关键信号 |
| 5 | "详细校正 15-25 条" | 全量快速扫 + 重点详细校正 15-25 条 | 防 LLM 系统性偏差，又不让人手写 62 条 |

## 附录 B：关键代码位置索引

| 关注点 | 文件:行 |
|---|---|
| pattern detection（5 detector 链） | `packages/graph-renderers/src/hierarchy.ts:177-185` |
| opposition detector（一条边即命中） | `packages/graph-renderers/src/hierarchy.ts:96-112` |
| 布局主函数 | `apps/extension/src/sidepanel/graph-utils.ts:287` (`buildStableReactFlowDebugGraph`) |
| DEV fixture 安装点 | `apps/extension/src/sidepanel/fixture-sequence-dev.ts:33-42` |
| fixture controller（deliverStep / arm / status） | `apps/extension/src/sidepanel/fixture-sequence-controller.ts` |
| Playwright 扩展启动 | `apps/extension/e2e/helpers.ts:21-42` (`launchExtensionContext`) |
| 现有 waitForGraph（不可复用） | `apps/extension/e2e/helpers.ts:246-253` |
| 真实图 dump | `~/Downloads/real-graphs-dump.json`（62 条 MergedGraph） |
| 统计脚本（可复用 detector） | `.tmp/stat-real-patterns.mts` |
