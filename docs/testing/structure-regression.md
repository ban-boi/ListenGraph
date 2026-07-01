# Structure 回归说明

## 目的
本文记录当前 `Structure-focused` 回归体系，包括：
- 为什么这样测
- 当前有哪些入口
- fixture 如何组织
- 当前 active 覆盖范围
- 本轮已经落到生产代码里的关键优化

## 核心思路
当前高频结构化回归，默认不再走真实 HTML、音频播放或 ASR。

主路径已经收敛为：

`TranscriptChunk[] fixture -> service-worker -> real structurer -> merge -> debug/export`

这样做的原因：
- 更快
- 更稳定
- 不消耗 ASR 额度
- 更适合高频调 prompt、incremental merge、fallback、parser

## 两层定位（重要）

structure 断言按「是否依赖参考模型分布」分两层，**不能混用**：

### 第 1 层：确定性契约（模型无关，进 CI 硬门）
只校验「不依赖参考模型就能确定」的工程契约：`minSegments`、exported transcripts 不丢、`allowFallback`/`expectFallbackUsed`/`maxFallbackRuns`、JSON schema 合法。这些崩了 = 代码坏了（流程/schema/稳定性问题），必须立刻修、必须阻塞发布。

代码入口：`assertFixtureContract`。

### 第 3 层：质量断言（模型特异，默认 soft，不阻塞）
校验依赖参考模型分布的断言：节点/边数阈值（`minMergedNodes`/`minMergedEdges`/`maxMergedNodes`）、文本锚点（`mustContainTexts`/`mustContainOneOfTexts`）、`forbiddenTexts`、`mustHaveNodeTypes`/`requiredEdgeTypes`。这些断言编码了「参考模型的语义密度、表达风格、节点粒度」——换个小模型或端侧模型跑，红了**不一定是代码坏了**，更可能是「这个模型的结构化能力和参考模型不在同一分布」。

因此第 3 层默认 soft：`LISTEN_GRAPHIC_STRUCTURE_QUALITY_SOFT=1`（默认开），quality 断言失败只 warn 不阻塞 CI；深度排查时设 `=0` 恢复 hard。

代码入口：`assertFixtureQuality`。

> 为什么不分一个「第 2 层模型 profile benchmark」：见 [llm-judge-acceptance-calibration.md](./llm-judge-acceptance-calibration.md) 的讨论——维护多模型基线的成本不划算，当前只做 1+3 两层。

## 当前推荐入口

如果你是在判断“这个问题该补哪层测试”，先看：
- [Extension 测试入口](C:\Users\finni\Desktop\ListenGraph\docs\testing\README.md)

### 日常回归
```powershell
pnpm run test:ext:replay
```

它包含：
- `test:structure:mock`
- `test:structure:real:smoke`

### 全量真实验收
```powershell
pnpm --filter extension test:structure:real:full:part1
pnpm --filter extension test:structure:real:full:part2
```

### Realtime assembler KPI
```powershell
pnpm --filter extension test:structure:ws:kpi
```

它只离线读取 `replay-realtime-*` fixture，不调用真实 structurer API。用途是快速检查：
- assembler 的 commit / wait / skip 节奏
- `merge_with_prev` 是否误触发
- 首图延迟
- 每分钟 structurer 调用次数
- 每个 commit 聚合的 utterance 数
- 已有 diagnostic artifact 覆盖下的 `emptyOutputRatio`

### Realtime assembler strict replay
```powershell
pnpm --filter extension test:structure:real:replay:strict
```

它会对全部 `replay-realtime-*` fixture 调用真实 structurer，并写入 diagnostic artifacts。单条 fixture 调试可用：

```powershell
$env:LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE='merge-with-prev-boundary'
pnpm --filter extension test:structure:real:replay:strict
```

### 单条 fixture 调试
```powershell
$env:LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE='bootstrap-basic'
pnpm --filter extension test:structure:real
```

## 当前 strict real suite 规则
当前 `smoke/full/part1/part2` 默认都是严格模式：
- `429` 不算通过
- timeout 不算通过
- 只有真实返回并满足验收规则才算 pass

当前 runner 同时保留：
- fixture 间固定 delay
- timeout / rate-limit 后 cooldown
- 外部问题重试
- fetch trace / call summary / diagnostic artifact

## fixture 设计原则
fixture 不是标准答案全文，而是：
- 固定 transcript 输入
- 规则化验收

常用验收：
- `minSegments`
- `minMergedNodes`
- `maxMergedNodes`
- `minMergedEdges`
- `mustContainTexts`
- `mustContainOneOfTexts`
- `mustHaveNodeTypes`
- `requiredEdgeTypes`
- `forbiddenTexts`
- `expectCrossGraphEdges`
- `allowFallback`
- `maxFallbackRuns`

