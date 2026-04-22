# 本地 ASR / WS Bridge 接入改造清单

> 状态：proposal
> 最后更新：2026-04-21
> 目标：把“本地 ASR 接入 ListenGraph”从个人实验能力提升为可分发的产品能力

## 1. 总体原则

这轮改造的核心不是“加入 sherpa-onnx 支持”，而是：

- 把 **外部流式 ASR bridge** 提升为一等产品能力
- 把腾讯 realtime 从“唯一 ws 特例”降级为“第一个 vendor adapter”
- 让 sherpa-onnx 成为“第一个本地 bridge 参考实现”

一句话概括：

- **产品名义上的能力应该叫 Local / External ASR**
- **sherpa-onnx 只是该能力的 reference backend**

## 2. 当前代码现状

### 2.1 schema 仍是 batch-first

当前 `AsrProviderType` 只有：

- `mock`
- `openai`
- `tencent`

见 [packages/schema/src/provider.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/packages/schema/src/provider.ts:5)

当前 `AsrProvider` 接口只有：

- `transcribeChunk(...): Promise<TranscriptChunk>`

见 [packages/schema/src/provider.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/packages/schema/src/provider.ts:103)

这意味着 schema 仍把 ASR 看成“给一块音频，返回一块最终文本”的 provider。

### 2.2 当前 realtime 是腾讯专用旁路

当前 realtime 逻辑：

- content-script 直接建立腾讯 ws
- 识别 `slice_type=0/1/2`
- `0/1` 发 `ASR_STREAM_PARTIAL_UPDATED`
- `2` 发 `ASR_STREAM_UTTERANCE_READY`

见 [apps/extension/src/content-script/content-script.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/apps/extension/src/content-script/content-script.ts:473)

这条链路可用，但它是 vendor-aware 的。

### 2.3 下游已经是“稳定 utterance 驱动”

service worker 当前只把最终 utterance 落成 `TranscriptChunk`，再驱动 structurer。

见 [apps/extension/src/service-worker/index.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/apps/extension/src/service-worker/index.ts:531)

这其实已经很接近产品目标：

- partial 仅用于进度展示
- final utterance 才进入图谱链路

因此这轮改造应以“抽象提升”为主，而不是推翻整条主链路。

## 3. 目标状态

完成后应达到以下产品状态：

1. 用户可在 ListenGraph 里选择 `腾讯云` 或 `本地 ASR Bridge`
2. 用户填写一个 ws 地址即可接入自己的本地 ASR
3. ListenGraph 不关心对方是 sherpa、whisper.cpp 还是自定义服务
4. structurer 只消费统一的稳定 utterance
5. replay / contract / real 测试都可以基于统一事件模型回归

## 4. 分阶段实施

建议分四阶段做，不要一口气重写。

### Phase 1：定义统一模型，不改主链路

目标：

- 先把协议、schema、消息命名定下来
- 现有腾讯链路继续跑

交付：

- `LG-ASR-WS v1` 文档
- 新的统一类型定义
- 腾讯协议到统一事件的 mapping 说明

### Phase 2：新增 external bridge provider

目标：

- 在不动腾讯默认路径的前提下，允许 LG 连接任意本地 ws bridge

交付：

- `external` / `bridge` ASR provider
- sidepanel 配置项
- 基础健康检查

### Phase 3：把腾讯 realtime 适配到统一事件层

目标：

- 让 content-script / service-worker 内部不再依赖 `slice_type`

交付：

- provider-neutral 的流式消息
- 腾讯 adapter
- 回归测试迁移

### Phase 4：参考 bridge 与文档分发

目标：

- 让别人能在自己的电脑上快速跑起来

交付：

- sherpa-onnx Python bridge reference
- 本地接入文档
- 故障排查文档

## 5. 仓库级改造清单

## 5.1 `packages/schema`

### 5.1.1 扩展 provider 类型

文件：

