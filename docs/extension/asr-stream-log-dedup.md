# ASR 流式日志合并（utteranceId dedup）

> 状态：proposal（设计已定，代码待实现）
> 最后更新：2026-05-25
> 适用对象：extension sidepanel 日志、ASR adapter、流式联调

## 目的

本文定义 sidepanel **日志区**如何展示 ASR 流式 `partial` 更新，避免「多识别一个字就多一行日志」淹没 structurer / graph 等其它事件。

关注点：

- 同一句 `partial` 在 UI 上**覆盖更新一行**，而不是逐条追加
- 句末 `final` 将该行**就地转为**永久转写行
- 多句并行时，每句各自一行（打字机式），互不覆盖
- 合并依据是 **LG 级结构化字段**，不是日志文案或 vendor 枚举

不覆盖：

- structurer / graph 的业务日志格式
- `TranscriptChunk` 持久化规则（仍只以 `final` 落库）
- debug export 里是否保留 partial 轨迹（可另议）

## 背景与现状问题

### 用户可见症状

实时 ASR 运行时，日志区被 ASR 中间结果占满，难以看到 structurer、图更新、会话状态等条目。

### 根因（2026-05 代码现状）

sidepanel 通过 `timelineEvents` + `transientKey` 做行内覆盖。`transientKey` 仅在 `asrSliceType !== undefined` 时设置：

```typescript
// panel-reducer.ts（现状）
const transientKey =
  asrSliceType !== undefined
    ? `asr-utterance-${asrUtteranceIndex}`
    : undefined;
```

| 路径 | partial 是否带 `asrSliceType` | 日志是否合并 |
|------|------------------------------|--------------|
| 腾讯 realtime WebSocket | 是（`slice_type` 0/1） | 通常能合并 |
| **Local ASR Bridge（LG-ASR-WS v1）** | **否**（走 `utteranceId`，无 `sliceType`） | **不能合并，逐条刷屏** |

Local ASR Bridge 在 content-script 已透传 `utteranceId` / `revision`，但 sidepanel dedup 未消费这些字段。

### 历史方案（应废弃）

1. **正则合并**（`apps/extension/src/sidepanel/log-line-helpers.ts`）
   - 匹配 `腾讯实时 ASR 开始|中间结果` 文案，在 `logs: string[]` 上 upsert
   - 已脱离主链路（`LogPanel` 改渲染 `timelineEvents` 后未接线）
   - 文案已变为 `{provider} 中间结果:`，正则即使复活也不稳定

2. **`asrSliceType` + sidepanel 自增 `asrUtteranceIndexRef`**
   - 2026-04-28「打字机式日志」引入，依赖腾讯 vendor 的 `slice_type`
   - 与 [LG-ASR-WS v1](../providers/lg-asr-ws-v1.md) §14「不统一厂商枚举」方向冲突
   - Bridge 路径天然缺失 `sliceType`

## 设计原则

1. **Dedup 在事件语义层，不在字符串层**
   - 依据 `kind=partial|final` 与 `utteranceId`
   - 不解析 `message` 文本，不用正则

2. **`utteranceId` 是 LG 合约字段，不是某个引擎的私有 id**
   - Bridge：协议必填（见 [LG-ASR-WS v1 §8.1](../providers/lg-asr-ws-v1.md)）
   - 腾讯等 vendor：由 **adapter 在边界上映射**（见下文映射表）
   - 批量非流式 ASR：无 partial，不参与本 dedup

3. **`revision` 不参与 transientKey**
   - `revision` 表示同一句内部的第 N 次修订
   - 同一句所有 partial 共享同一 `utteranceId`，应更新**同一行**
   - `revision` 可写入 `TimelineEvent.detail` 供调试

4. **Vendor 细节不进 sidepanel**
   - `slice_type`、`voice_id` 等保留在 `vendor` / `raw`
   - sidepanel 只认 LG 统一字段

## 目标行为

### 单句 partial 更新（句内覆盖）

```
[ASR] local-asr-bridge 中间结果: 今天的天气        ← transient，同 utteranceId 覆盖
[ASR] local-asr-bridge 中间结果: 今天的天气很好    ← 仍是一行，不是新行
```

### 句末 final（就地转正）

```
[ASR] 转写: 今天的天气很好 | 0:12-0:15 | local-asr-bridge   ← 去掉 transientKey，tone=success
```

若 final 到达时没有对应 transient 行（例如 bridge 未开 partial），则**新增**永久行（与现有 `finalizeTransientEvent` 兜底一致）。

### 多句并行（句间独立）

```
[ASR] … 中间结果: 第一句还在说_          ← utteranceId=utt-1
[ASR] 转写: 第一句完整文本 | …           ← utt-1 finalized
[ASR] … 中间结果: 第二句开始_            ← utteranceId=utt-2，新 transientKey
```

## transientKey 规则

### 规范

```text
transientKey = `asr-partial:${utteranceId}`
```

- 仅对 `kind === 'partial'`（或等价地：流式 interim 进度）设置
- `final` 不创建新 transient；通过 `TRANSCRIPT_READY` 对同一 key 做 `finalizeTransientEvent`
- `utteranceId` 缺失时：**不设置** transientKey，行为退化为逐条追加（与非流式 batch 进度一致）

### 与现有 timeline 机制的关系

[`timeline-utils.ts`](../../apps/extension/src/sidepanel/timeline-utils.ts) 中 `upsertTimelineEvent` **无需改动**：

- 相同 `transientKey` → 移除旧行，插入更新后的行
- 不同 `utteranceId` → 各自一行

需要改的是 **key 的来源** 与 **final 收尾时使用的 key**。

## 数据流