### 语义质量 fixture（第 3 层，模型特异）
`semantic-*` fixture 是结构化质量验收集，不是快照测试。它们用短 transcript 固定输入，用弹性断言固定最低语义门槛：

- 必须抓住的核心点：`mustContainTexts` / `mustContainOneOfTexts`
- 图规模边界：`minMergedNodes` / `maxMergedNodes`
- 关系和类型覆盖：`requiredEdgeTypes` / `mustHaveNodeTypes`
- 幻觉和噪声边界：`forbiddenTexts`
- fallback 边界：`allowFallback` / `maxFallbackRuns`

**重要定位变化**：这些语义/数值断言属于第 3 层（模型特异），**不该当跨模型硬门**。它们的 acceptance 编码了某个参考模型的输出分布；用更强的模型跑会过、用更弱的模型/端侧模型跑会大面积红——但这个红是「模型能力差异」，不是「代码回归」。所以默认走 soft 模式（`LISTEN_GRAPHIC_STRUCTURE_QUALITY_SOFT=1`），失败只 warn 不阻塞。

这些 fixture 用来回答「**在产生这套 acceptance 的参考模型下**，这版有没有抓住关键意思」，不要求 LLM 输出逐字一致，也**不要求任意用户模型都通过**。新增或调整 prompt、assembler、provider、merge 逻辑前后，应优先跑相关 `semantic-*` 样本（用与 acceptance 同源的模型），再看 replay KPI。

## fixture 来源
当前 active fixtures 来自两类来源：
- 人工设计的最小能力样本
- 真实 transcript 抽样沉淀

真实 transcript 目前主要来自：
- `鲁豫对话庞颖詹青云.txt`
- `raw_audio&text/` 下的三类风格样本

## 当前 active real fixtures 覆盖范围
当前已经覆盖：
- bootstrap 基础抽图
- 原因 / 支持 / 理由关系
- 身份取舍与退路
- 表达风格差异与互补
- 意义感 vs 现实路径
- 价值取舍与双重追求
- 公众表达与安全感
- 辩论 / 脱口秀式回应
- 增量补充挂回旧图
- 职业路径后悔与因果链
- 冲突 / 反驳
- 低新颖度输入
- realtime structure unit assembler
- 明显半句 + 补完句的 `merge_with_prev`
- setup-tail 反例
- 连续极短半句反例
- 低信息 utterance 插入中间
- 语义质量验收：问题分点、观点-理由-例子、反驳/自我修正、停顿噪声、两人争论、因果链、时间线、取舍与优先级

## 本轮已经落到生产代码里的优化

### service-worker
- 支持测试专用 transcript 注入
- graph/export 缺失时可从 persisted segments 重建并回写
- provider timeout 配置真正透传到运行时
- provider error / status / body 诊断更完整
- realtime WS 路径加入 structure unit assembler
- assembler debug/export/runtime snapshot 可观测
- `merge_with_prev` 会把 structure unit 的 evidence chunk ids 展开回 source chunks

### assembler replay
- 新增 `report-structure-unit-ws-kpis.mjs`
- 新增 `replay-realtime-*` KPI 统计
- 新增 `merge_with_prev` 正样本与 3 条边界反例 fixture

### structurer provider
- incremental prompt 更明确要求新理由挂回旧节点
- 对常见近似 JSON 和坏响应更稳
- 支持“前面 JSON、后面解释文本”的解析

## 当前阶段的结论
当前 active fixtures 已经在阿里云配置下跑通：
- `test:structure`
- `full-part1`
- `full-part2`
- `test:structure:real:replay:strict` 的 8 条 `replay-realtime-*` fixture

这说明：
- 这批样本稳定暴露出来的问题，阶段性已经被处理完
- assembler Phase 1/2 对现有 replay 样本无明显回归
- `merge_with_prev` 仅在专用半句 + 补完场景触发，边界反例未出现误合并

但不说明：
- 更广泛的真实 transcript 分布下不会再出现新问题
- `emptyOutputRatio` 不可以直接归因给 assembler；没有 no-assembler A/B baseline 时，它只能作为观测指标

## 下一步怎么扩
- 继续引入风格明显不同的新 transcript
- 每份只抽 1 到 2 条高价值片段
- 先跑 strict real suite
- 只有当某个问题稳定复现，再改 prompt / normalize / merge 逻辑
- 若要判断 assembler 是否影响空输出率，需要补 no-assembler A/B baseline，而不是只看单侧 `emptyOutputRatio`

当前不建议继续只围绕现有几份文本打磨，否则容易过拟合。

## 相关文档
- [扩展运行时主链路基线](C:\Users\finni\Desktop\ListenGraph\docs\extension\runtime-mainline.md)
- [Structurer 运行时行为](C:\Users\finni\Desktop\ListenGraph\docs\extension\structurer-runtime.md)
- [扩展当前运行现状](C:\Users\finni\Desktop\ListenGraph\docs\extension\current-runtime.md)
