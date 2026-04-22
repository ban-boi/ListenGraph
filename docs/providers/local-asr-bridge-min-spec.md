# Local ASR Bridge 最小接入规范

> 状态：draft
> 最后更新：2026-04-22
> 适用对象：希望把自己的本地 ASR / 自定义 ASR 服务接到 ListenGraph 的 bridge 作者

这份文档不重复展开完整协议细节。它只回答一个更现实的问题：

- 如果我要让自己的 bridge 被 ListenGraph 正常消费，最少必须做到什么

完整语义定义仍以 [LG-ASR-WS v1 协议草案](C:/Users/finni/Desktop/ListenGraph/docs/providers/lg-asr-ws-v1.md) 为准。

## 1. 你要实现的不是某个模型适配，而是一个 bridge

ListenGraph 关心的是：

- 有一个可连接的 WebSocket endpoint
- 这个 endpoint 接收音频帧
- 它能把识别结果按统一语义吐出来

ListenGraph 不关心你底层是：

- sherpa-onnx
- whisper.cpp
- faster-whisper
- FunASR
- 你自己的 HTTP / gRPC / SDK 封装

也就是说：

- **产品能力名是 `Local ASR Bridge`**
- **你的实现只是 `Local ASR Bridge` 的一个 backend**

## 2. 最小必需能力

如果你的 bridge 要宣称“可接入 ListenGraph”，至少必须满足这 6 条：

1. 提供一个可访问的 WebSocket 地址，例如 `ws://127.0.0.1:15377/ws`
2. 提供一个可访问的健康检查地址，例如 `http://127.0.0.1:15377/healthz`
3. 能接收 `session.start`
4. 能接收 `audio.frame`
5. 能输出 `transcript.final`
6. 在输入结束时，能通过 `audio.flush` 或连接结束前输出剩余 final

如果这 6 条里缺任意一条，ListenGraph 侧都不能把它当成一个稳定 bridge 能力。

## 3. 必需上行消息

### 3.1 `session.start`

ListenGraph 建连后会先发：

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
  "options": {
    "partials": true,
    "finals": true,
    "tokens": false,
    "timestamps": false
  }
}
```

你的 bridge 至少需要：

- 校验 `version`
- 校验 `audio.codec`
- 记录 session 上下文
- 在接受后返回 `session.started` 或 `status`

### 3.2 `audio.frame`

ListenGraph 会持续发：

```json
{
  "type": "audio.frame",
  "audio": {
    "codec": "pcm_s16le",
    "data": "<base64>",
    "samples": 640
  }
}
```

v1 下请直接按这条假设做：

- 单声道
- 16k
- `pcm_s16le`
- JSON + base64

不要在 bridge v1 首版里一上来做复杂二进制协商。

### 3.3 `audio.flush`

ListenGraph 在 fixture 播放结束或用户停止输入时可能发送：

```json
{
  "type": "audio.flush",
  "reason": "input_finished"
}
```

你的 bridge 应在收到后：

- 尽量做最后一次 decode
- 把残留文本作为 `transcript.final` 发出来
- 不要吞掉最后一段

## 4. 必需下行消息

### 4.1 `session.started`

推荐返回：

```json
{
  "type": "session.started",
  "version": "1",
  "session": {
    "sessionId": "session_123"
  },
  "bridge": {
    "name": "my-local-bridge",
    "engine": "whisper.cpp",
    "model": "base.en"
  }
}
```

这不是图谱链路的硬要求，但它能显著改善侧栏状态展示和排错。

### 4.2 `transcript.final`

这是唯一硬性结果消息。最少需要：

```json
{
  "type": "transcript.final",
  "utterance": {
    "utteranceId": "utt-1",
    "revision": 1,
    "text": "hello world",
    "startMs": 0,
    "endMs": 3200,
    "isFinal": true,
    "stability": "stable",
    "finalReason": "endpoint",
    "language": "en"
  }
}
```

字段最低要求：

- `type="transcript.final"`
- `utterance.utteranceId`
- `utterance.revision`
- `utterance.text`
- `utterance.startMs`
- `utterance.endMs`
- `utterance.isFinal=true`
- `utterance.stability="stable"`
- `utterance.finalReason`

### 4.3 `status`

推荐至少支持：

```json
{
  "type": "status",
  "status": "connected",
  "detail": "bridge ready"
}
```

常用状态：

- `connecting`
- `connected`
- `listening`
- `closing`
- `closed`

### 4.4 `error`

推荐格式：

```json
{
  "type": "error",
  "error": {
    "code": "ENGINE_INIT_FAILED",
    "message": "failed to load model"
  }
}
```

你至少应该保证：

- `code` 机器可判断
- `message` 人能看懂

## 5. ListenGraph 真正消费什么

这点很重要。ListenGraph 并不要求你长得像腾讯。

它内部真正关心的是：

- `partial`：只影响 UI 进度展示
- `final`：才进入 transcript / structurer / graph
- `status`：只影响状态展示
- `error`：只影响错误面板和 debug

所以如果你现在只想做 v1：

- 没有 partial 也可以
- 没有 token 时间戳也可以
- 没有 confidence 也可以

但你必须把 `final` 做稳。

## 6. 时间戳和分段要求

### 6.1 时间戳

如果底层模型不给精确时间戳：

- 可以用送入音频的累计时间近似估算

但必须满足：

- `endMs >= startMs`
- 同一会话内时间单调向前

### 6.2 分段

你的模型怎么断句是你的自由：

- endpoint detection
- 静音阈值
- 固定时长
- 自定义规则

ListenGraph 不要求所有 bridge 使用同一套断句算法。

ListenGraph 只要求：

- 发出来的 `final` 后续不要再改

## 7. 推荐默认值

如果你还没决定怎么选，建议先按这套默认值做：

- WebSocket endpoint: `ws://127.0.0.1:15377/ws`
- Health endpoint: `http://127.0.0.1:15377/healthz`
- Input audio: `pcm_s16le`
- Sample rate: `16000`
- Channels: `1`
- Frame duration: `40ms`
- Protocol version: `1`

## 8. v1 不要急着做的事

为了尽快形成稳定接入基线，建议你先不要做这些：

- 多 session 复用
- 二进制帧模式
- 动态模型切换
- 复杂鉴权协商
- token 级时间戳强依赖
- 说话人分离

这些都能以后再加，但不该阻塞第一版接入。

## 9. 接入完成后的验证方式

如果你已经有健康 bridge 在跑，直接用：

```powershell
pnpm run test:ext:e2e:real:local-bridge
```

这个命令会：

- 检查 `healthz`
- 让 extension 连接你的 bridge
- 跑完整的 `fixture -> ws -> final -> graph` headless 闭环

如果你实现的是 sherpa reference bridge，也可以用：

```powershell
pnpm run test:ext:e2e:real:sherpa
```

## 10. 最后判断标准

你不需要问“我的 bridge 像不像 sherpa reference bridge”。

你应该问的是：

1. ListenGraph 能不能连上它
2. 它能不能持续收音频帧
3. 它能不能稳定吐出 final
4. real E2E 能不能最终产 graph

如果这四件事都成立，那它就是一个合格的 ListenGraph Local ASR Bridge。
