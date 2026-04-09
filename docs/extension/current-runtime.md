# 扩展当前运行现状

## 目的
本文记录 extension 当前的运行现状与关键执行结论，重点是：
- ASR / realtime WS 现状
- provider 选择现状
- replay 在当前体系里的位置

## 当前状态摘要
- 腾讯 ASR 主链路已经从“只支持 10s batch 轮询”扩展为“`batch + realtime ws` 并存”
- extension 运行时默认 ASR 已切到 `tencent/ws`
- structurer 默认 provider 已切到 `aliyun`
- `zhipu/openai/baidu` 仍保留为手动 fallback / 对照 provider

## 当前 ASR 现状
当前 ASR 有两条有效路径：

1. `batch`
- 仍然保留
- 更适合对照和调试

2. `ws`
- 腾讯 realtime WebSocket
- 当前默认且更接近真实生产形态

当前实现上的关键点：
- 只消费 `slice_type=2` 的稳定句段驱动下游 structurer
- 中间结果不直接推动图更新
- 在线 structurer 现在以“stable utterance / transcript unit”作为主语义，不再把实时路径描述成固定 `10s chunk`

## replay 在当前体系里的位置
replay 仍有价值，但当前语义要重新理解：
- 它更适合验证“真实 ASR 产出的 utterance 输入 structurer 后会发生什么”
- 它不再等同于当前高频主回归

当前建议：
- 日常调 structure，先跑 `test:structure`
- 需要看真实 utterance 输入，再跑 replay

## provider 当前结论
这轮已经确认：
- 阿里云在当前 strict real suite 上比此前的智谱更稳定
- 之前智谱的 `429/1302` 与 timeout 问题，不应被简单理解成“代码并发”
- “本地 timeout 后立刻发下一条”确实是部分 `1302` 的重要诱因之一，但不是唯一原因

当前因此采用：
- extension 默认 structurer：`aliyun`
- 保留旧 provider 手动切换
- 不做自动 failover

## 当前最推荐的阅读与执行顺序
1. 先看 [扩展运行时主链路基线](C:\Users\finni\Desktop\ListenGraph\docs\extension\runtime-mainline.md)
2. 再看 [Structurer 运行时行为](C:\Users\finni\Desktop\ListenGraph\docs\extension\structurer-runtime.md)
3. 需要结构化回归时看 [Structure 回归说明](C:\Users\finni\Desktop\ListenGraph\docs\testing\structure-regression.md)