- [packages/schema/src/provider.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/packages/schema/src/provider.ts:1)

建议改动：

- `AsrProviderType` 新增 `external`
- `AsrTransport` 继续保留 `batch | ws`
- 对 `ws` 的语义改写为“通用流式 transport”，不再默认等价于腾讯专用 transport

建议新增配置字段：

```ts
bridgeProtocol?: 'lg-asr-ws-v1';
bridgeAuthToken?: string;
bridgeHeaders?: Record<string, string>;
```

建议新增 external 专属配置字段：

```ts
endpoint?: string; // ws://127.0.0.1:15377/ws
model?: string;    // bridge 自报即可，此处可选
```

### 5.1.2 扩展 transcript 领域模型

文件：

- [packages/schema/src/transcript.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/packages/schema/src/transcript.ts:1)

当前 `TranscriptChunk` 还不足以表达流式来源，建议补充：

```ts
utteranceId?: string;
sequence?: number;
kind?: 'final';
finalReason?: 'endpoint' | 'input_finished' | 'max_duration' | 'manual_flush' | 'vendor_defined' | 'error_recovery';
transport?: 'batch' | 'ws';
stability?: 'stable';
language?: string;
metrics?: {
  latencyMs?: number;
  audioDurationMs?: number;
  realtimeFactor?: number;
};
```

说明：

- 持久化主记录仍建议只保存 `final`
- `partial` 不强制落到 `TranscriptChunk` 表
- 如果后续要做 partial trace，可单独建 debug event 表，而不是污染 transcript 主表

### 5.1.3 新增流式事件类型

建议在 schema 或 shared messages 层增加统一事件定义，例如：

```ts
type AsrStreamEvent =
  | { type: 'partial'; ... }
  | { type: 'final'; ... }
  | { type: 'status'; ... }
  | { type: 'error'; ... };
```

目标：

- 让 content-script 与 service-worker 之间传的是 LG 语义
- 而不是腾讯特有 payload

## 5.2 `apps/extension/src/shared/messages.ts`

文件：

- [apps/extension/src/shared/messages.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/apps/extension/src/shared/messages.ts:1)

当前消息命名是腾讯导向的：

- `AsrStreamUtterancePayload`
- `AsrStreamPartialPayload`
- `AsrStreamStatusPayload`
- `AsrStreamErrorPayload`

建议改成 provider-neutral 命名：

- `AsrStreamFinalPayload`
- `AsrStreamPartialPayload`
- `AsrStreamStatusPayload`
- `AsrStreamErrorPayload`

并去掉腾讯专属字段作为主字段：

- `sliceType`
- `voiceId`
- `messageId`

这些字段应移到：

- `vendor`
- 或 `raw`

`AsrStreamStartPayload` 也建议从：

```ts
{
  transport: 'batch' | 'ws';
  tencentRealtime?: ...
}
```

演进为：

```ts
{
  transport: 'batch' | 'ws';
  stream?: {
    providerType: 'tencent' | 'external';
    endpoint?: string;
    protocol?: 'lg-asr-ws-v1';
    sampleRate: number;
    frameDurationMs: number;
    authToken?: string;
    vendorConfig?: Record<string, unknown>;
  };
}
```

### 为什么现在不能一步删掉腾讯字段

因为现有测试和运行链路都依赖腾讯 payload。建议做法：

1. 先新增 provider-neutral 字段
2. 保留腾讯字段兼容一版
3. 测试迁移完成后再删旧字段

## 5.3 `apps/extension/src/content-script`

文件：

- [apps/extension/src/content-script/content-script.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/apps/extension/src/content-script/content-script.ts:1)

当前职责过重：

- 采集音频
- 建腾讯 ws
- 理解腾讯协议
- 组装腾讯特有消息

目标状态应改为：

- 采集音频
- 建某个流式目标的 ws
- 把 vendor 协议映射为 LG 统一事件

