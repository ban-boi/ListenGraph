# 扩展真实使用闭环三层验证设计

## 目的
本文定义 extension 下一阶段的验证策略，目标不是“增加更多测试”，而是把现有测试资产按真实价值重新编排，形成一套围绕真实使用闭环的三层验证体系。

这里的“真实使用闭环”指：

`用户启动采集 -> 实时转写进入主链路 -> 结构化图逐步生成 -> 会话可停止/恢复 -> 调试/导出/回放可用 -> 常见错误可解释`

本文重点回答三个问题：
- 现有测试已经覆盖了什么
- 这些测试应当归在哪一层
- 下一步真正需要补的缺口是什么

## 设计原则
- 不重建测试体系，优先复用现有 `vitest + structure-focused + playwright`
- 不把所有质量问题都压给 E2E
- 高频回归优先使用更稳定、更便宜的测试层
- E2E 只承担“证明用户真的能用起来”的责任
- 每一层都要有明确的验证对象，而不是按工具分类

## 三层结构

### 第一层：Runtime Contract
这一层验证 extension 主运行时的状态机、消息编排、资产持久化和异常恢复。

它回答的问题是：
- service worker 是否按正确顺序启动和停止
- content script 注入和重试是否正确
- provider 配置是否正确进入运行时
- runtime state / persisted asset / snapshot 是否一致
- debug/export/replay 读取接口是否稳定

当前主要落点：
- `apps/extension/src/service-worker/index.test.ts`

这一层已经有较强基础，现有覆盖包括：
- 会话启动、停止、capture ended
- 重载后的 runtime state 恢复
- content script 缺失时的重新注入
- provider settings 进入运行时
- debug/export/replay 资产读取
- transcribing 中导出保护
- stop 与 in-flight chunk 的竞态处理

结论：
- 这一层不是空白，已经是当前测试体系最扎实的一层
- 下一步不是“补很多新 case”，而是围绕真实使用闭环补少数高风险状态流

### 第二层：Scenario Replay
这一层验证“真实输入语义进入 runtime 后，图是否按预期生长”，但不依赖真实浏览器交互和真实实时采集。

它回答的问题是：
- 真实 transcript / utterance 风格输入时，structurer 是否稳定
- merge / fallback / cross-graph edge 是否符合规则
- export/debug 是否能反映真实结构化结果
- 腾讯 realtime ASR 稳定句段抽取是否符合预期

当前主要落点：
- `apps/extension/src/service-worker/structure-focused.real.test.ts`
- `apps/extension/src/service-worker/asr-realtime.real.test.ts`

现有覆盖已经包含：
- bootstrap / incremental 结构化行为
- mustContainTexts / edgeTypes / cross-graph edges 规则化验收
- timeout / rate limit / diagnostic artifact
- 腾讯 realtime fixture 的稳定 utterance 验收

结论：
- 这一层已经是“真实语义质量回归”的主战场
- 下一步不该用 E2E 替代它，而应该继续把新 transcript 风格沉淀到这里

### 第三层：Thin E2E
这一层只验证少量高价值用户路径，确保整个扩展真的可以被人操作并跑通。

它回答的问题是：
- 扩展 dist 是否可启动
- sidepanel 是否能驱动一次完整会话
- 图、调试、导出、回放在真实 UI 中是否可达
- 真实 provider 环境下，最薄的一条端到端路径是否能成功

当前主要落点：
- `apps/extension/e2e/extension.local.spec.ts`
- `apps/extension/e2e/extension.real.spec.ts`

现有覆盖包括：
- 本地 fixture 驱动下完整会话
- sidepanel 中 debug/export/replay 的 UI 可达性
- 外部真实 provider 的真实音频 fixture 验收

结论：
- 当前已经有 E2E 基础
- 问题不是“有没有 E2E”，而是“E2E 还没有围绕真实使用闭环做明确分工”

## 现有测试重映射

### Runtime Contract
- `index.test.ts` 启动采集消息下发
- `index.test.ts` 腾讯 realtime 配置下发
- `index.test.ts` content script 丢失后的重注入
- `index.test.ts` session 持久化与恢复
- `index.test.ts` debug/export/replay 资产读取
- `index.test.ts` stop / transcribing / late chunk 竞态

### Scenario Replay
- `structure-focused.real.test.ts` 真实 structurer fixture 验收
- `asr-realtime.real.test.ts` 腾讯 realtime utterance 验收

### Thin E2E
- `extension.local.spec.ts` mock fixture 完整 UI 闭环
- `extension.real.spec.ts` 真实 provider 外部 fixture 验收

## 当前缺口
现有测试不弱，但围绕“真实使用闭环”还缺三类东西。

### 缺口一：主链路 smoke 还偏“fixture 驱动”，不够贴近真实采集失败面
当前 local E2E 更像“静态 fixture 页面 + mock provider 验证 UI 闭环”，这很好，但它不能证明：
- 用户真的选了标签页共享目标
- content script 实际启动采集后，UI 如何感知采集中状态
- realtime 主链路失败时用户看到什么

建议：
- 不新增重型 E2E，只新增 1 到 2 个更贴近真实采集交互的薄 smoke

### 缺口二：Provider 错误的用户可见闭环没有单独成层验证
现在 runtime contract 已经覆盖很多错误分支，但“sidepanel 是否把错误讲清楚”还没有成为一个明确目标。

建议：
- 增加一条薄 E2E 或 UI 驱动验证
- 专门检查 provider 配置错误、认证错误或 realtime 建连失败时的 UI 文案和状态收敛

### 缺口三：真实会话结束后的资产一致性还缺一个用户视角 smoke
当前测试分别验证了 export、debug、replay，但还缺“真实会话结束后，这三者在 UI 中连续可用”的单独验收语义。

建议：
- 保留现有 local E2E 作为基础
- 额外明确一条“结束会话后调试与回放仍可访问”的 smoke，避免未来重构把会后资产链路打断

## 推荐的近期落地顺序

### 第一步：先整理，不先扩张
先把现有测试在命名和文档上明确成三层：
- Runtime Contract
- Scenario Replay
- Thin E2E

目标是让未来讨论“该补哪层”时，不再陷入“是不是要继续加 E2E”的模糊状态。

### 第二步：只补两个薄 E2E
建议只新增以下两个场景：

1. `provider-error-visible`
- 目标：证明真实用户在配置错误或 provider 失败时能看到清晰错误，并且状态能收敛到可理解状态
- 价值：补的是用户闭环，不是算法闭环

2. `post-session-assets-available`
- 目标：证明一次会话结束后，debug/export/replay 三个会后能力都仍可访问
- 价值：补的是“使用闭环的后半段”

### 第三步：继续把质量问题留在 Replay 层
之后如果遇到新的结构化质量问题，优先补到：
- `structure-focused.real.test.ts`
- `asr-realtime.real.test.ts`

而不是优先加新的 E2E。

## 不建议做的事
- 不建议把 structurer 质量问题转成大量 Playwright 用例
- 不建议为每个 provider 都补一套完整 E2E
- 不建议把 replay 层与 E2E 层混成一套“全都测一点”的模糊体系
- 不建议在没有命名分层前继续随机加 case

## 当前建议结论
下一阶段应当明确采用三层策略，但实现方式是：

`保留现有测试基础 -> 重映射成三层 -> 仅补两个闭环型薄 E2E -> 继续把语义质量问题沉到 Replay 层`

这比“继续往上加很多 E2E”更稳，也更符合仓库已经形成的测试资产结构。
