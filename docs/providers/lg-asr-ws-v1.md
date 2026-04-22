# LG-ASR-WS v1 协议草案

> 状态：proposal
> 最后更新：2026-04-21
> 目标：为 ListenGraph 定义一个可由任意本地 / 远端 ASR bridge 实现的统一 WebSocket 协议

## 1. 设计目标

LG-ASR-WS v1 解决的问题不是“如何接入某一个 ASR”，而是：

- ListenGraph 如何消费来自任意 ASR 引擎的流式结果
- 本地 ASR 如何在不侵入扩展内部实现的前提下接入 ListenGraph
- 腾讯 / sherpa-onnx / whisper.cpp / faster-whisper / FunASR / 用户自定义服务，如何在 LG 内部呈现为同一套语义

本协议明确区分：

- **vendor protocol**：腾讯、sherpa-onnx、其他引擎各自原生协议
- **LG protocol**：ListenGraph 内部认知的统一事件协议

结论：

- LG **不**把腾讯 `slice_type=0/1/2` 作为通用标准
- LG **不**要求不同引擎使用同一种 endpoint 算法
- LG **只**要求 bridge 输出统一的流式事件语义

## 2. 非目标

v1 明确不覆盖：

- 模型下载、模型分发、模型版权问题
- 本地 companion 的安装器形态
- 说话人分离、字级时间戳、对齐模型等高级能力
- 双向控制复杂协商，例如动态切换模型、在线热更新参数

这些能力允许未来扩展，但不纳入 v1 必需项。

## 3. 产品层统一语义

ListenGraph 在产品层只关心以下四类流式语义：

- `partial`：中间结果，允许后续被覆盖
- `final`：稳定结果，后续不再改写
- `status`：连接 / 运行状态
- `error`：可呈现给用户或调试层的错误

其中：

- sidepanel 可以显示 `partial`
- structurer 只消费 `final`
- debug/export 保存 `final` 以及必要的 `partial/status/error` 轨迹

## 4. 角色与连接方向

推荐拓扑：

`Chrome extension(content-script/service-worker) -> localhost WebSocket bridge -> 本地 ASR runtime`

角色定义：

- **LG Client**：ListenGraph extension 内的 ws 客户端
- **ASR Bridge Server**：本地 companion 或用户自定义服务
- **ASR Engine**：sherpa-onnx / whisper.cpp / 其他推理引擎

v1 默认由 LG 主动连接 bridge。

推荐默认 endpoint：

- `ws://127.0.0.1:15377/ws`

这只是推荐值，不写入协议强制要求。

## 5. 握手与会话

连接建立后，客户端先发送 `session.start`。

### 5.1 `session.start`

```json
{
  "type": "session.start",
  "version": "1",
  "session": {
    "sessionId": "session_123"
  },
  "audio": {
    "codec": "pcm_s16le",
    "sampleRate": 16000,
    "channels": 1,
    "frameDurationMs": 40
  },
  "client": {
    "name": "listengraph-extension",
    "build": "dev"
  },
  "options": {
    "partials": true,
    "finals": true,
    "tokens": false,
    "timestamps": false
  }
}
```

字段要求：

- `type`：固定为 `session.start`
- `version`：协议主版本，v1 固定 `"1"`
- `session.sessionId`：LG 侧会话 id
- `audio.codec`：v1 固定支持 `pcm_s16le`
- `audio.sampleRate`：v1 推荐 `16000`
- `audio.channels`：v1 固定 `1`
- `audio.frameDurationMs`：建议 `40`

### 5.2 `session.started`

服务端接受后返回：

```json
{
  "type": "session.started",
  "version": "1",
  "session": {
    "sessionId": "session_123",
    "bridgeSessionId": "bridge_abc"
  },
  "bridge": {
    "name": "sherpa-onnx-bridge",
    "engine": "sherpa-onnx",
    "engineVersion": "1.12.39",
    "model": "streaming-paraformer-bilingual-zh-en",
    "supports": {
      "partials": true,
      "finals": true,
      "tokens": true,
      "timestamps": false
    }
  }
}
```

该消息用于：

- sidepanel 展示当前连接的是哪个本地 bridge / 模型
- debug 数据记录当前运行能力

