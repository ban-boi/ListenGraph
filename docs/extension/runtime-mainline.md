# 扩展运行时主链路基线

## 目的
本文定义当前 extension 的运行时主链路基线，用来消除实现、测试和文档之间的漂移。

## 当前主链路
当前唯一的主运行路径是：

`sidepanel -> service-worker -> content-script -> getDisplayMedia -> AudioWorklet -> service-worker -> sidepanel`

补充说明：
- `apps/extension/src/service-worker/index.ts` 是唯一活跃的 service worker 实现
- `apps/extension/src/content-script/content-script.ts` 是当前音频采集入口
- `offscreen` 和 `tabCapture` 仍保留在仓库里，但不属于当前生产主链路

## 运行时 ASR 路径
当前 ASR 同时存在两条输入路径：

1. `transport=batch`
- 保留原始批处理能力
- 适合 mock、debug、对照实验

2. `transport=ws`
- 腾讯 realtime WebSocket
- `service-worker` 负责签名和连接参数
- `content-script` 负责建连、推 PCM 帧、消费腾讯返回
- 只把 `slice_type=2` 的稳定句段送回主链路
- 当前 extension 默认 ASR transport

## 运行时 Structurer 路径
当前 structurer 运行时仍是：

`ASR transcript / utterance -> 转写窗口 -> structurer segment -> merge -> sidepanel`

说明：
- 上游输入不再只有旧的固定 `10s chunk`
- `batch` 更接近粗粒度 transcript
- `ws` 更接近稳定 utterance
- 在线路径优先按“transcript unit / stable utterance”理解，而不是按 `chunk` 理解
- 运行时仍保留 bootstrap / incremental 双模式

## 明确不属于当前主链路的内容
下列内容不应再被当作当前主运行路径：
- `tabCapture` 作为默认采集入口
- `offscreen` 作为当前音频处理宿主
- `apps/extension/public/service-worker.js` 作为运行时源文件

## 当前 provider 基线
- extension 默认 ASR provider：`tencent/direct + transport=ws`
- extension 默认 structurer provider：`aliyun`
- 旧 provider `zhipu/openai/baidu/mock` 仍保留为手动切换、对照和故障隔离
- 当前不做 runtime 内部自动 provider failover

## 相关文档
- [Structurer 运行时行为](C:\Users\finni\Desktop\ListenGraph\docs\extension\structurer-runtime.md)
- [扩展当前运行现状](C:\Users\finni\Desktop\ListenGraph\docs\extension\current-runtime.md)
- [Structure 回归说明](C:\Users\finni\Desktop\ListenGraph\docs\testing\structure-regression.md)
