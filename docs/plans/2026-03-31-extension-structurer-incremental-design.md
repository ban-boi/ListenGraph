# 扩展 Structurer 增量设计

> 本文件保留为历史计划/设计入口。
> 当前正式说明已迁移到：
> `docs/extension/structurer-runtime.md`

## 目的
本文记录在「原始真实 provider 基线」之后、对 **structurer（结构化）** 管线所做决策的当前版本。
它是扩展主链路中 **`ASR -> structurer -> merge -> debug`** 行为的权威说明。

## 范围
本文档覆盖当前**面向生产形态**的路径，包括：

- 转写窗口与 bootstrap（冷启动）行为
- structurer 提示词合约
- provider 输出归一化
- 规范节点 id 规则
- 合并与去重规则
- 超时 / 重试策略
- 调试导出的数据结构

**不**重新定义扩展采集管线或 provider 设置 UI。

## 权威来源
- 运行时编排：`apps/extension/src/service-worker/index.ts`
- Structurer provider：`packages/providers/src/structurer/openai-structurer.ts`
- Provider 默认值：`packages/providers/src/config.ts`
- 图合并规则：`packages/domain/src/merge.ts`
- 文本规范化辅助：`packages/domain/src/normalize.ts`
- 调试消息合约：`apps/extension/src/shared/messages.ts`

## 当前管线
活跃的运行时路径已不再只有固定 `10s batch` 版本。

当前概括应写成：

`音频输入 -> ASR transcript/utterance -> 转写窗口 -> structurer 片段 -> 合并图 -> sidepanel`

当前实现上同时存在两类上游输入：

- `batch`：仍可能表现为较粗的 chunk transcript
- `ws`：腾讯 realtime WebSocket，主链路更接近稳定话语 utterance

因此当前 structurer 语义更准确的表述是：

`带最近窗口做上下文，但只抽 latest transcript 所暗示的净新增`

这里的 `latest transcript` 对 batch 模式更像 chunk，对 realtime 模式更像稳定 utterance。

## 窗口与 Bootstrap 规则
Service worker 在内存中维护**有界**转写窗口。

当前规则：

- `STRUCTURER_BOOTSTRAP_MIN_CHUNKS = 2`
- `STRUCTURER_BOOTSTRAP_MIN_DURATION_MS = 45000`
- `STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT = 160`
- 在首次合并图出现之前，若不足 `2` 条 transcript，则只更新转写/调试状态
- 达到 `2` 条之后，只有在“时长够”或“字符数够”时才启动 bootstrap
- 之后仍保持滚动窗口上下文，latest transcript 仍是增量焦点

这样做的原因：

- 真实 realtime utterance 数量可能少于旧的固定 3 条阈值
- 单纯等待 3 条稳定 utterance，可能导致某些真实输入根本起不来 graph
- 用“条数 + 时长/字数”的联合条件，比旧的固定 3 条更适合实时输入

## Structurer 提示词合约
Structurer 提示词刻意写得**严格**，并针对增量抽取优化。

当前请求特征：

- `response_format: { type: "json_object" }`
- 对智谱（Zhipu），`thinking: { type: "disabled" }`
- 用户 payload 包含：
  - `mode`
  - `windowTranscript`
  - `latestChunkTranscript`
  - `recentGraphContext`
  - `previousGraphSummary`

当前提示词策略：

- bootstrap 模式可对完整 **`30s`** 窗口做摘要
- 增量模式**只应**输出由 `latestChunkTranscript` 暗示的**净新增**节点
- 若最新块仅增加支撑/细节/例证，优先用**边**表达，而非重复 claim
- 若无净新增语义贡献，返回空的 `nodes` 与 `edges`
- **不得**重述、转述或重命名近期图中已有语义
- 边可以指向返回的节点 id，或近期图中的节点 id

`recentGraphContext` 当前包含：

- 最近 **`8`** 个图节点
- 最近 **`4`** 条图边

这是有意权衡：

- 足够抑制重复
- 又足够小，使提示规模稳定

## 转写清洗规则
Structurer **不会**原样使用腾讯 ASR 原始转写文本。

当前清洗行为：

- 去掉腾讯风格的前缀时间戳，例如 `[0:0.000,0:10.000]`
- 保留外层运行时区间包裹 `[startMs-endMs]`
- fallback 节点同样使用清洗后的文本

从而避免出现双重包裹的时间戳，例如：

`[0-10000] [0:0.000,0:10.000] ...`

原始 ASR payload 仍保存在存储/调试中，但**不会**原样进入 structurer 提示词。

## Provider 输出归一化
模型被要求返回一个严格的 JSON 对象，但运行时在构建 segment 图之前仍会对常见「漂移」做归一化。

当前接受的形状：

- 顶层 `{ topic, nodes, edges }`
- 包装形态 `{ answer: { topic, nodes, edges } }`

当前接受的节点文本字段：

- `text`
- `content`
- `label`

当前归一化行为：