### 5.3 `session.stop`

客户端停止时发送：

```json
{
  "type": "session.stop",
  "session": {
    "sessionId": "session_123"
  }
}
```

服务端可返回：

```json
{
  "type": "session.stopped",
  "session": {
    "sessionId": "session_123"
  }
}
```

如果连接直接关闭，也视为会话终止。

## 6. 音频上行

握手成功后，客户端持续发送 `audio.frame`。

### 6.1 `audio.frame`

```json
{
  "type": "audio.frame",
  "seq": 17,
  "audio": {
    "codec": "pcm_s16le",
    "data": "<base64>",
    "samples": 640,
    "startMs": 640,
    "endMs": 680
  }
}
```

字段要求：

- `seq`：单连接内单调递增
- `audio.data`：base64 编码的 PCM 数据
- `audio.startMs` / `audio.endMs`：相对会话开始时间

说明：

- v1 优先采用 JSON + base64，先求简单稳定
- 如果后续要优化吞吐，可加 binary frame 模式，但不纳入 v1 必需项

### 6.2 `audio.flush`

客户端在输入结束或需要强制出段时发送：

```json
{
  "type": "audio.flush",
  "reason": "input_finished"
}
```

允许的 `reason`：

- `input_finished`
- `manual_flush`

bridge 收到后应尽量产出剩余 `final`。

## 7. 下行事件

### 7.1 `transcript.partial`

```json
{
  "type": "transcript.partial",
  "utterance": {
    "utteranceId": "utt_001",
    "revision": 3,
    "text": "我觉得这个问题",
    "startMs": 1200,
    "endMs": 2640,
    "isFinal": false,
    "stability": "interim",
    "language": "zh",
    "confidence": 0.83
  },
  "vendor": {
    "name": "sherpa-onnx",
    "event": "decode_result"
  }
}
```

语义要求：

- 同一 `utteranceId` 的 partial 可以多次更新
- `revision` 必须单调递增
- `isFinal` 必须为 `false`

### 7.2 `transcript.final`

```json
{
  "type": "transcript.final",
  "utterance": {
    "utteranceId": "utt_001",
    "revision": 4,
    "text": "我觉得这个问题非常关键",
    "startMs": 1200,
    "endMs": 3120,
    "isFinal": true,
    "stability": "stable",
    "finalReason": "endpoint",
    "language": "zh",
    "confidence": 0.91,
    "tokens": [
      { "text": "我" },
      { "text": "觉得" }
    ]
  },
  "vendor": {
    "name": "sherpa-onnx",
    "event": "endpoint"
  }
}
```

语义要求：

- `transcript.final` 一旦发出，后续不再改写同一 `utteranceId`
- `finalReason` 必须存在
- structurer 只消费这种事件

允许的 `finalReason`：

- `endpoint`
- `input_finished`
- `max_duration`
- `manual_flush`
- `vendor_defined`
- `error_recovery`

### 7.3 `status`

```json
{
  "type": "status",
  "status": "connected",
  "detail": "sherpa-onnx bridge ready"
}
```

允许值：

- `connecting`
- `connected`
- `listening`
- `closing`
- `closed`

说明：

- `connecting` / `connected` 更偏连接状态
- `listening` 表示模型已经完成初始化，开始正常接收音频

### 7.4 `error`

```json
{
  "type": "error",
  "error": {
    "code": "ENGINE_INIT_FAILED",
    "message": "Failed to load encoder.int8.onnx",
    "retriable": false
  }
}
```

建议错误分类：

- `AUTH_ERROR`
- `NETWORK_ERROR`
- `CONFIG_ERROR`
- `ENGINE_INIT_FAILED`
- `ENGINE_RUNTIME_ERROR`
- `INVALID_AUDIO_FORMAT`
- `UNSUPPORTED_PROTOCOL_VERSION`
- `BAD_REQUEST`

说明：

- v1 不强制要求所有 bridge 与 LG 共享同一错误码全集
- 但 bridge 至少应返回机器可判断的 `code` 和用户可见的 `message`

## 8. 统一字段语义

### 8.1 `utteranceId`

`utteranceId` 是 LG 级别的稳定段 id。

要求：