建议拆出适配层：

- `tencent-stream-adapter.ts`
- `external-bridge-adapter.ts`

content-script 主文件只保留：

- 音频采集
- socket 生命周期
- 统一事件转发

### 需要做的具体改动

1. 提炼通用 ws client 生命周期
2. 把腾讯解析逻辑挪到 adapter
3. 新增 external bridge 协议解析
4. 把 `slice_type` 判定改为 adapter 内部行为

## 5.4 `apps/extension/src/service-worker`

文件：

- [apps/extension/src/service-worker/index.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/apps/extension/src/service-worker/index.ts:1)

### 5.4.1 保持不变的部分

这些可以基本不动：

- `processTranscriptChunk()`
- bootstrap 判断
- structurer 窗口逻辑
- merged graph 流程

因为这些逻辑本来就只依赖稳定 utterance。

### 5.4.2 需要改的部分

1. `buildContentScriptStartPayload()`
2. `handleAsrStreamPartial()`
3. `handleAsrStreamStatus()`
4. `handleAsrStreamError()`
5. `handleAsrStreamUtterance()`

其中最重要的是 `buildContentScriptStartPayload()` 当前只会在 `tencent/ws` 下发腾讯签名参数，[apps/extension/src/service-worker/index.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/apps/extension/src/service-worker/index.ts:1176)。

目标应改为：

- `tencent/ws` -> 下发腾讯 stream config
- `external/ws` -> 下发 external bridge config
- `batch` -> 保持现状

### 5.4.3 Transcript 落盘策略

建议：

- 只有 `final` 进入 transcript repository
- partial 只做 sidepanel progress 和 debug trace

原因：

- structurer 只需要稳定 utterance
- 否则 transcript repository 会被大量中间修订污染

## 5.5 `packages/providers`

### 5.5.1 新增 `external-bridge` provider

文件建议：

- `packages/providers/src/asr/external-bridge-asr.ts`

职责：

- 为 runtime 提供 external provider 配置校验
- 提供必要的 provider name / reset 行为
- 其真正的流式过程仍由 extension realtime 管线驱动

注意：

- 它不一定像 batch provider 一样实现完整 `transcribeChunk`
- 当前接口如果难以兼容，建议新增流式能力接口，而不是硬塞进 batch 接口

### 5.5.2 provider registry

文件建议检查：

- `packages/providers/src/registry.*`
- `packages/providers/src/index.ts`

需要做的事：

- registry 支持 `external`
- provider summary 能正确暴露 endpoint / protocol / auth configured

### 5.5.3 配置归一化

文件：

- [packages/providers/src/config.ts](/abs/path/C:/Users/finni/Desktop/ListenGraph/packages/providers/src/config.ts:1)

建议新增默认归一化规则：

- `external + ws` 时必须有 `endpoint`
- `external + batch` 直接视为非法
- `bridgeProtocol` 默认 `lg-asr-ws-v1`

同时不要再让“`transport=ws` 自动等于腾讯”成为隐式前提。

## 5.6 UI / 设置页

### 需要新增的产品项

用户在 provider settings 至少应能配置：

- ASR provider type：`tencent` / `external`
- transport：`batch` / `ws`
- endpoint：例如 `ws://127.0.0.1:15377/ws`
- protocol：`lg-asr-ws-v1`
- auth token：可选

### 需要新增的用户反馈

- “本地 bridge 已连接”
- “bridge 握手成功，模型 xxx”
- “bridge 连接失败：端口未开启”
- “bridge 已连接但模型初始化失败”

### 为什么这一步是产品化关键

因为别人接本地 ASR 时，最大的成本不是代码，而是：

- 不知道应该连哪
- 连上了不知道是否可用
- 出错了不知道是 LG、bridge、模型还是音频格式问题

没有健康检查和状态可视化，这个能力就很难分发给别人。

## 5.7 测试体系