```text
Adapter (content-script)
  → ASR_STREAM_PARTIAL_UPDATED { utteranceId, revision, kind, text, … }
  → service-worker handleAsrStreamPartial
  → PROVIDER_PROGRESS { stage, message, utteranceId, asrStreamKind, … }
  → sidepanel panel-reducer
       transientKey = f(utteranceId, asrStreamKind)

Adapter final
  → ASR_STREAM_FINAL_READY → TranscriptChunk { utteranceId, … }
  → TRANSCRIPT_READY
  → finalizeTransient(`asr-partial:${transcript.utteranceId}`, …)
```

### 建议扩展的消息字段

在 `PROVIDER_PROGRESS` payload 中增加（或等价结构化字段）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `utteranceId` | `string?` | LG 级句段 id |
| `asrStreamKind` | `'partial' \| 'final'?` | 流式语义；batch 进度不传 |
| `revision` | `number?` | 可选，写入 event detail |

`message` 仍为人类可读展示文案，**不参与 dedup**。

实现时可保留 `asrSliceType` 一段时间仅用于腾讯 adapter 内部映射，但 **sidepanel 不再读取 `asrSliceType` 生成 transientKey**。

## Adapter：`utteranceId` 映射规则

ListenGraph 不要求厂商原生提供 `utteranceId`；要求在 **进入 LG 统一 schema 之前** 合成。

| 来源 | 流式？ | `utteranceId` 生成规则 | 备注 |
|------|--------|------------------------|------|
| **LG-ASR-WS v1 Bridge** | 是 | 使用协议 `utterance.utteranceId` | 参考实现：`utt-{index}` |
| **腾讯 realtime WS** | 是 | `message_id` 优先，否则 `voice_id` | vendor 字段已在 `AsrStreamPartialPayload.vendor` |
| **OpenAI / 腾讯 batch 等** | 否 | 不适用 | 无 partial 洪水；可选 `chunkId` 作展示 id |
| **未来云端流式 ASR** | 是 | adapter 文档化映射（session item id 等） | sidepanel 规则不变 |

腾讯 `slice_type` 映射（与 [LG-ASR-WS v1 §9.1](../providers/lg-asr-ws-v1.md) 一致）：

| 腾讯 | LG |
|------|-----|
| `slice_type=0` | `partial`（新句开始，仍属该 `message_id` 句段） |
| `slice_type=1` | `partial` |
| `slice_type=2` | `final` |

## 待删除 / 替换的实现

| 项目 | 处理 |
|------|------|
| `log-line-helpers.ts` 正则 upsert | 删除；或仅保留 export 过滤 helper（可选，非 dedup 核心） |
| `asrUtteranceIndexRef` | 删除；句序由 `utteranceId` 表达 |
| sidepanel 对 `asrSliceType` 的 transientKey 分支 | 删除 |
| SW partial 文案驱动 dedup | 无；SW 只负责透传结构化字段 |

## 实现范围（预估）

| 文件 | 变更 |
|------|------|
| `apps/extension/src/shared/messages.ts` | `PROVIDER_PROGRESS` 增加 `utteranceId` / `asrStreamKind` / `revision?` |
| `apps/extension/src/service-worker/asr-stream-handlers.ts` | partial 通知携带上述字段 |
| `apps/extension/src/service-worker/runtime-snapshot.ts` | `notifyProviderProgress` 签名扩展 |
| `apps/extension/src/content-script/content-script.ts` | 腾讯 partial/final 补 `utteranceId` 映射 |
| `apps/extension/src/sidepanel/panel-reducer.ts` | transientKey 改为 `utteranceId` 规则 |
| `apps/extension/src/sidepanel/hooks/useChromeMessages.ts` | 删除 `asrUtteranceIndexRef` 递增逻辑；TRANSCRIPT_READY 用 `transcript.utteranceId` |
| `apps/extension/src/sidepanel/log-line-helpers.ts` | 删除或降级为 export-only |
| `apps/extension/src/sidepanel/App.logging.test.tsx` | 改为 Bridge / 结构化 payload 集成测试 |

## 测试计划

1. **Bridge partial 链**：同一 `utteranceId` 连续 partial → 日志区仅 1 行，文案为最新 text
2. **Bridge final**：`TRANSCRIPT_READY` 后 partial 行消失/转为 `转写:`，且无残留中间结果行
3. **多句**：两个 `utteranceId` 交替 partial → 最多 2 行 transient（或 1 行 finalized + 1 行 transient）
4. **腾讯 regression**：映射 `message_id` 后行为与 Bridge 一致
5. **无 `utteranceId` 的 batch 进度**：仍逐条追加，不被误合并

推荐入口：`pnpm --filter extension test:run -- App.logging.test.tsx`，以及 content-script bridge 契约测试。

## 相关文档

- [LG-ASR-WS v1 协议草案](../providers/lg-asr-ws-v1.md) — `utteranceId` / `revision` / partial-final 语义权威
- [Local ASR Bridge 最小接入规范](../providers/local-asr-bridge-min-spec.md) — bridge 作者合约
- [扩展当前运行现状](./current-runtime.md) — ASR 双路径与 structurer 消费 `final` 的规则
- [扩展运行时主链路基线](./runtime-mainline.md) — content-script → service-worker → sidepanel 主链

### 历史参考（非实现权威）

- `docs/superpowers/specs/2026-04-28-log-typewriter-design.md` — 引入 per-utterance transientKey 的产品意图；本方案保留「句内覆盖、句间独立、final 就地转正」，但将 key 从 `asrSliceType` 计数改为 `utteranceId`

## 非目标

- 不在日志区展示字级时间戳或 token 级动画
- 不改变 structurer 仅消费 `final` 的管线
- 不要求历史 session replay 回填 partial 日志
- 不为 batch ASR 引入 utterance 级 dedup（无 partial 则无需求）