- 丢弃非法节点类型
- 丢弃非法边类型
- 丢弃空文本节点
- 丢弃无法解析到「返回节点」或「近期图节点」任一端点的边
- 对 provider 返回的近似 JSON，允许做有限修复：
  - 当前仅兜 `nodes/edges` 数组元素缺少对象起始 `{` 这类常见坏响应
- 若归一化后没有有效节点，运行时回退为：用**最新**清洗后的转写文本生成一条 draft claim 节点

意图：

- 提示词保持 happy path 严格
- 运行时应吸收已知 provider 漂移，而不是污染图

## 规范节点 Id 规则
**从不**将模型给出的节点 id 当作最终图 id。

当前规则：

- 每个 segment 有独立的 `segmentId`
- 每个归一化节点的规范 id 为 `segmentId:providerLocalId`
- 若 provider 未返回 id，运行时使用生成的本地 fallback，例如 `node_1`

原因：

- 模型经常重复使用 `n1`、`n2`、`1` 等 id
- React Flow 与合并图都需要**全局唯一**节点 id
- 边重写只有在规范化之后才确定

允许跨 segment 的边，但必须指向：

- 当前 segment 中生成的规范 id，或
- 在 `recentGraphContext` 中明确出现的近期图节点 id

## 合并与去重规则
`mergeSegmentGraph()` 现在将**图正确性**作为第一优先级。

### 节点合并
当前节点折叠规则：

- 精确合并：
  - `type` 相同
  - 无 speaker 冲突
  - 规范化文本**完全相同**
- 保守的近重复合并：
  - `type` 相同
  - 无 speaker 冲突
  - 非 `question`
  - 时间戳距离在 **`30s`** 内
  - 两段规范化文本都足够长
  - 且满足下列**之一**：
    - 一段包含另一段，或
    - bigram 重叠度至少 **`0.68`**

节点合并时：

- `confidence` 取**较大值**
- `evidenceChunkIds` **取并集**
- `timestampMs` 取**较早**时间
- 若任一被合并节点为 `confirmed`，`status` **升级为** `confirmed`

### 边合并
当前边规则：

- 边端点经节点合并产生的 remap 重写
- 丢弃自环边
- 丢弃指向不存在节点的边
- `source + target + type` 相同的重复边折叠为一条
- 折叠后边保留最大 confidence，evidence chunk id 取并集

用于在节点折叠后消除悬空边。

## 超时与重试策略
当前 structurer 策略**刻意**比通用 provider 默认更保守。

当前 structurer 默认值（provider package 通用默认）：

- 超时：`90s`
- **`429` 不重试**
- **超时 / abort 不重试**
- 瞬时网络与部分 **`5xx`** 仍可通过共享重试辅助重试

理由：

- 先前 **`15s`** 超时导致本机取消，继而出现重复的后续请求
- 对 **`429` 重试**会放大限流问题而非缓解
- 超时应对当前这次运行表现为**终结性错误**，而不是默默连打重试

## 调试数据合约
调试导出现在区分**运行时可观测性**与**原始 payload 留存**。

当前调试层级：

- transcripts（转写）
- structurer segments（结构化片段）
- chunk traces（块级轨迹）
- merged graph（合并图）
- 派生的渲染器视图
- 结构化 `structurerRuns`

`structurerRuns` 用于汇总每次 structurer 尝试，包括：

- mode
- 窗口范围与块数量
- 转写字符数
- 近期图数量
- 开始/结束时间戳
- 耗时
- 成功 / 超时 / 错误
- segment id
- 节点/边数量
- 是否使用 fallback

导出策略：

- 默认调试导出为 **slim（精简）**
- slim 导出**不**内联全部 `tokens` 与大型 `raw` blob
- **full（完整）** 导出保留原始 payload，便于深度诊断

使日常调试文件可读，同时在需要时保留全保真路径。

## 已知权衡
当前设计**刻意**偏向管线稳定性，而非**最终图质量**。

已知权衡：

- 当前允许跨 segment 连接，可能仍**偏激进**
- fallback 节点保护连续性，但也可能把低质量原句灌进图
- 即使提示规模稳定，provider 延迟方差仍很大
- 提示侧抑制重复，合并仍要承担一部分去重负担

## 未决问题
下列事项**尚未**视为定案：

1. 跨 segment 边策略可能仍过于宽松。
2. 即使滚动窗口很小，provider 延迟与响应质量方差仍然存在。
3. fallback 行为可能仍需继续收紧，避免弱响应污染图。

## 默认 provider 备注
本文档描述的是 structurer 行为，不是 provider 选择策略。

当前 provider 默认值需要区分两层：
- `packages/providers` 通用默认：仍是 `mock`
- extension 运行时默认：structurer 已切到 `aliyun`

如果要理解 extension 的真实默认 provider，请结合：
- `apps/extension/src/service-worker/index.ts`
- `docs/extension/current-runtime.md`

## 变更规则
若实现对下列任一项做出修改，应在**同一变更**中同步更新本文档：

- 转写窗口大小或 bootstrap 阈值
- 增量提示词合约
- 近期图上下文形状
- 规范 id 策略
- 合并阈值
- 超时 / 重试行为
- 调试导出语义