当前三层测试策略可以保留，但要补一层“统一事件回归”。

建议新增：

### contract

- provider config 对 `external` 的合法性校验
- LG-ASR-WS v1 事件解析 contract
- bridge 握手 contract

### replay

- 不再只回放腾讯原始响应
- 增加回放“LG 统一流式事件”的 fixtures

### thin E2E

- 可先不跑真实 sherpa
- 用 mock bridge server 模拟：
  - partial
  - final
  - status
  - error

这样可以先验证扩展内链路。

## 6. sherpa-onnx 参考 bridge 设计

建议新建独立目录，例如：

- `tools/local-asr-bridge/sherpa-onnx/`

首版 bridge 需要做的事：

1. 启动 ws server
2. 接收 `session.start`
3. 接收 `audio.frame`
4. 将 PCM 转成 float32
5. 喂给 `recognizer.create_stream()`
6. 持续 decode 并发 `partial`
7. `is_endpoint(stream)` 时发 `final`
8. 发完 `final` 后 `reset(stream)`
9. `audio.flush` / 结束时做 residual flush

### sherpa 的特殊点该放哪一层

应该全部放在 bridge 层：

- `enable_endpoint_detection=True`
- `rule1/rule2/rule3`
- `reset(stream)`
- `input_finished()`

不应该泄漏到 ListenGraph 的产品层配置。

### 首版配置建议

bridge 自己支持启动参数：

- `--host`
- `--port`
- `--encoder`
- `--decoder`
- `--tokens`
- `--num-threads`
- `--rule1-silence`
- `--rule2-silence`
- `--rule3-max-utterance`

LG 侧只关心：

- `ws://127.0.0.1:15377/ws`

## 7. 对用户分发时的产品包装

面向别人时，建议把能力表述为：

- `Tencent Realtime ASR`
- `Local ASR Bridge`
- `Custom ASR Bridge`

不要直接把产品能力命名成：

- `SherpaOnnx`

原因：

- 这会让产品抽象被一个具体实现绑死
- 后面接 whisper.cpp 时命名会越来越乱

正确关系应是：

- `Local ASR Bridge` 是产品能力
- `SherpaOnnx Bridge` 是参考实现

## 8. 实施顺序建议

建议按下面顺序推进，风险最小：

1. 先补协议文档与类型草案
2. 再做 `external` provider config + settings UI
3. 再把 content-script 流式链路抽象成 adapter
4. 再接 mock bridge server 跑 contract / replay
5. 最后再接 sherpa 真实 bridge

不要反过来先把 sherpa 写死接进去。

## 9. 可接受的 v1 简化

为了尽快落地，v1 可以主动简化为：

- 只支持 `16k mono pcm_s16le`
- 只支持单连接单会话
- 只要求 `final`
- `partial` 作为可选能力
- 不做 token timestamps 强制要求
- 不做复杂鉴权，先支持 `auth token`

这些简化不会破坏产品方向，反而有利于尽快形成稳定基线。

## 10. 建议立即开的实现任务

第一批可以直接建 issue 的任务：

1. `schema: add external ASR provider type and stream event model`
2. `extension: make stream messages provider-neutral`
3. `extension: add external ws bridge start payload and health status`
4. `providers: support external bridge config normalization`
5. `test: add lg-asr-ws-v1 mock bridge contract fixtures`
6. `tools: add sherpa-onnx local bridge reference server`
7. `docs: write user guide for local ASR bridge setup`

## 11. 最后结论

这件事的正确落点不是：

- “给 ListenGraph 加一个 sherpa provider”

而是：

- “给 ListenGraph 加一个可分发的 Local / External ASR Bridge 能力”

只要这个抽象做对了：

- 你现在电脑上的 sherpa 可以先接进来
- 别人未来也可以用自己电脑上的本地 ASR 轻易接入
- 腾讯 realtime 仍然可以继续存在，并作为同一抽象下的一个 adapter
