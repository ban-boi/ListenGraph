# ListenGraph 文档导航

本文档用于帮助快速判断：
- 现在应该先读哪一份
- 哪些文档描述的是当前有效实现
- 哪些文档只是历史背景、对照资料或选型归档

## 当前有效

### 运行时现状与关键决策
- [扩展运行时主链路基线](C:/Users/finni/Desktop/ListenGraph/docs/extension/runtime-mainline.md)
  - 当前 extension 运行时主链路
  - 哪些路径是主线，哪些只是保留/历史路径
- [扩展当前运行现状](C:/Users/finni/Desktop/ListenGraph/docs/extension/current-runtime.md)
  - 当前 ASR / provider / replay 的运行现状
  - 当前推荐执行顺序

### ASR 联调与回归
- [腾讯 ASR 联调 Checklist](C:/Users/finni/Desktop/ListenGraph/docs/providers/tencent-asr-smoke.md)
  - 当前推荐的腾讯 realtime WS 联调入口
- [腾讯云实时语音识别（WebSocket）开发笔记](C:/Users/finni/Desktop/ListenGraph/docs/%E8%85%BE%E8%AE%AF%E4%BA%91%E5%AE%9E%E6%97%B6%E8%AF%AD%E9%9F%B3%E8%AF%86%E5%88%AB-%E5%BC%80%E5%8F%91%E7%AC%94%E8%AE%B0.md)
  - 腾讯 realtime 官方能力与项目内接入备注
- [ASR Realtime Fixtures README](C:/Users/finni/Desktop/ListenGraph/apps/extension/src/service-worker/fixtures/asr-realtime/README.md)
  - 真实音频 fixture、prepare/replay/strict gate 工作流

### Structurer 行为与回归
- [扩展 Structurer 运行时行为](C:/Users/finni/Desktop/ListenGraph/docs/extension/structurer-runtime.md)
  - 当前 structurer 窗口、bootstrap、prompt 合约、归一化和调试语义
- [Structure 回归说明](C:/Users/finni/Desktop/ListenGraph/docs/testing/structure-regression.md)
  - 当前 structure-focused fixture 体系
  - smoke / full / strict real suite 入口

### Provider 目录
- [Provider 文档导航](C:/Users/finni/Desktop/ListenGraph/docs/providers/README.md)
  - 当前推荐 provider
  - 历史 provider 参考
  - 各文档状态说明

## 建议阅读顺序

### 想理解“现在到底怎么跑”
1. [runtime-mainline.md](C:/Users/finni/Desktop/ListenGraph/docs/extension/runtime-mainline.md)
2. [current-runtime.md](C:/Users/finni/Desktop/ListenGraph/docs/extension/current-runtime.md)
3. [docs/providers/README.md](C:/Users/finni/Desktop/ListenGraph/docs/providers/README.md)

### 想联调腾讯 realtime ASR
1. [tencent-asr-smoke.md](C:/Users/finni/Desktop/ListenGraph/docs/providers/tencent-asr-smoke.md)
2. [腾讯云实时语音识别-开发笔记.md](C:/Users/finni/Desktop/ListenGraph/docs/%E8%85%BE%E8%AE%AF%E4%BA%91%E5%AE%9E%E6%97%B6%E8%AF%AD%E9%9F%B3%E8%AF%86%E5%88%AB-%E5%BC%80%E5%8F%91%E7%AC%94%E8%AE%B0.md)
3. [fixtures/asr-realtime/README.md](C:/Users/finni/Desktop/ListenGraph/apps/extension/src/service-worker/fixtures/asr-realtime/README.md)

### 想看真实结构化回归怎么跑
1. [structure-regression.md](C:/Users/finni/Desktop/ListenGraph/docs/testing/structure-regression.md)
2. [structurer-runtime.md](C:/Users/finni/Desktop/ListenGraph/docs/extension/structurer-runtime.md)
3. `pnpm --filter extension test:structure`
4. 如需全量真实验收：
`pnpm --filter extension test:structure:real:full:part1`
`pnpm --filter extension test:structure:real:full:part2`

## 历史参考

下面这些文档仍有价值，但不应当作“当前实现权威说明”：
- `docs/providers/tencent-asr.md`
- `docs/providers/zhipu-glm.md`
- `docs/providers/zhipu-glm-benchmark-2026-03-31.md`
- `docs/baidu-qianfan-structurer.md`
- `docs/plans/2026-03-20-extension-audio-pipeline-fix.md`
- `docs/plans/2026-03-21-extension-execution-baseline.md`
- `docs/plans/2026-03-23-extension-real-provider-phase.md`

阅读这类文档前，先确认其顶部状态说明。
