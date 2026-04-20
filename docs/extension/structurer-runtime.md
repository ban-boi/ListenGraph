# 扩展 Structurer 运行时行为

## 目的
本文记录 extension 当前 `ASR -> structurer -> merge -> debug` 的运行时行为。

## 范围
本文覆盖：
- 转写窗口与 bootstrap 行为
- structurer 提示词合约
- provider 输出归一化
- 节点 id 规则
- 合并与去重规则
- 超时 / 重试策略
- 调试导出语义

本文不展开 sidepanel 的视觉稳定策略；关于 view 锁定、`fitView` 语义、稳定布局缓存和语义冻结的产品决策，见：
- [扩展增量图稳定性](C:\Users\finni\Desktop\ListenGraph\docs\extension\incremental-graph-stability.md)

## 当前管线
当前运行时应概括为：

`音频输入 -> ASR transcript / utterance -> 转写窗口 -> structurer 片段 -> 合并图 -> sidepanel`

上游输入同时可能来自：
- `batch`
- `ws`

因此当前 structurer 更准确的语义是：

`带最近窗口做上下文，但只抽 latest transcript 所暗示的净新增`

对在线主链路来说，`latest transcript` 默认应理解为：

- `tencent/ws` 下的稳定 utterance / transcript unit
- 而不是旧 batch 时代的固定 `10s chunk`

## 窗口与 Bootstrap 规则
当前 service worker 在内存中维护有界转写窗口。

当前规则：
- `STRUCTURER_BOOTSTRAP_MIN_CHUNKS = 2`
- `STRUCTURER_BOOTSTRAP_MIN_DURATION_MS = 45000`
- `STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT = 160`

行为：
- `batch`:
  - 少于 `2` 条 transcript 时，只更新转写/调试状态
  - 达到 `2` 条后，只有满足“时长够”或“字符数够”才启动 bootstrap
  - 达到 `3` 条时直接视为上下文足够
- `tencent/ws`:
  - 少于 `2` 条 stable utterance 时，只更新转写/调试状态
  - 不再使用“达到 `3` 条直接启动”的历史规则
  - 达到 `2` 条后，只有满足“累计时长够”或“累计有效字符数够”才启动 bootstrap
- 之后保持滚动窗口上下文，latest transcript 仍是增量焦点

## 提示词合约
当前请求特征：
- `response_format: { type: "json_object" }`
- 对智谱（Zhipu）仍显式关闭 `thinking`
- payload 包含：
  - `mode`
  - `windowTranscript`
  - `latestChunkTranscript`
  - `recentGraphContext`
  - `previousGraphSummary`

当前策略：
- bootstrap 可以对完整窗口做摘要
- incremental 只应输出 `latestChunkTranscript` 暗示的净新增
- incremental 默认应把 `recentGraphContext` 视为冻结语义，只允许追加，不应回写历史
- 若新内容只是支撑/细节/例证，优先用边表达
- 若无净新增语义，返回空 `nodes` / `edges`
- 不应重述近期图中已有语义
- 新增理由、收益、后果、补充说明，优先连回旧节点

## 转写清洗规则
structurer 不直接原样使用腾讯 ASR 原始文本。

当前清洗行为：
- 去掉腾讯风格的内层时间戳前缀
- 保留外层运行时区间包裹 `[startMs-endMs]`
- fallback 节点同样使用清洗后的文本

## Provider 输出归一化
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
- 丢弃无法解析端点的边
- 对常见近似 JSON 做有限修复
- 若响应前面是完整 JSON、后面附带解释文本，则提取前面的完整 JSON 对象
- 若归一化后没有有效节点，则退回最新清洗 transcript 的 draft claim 节点

## 规范节点 Id 规则
当前不直接信任模型给出的节点 id。

规则：
- 每个 segment 有独立 `segmentId`
- 规范节点 id 为 `segmentId:providerLocalId`
- 若 provider 未返回 id，运行时生成本地 fallback id

## 合并与去重规则
`mergeSegmentGraph()` 当前以历史稳定优先。

节点合并：
- 精确合并：同类型、无 speaker 冲突、规范化文本完全相同
- 保守近重复合并：同类型、非 `question`、时间接近、文本长度相近，且满足较高 bigram 重叠
- 合并后只更新 metadata，不改写已有节点文本、类型或 speaker
- “更完整的新说法”默认不应吞并旧节点，而应保留为新增节点并通过边表达关系

边合并：
- 合并后重写端点
- 丢弃自环边
- 丢弃不存在端点的边
- `source + target + type` 相同的边折叠

## 超时与重试策略
当前 structurer 策略偏保守：
- 请求 timeout 保持较长
- `429` 不自动重试
- timeout / abort 不在 provider 层做盲目重试
- 瞬时网络和部分 `5xx` 仍可走共享重试辅助

## 调试数据语义
当前调试层级包括：
- transcripts
- structurer segments
- transcript traces
- merged graph
- 派生渲染器视图
- `structurerRuns`

`structurerRuns` 当前汇总：
- mode
- 窗口范围与 transcript unit 数
- 字符数
- 近期图数量
- 耗时
- 成功 / timeout / error
- segment id
- 节点 / 边数量
- fallback 使用情况

## 默认 provider 备注
本文描述 structurer 行为，不直接描述 provider 选型。

当前需要区分：
- `packages/providers` 通用默认：仍是 `mock`
- `packages/providers` 中腾讯 provider 的通用归一化默认：未显式写 transport 时会收敛到 `ws`
- extension 运行时默认：ASR 已切到 `tencent/ws`
- extension 运行时默认：structurer 已切到 `aliyun`

## 相关文档
- [扩展运行时主链路基线](C:\Users\finni\Desktop\ListenGraph\docs\extension\runtime-mainline.md)
- [扩展当前运行现状](C:\Users\finni\Desktop\ListenGraph\docs\extension\current-runtime.md)
- [扩展增量图稳定性](C:\Users\finni\Desktop\ListenGraph\docs\extension\incremental-graph-stability.md)
- [Structure 回归说明](C:\Users\finni\Desktop\ListenGraph\docs\testing\structure-regression.md)