- 在同一 bridge session 内唯一
- 对 partial/final 配对稳定
- 不要求跨 session 稳定

### 8.2 `revision`

`revision` 用于区分同一 utterance 的多次中间修订。

规则：

- 首次 partial 可从 `1` 开始
- final 的 `revision` 必须不小于最后一次 partial

### 8.3 `startMs` / `endMs`

统一为相对会话开始时间的毫秒数。

如果引擎原生没有精确时间戳：

- 允许 bridge 用音频帧送入时间进行近似估算
- 必须保证 `endMs >= startMs`

### 8.4 `stability`

允许值：

- `interim`
- `stable`

约束：

- `partial` 默认 `interim`
- `final` 默认 `stable`

## 9. Vendor 映射规则

### 9.1 腾讯 realtime

腾讯原生：

- `slice_type=0`：开始
- `slice_type=1`：中间结果
- `slice_type=2`：稳定结果

映射到 LG：

- `slice_type=0` -> `transcript.partial`
- `slice_type=1` -> `transcript.partial`
- `slice_type=2` -> `transcript.final`

注意：

- 腾讯的 `0/1/2` 是 vendor 细节，不进入 LG 统一 schema 主字段
- 如需保留，写进 `vendor.event` 或 `raw`

### 9.2 sherpa-onnx streaming paraformer

Sherpa 原生关键点：

- `get_result()` 可持续返回中间文本
- `is_endpoint(stream)` 判定是否应断句
- `reset(stream)` 后开始新段
- `input_finished()` 收尾

映射到 LG：

- 常规 decode 结果 -> `transcript.partial`
- `is_endpoint(stream)=true` 的最终段 -> `transcript.final`，`finalReason=endpoint`
- `input_finished()` 后仍有残留文本 -> `transcript.final`，`finalReason=input_finished`

## 10. v1 对 bridge 的最小合约

任意 bridge 若宣称兼容 LG-ASR-WS v1，至少必须满足：

1. 能接收 `session.start`
2. 能接收 `audio.frame`
3. 能发送 `status`
4. 能发送 `transcript.final`
5. 最终文本一旦发出不再改写
6. 音频结束时能通过 `audio.flush` 或断开前输出残留最终结果

可选项：

- `transcript.partial`
- `tokens`
- `confidence`
- 更细粒度 timestamps

## 11. ListenGraph 内部消费规则

LG 内部建议采用以下规则：

- sidepanel 允许显示最新 `partial`
- `TranscriptChunk` 持久化主记录只保存 `final`
- `partial/status/error` 默认进入 debug trace，不进入 structurer 主输入
- structurer bootstrap / incremental 规则继续以“stable utterance”作为最小单位

这与当前腾讯 realtime 主链路一致，只是把腾讯特有逻辑抽象成通用语义。

## 12. 兼容策略

v1 与当前仓库的关系：

- 当前 `transport='ws'` 实际只代表腾讯 realtime 专用链路
- 演进后应扩展为“统一流式 bridge transport”

建议兼容方案：

- 保留现有腾讯链路，作为第一个 adapter
- 新增 external bridge provider，不破坏已有腾讯使用路径
- 在完成 adapter 迁移后，再把 content-script / service-worker 的消息结构改为 provider-neutral

## 13. 参考实现要求

首个参考实现建议为 `sherpa-onnx bridge`，职责：

- 接收 16k mono PCM
- 将 PCM 送入 sherpa online recognizer
- 用 endpoint detection 产出 `transcript.final`
- 将 sherpa 原生事件映射为 LG-ASR-WS v1

首版实现建议优先保证：

- CPU 可用
- Windows 本机可跑
- 桥接日志清晰
- 启动参数简单

不建议首版就追求：

- OpenVINO / NPU
- 多模型自动切换
- GUI 安装器

## 14. 为什么不直接统一成腾讯的 `0/1/2`

原因有三：

1. 它描述的是腾讯协议状态，不是跨引擎稳定语义
2. sherpa / whisper.cpp / faster-whisper 原生并不天然长成这个枚举
3. LG 真正依赖的是“中间结果”和“稳定结果”的产品语义，而不是厂商状态码

因此 v1 应统一语义，不统一厂商枚举。
