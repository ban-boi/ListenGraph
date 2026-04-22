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
- [扩展增量图稳定性](C:/Users/finni/Desktop/ListenGraph/docs/extension/incremental-graph-stability.md)
  - session 内图为何表现为“持续长出”而非每次重算
  - 当前 view / fitView / 布局缓存 / 语义冻结的产品决策
- [扩展增量相机跟随](C:/Users/finni/Desktop/ListenGraph/docs/extension/incremental-camera-follow.md)
  - 图增量更新后 viewport 为什么会自动聚焦
  - 当前目标区域、多段自动导览、双阈值分段、动画跟随与用户冷却期的产品决策

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
- [Extension 测试入口](C:/Users/finni/Desktop/ListenGraph/docs/testing/README.md)
  - 当前三层测试结构
  - contract / replay / thin E2E 推荐入口
  - **本仓库不附带**本地 Sherpa/ONNX 模型；`test:ext:e2e:real:sherpa` 的默认本机模型路径与 `LISTEN_GRAPHIC_SHERPA_*` 等前提见文内「本仓库与本地 ASR 模型」一节（避免误以为克隆即可跑真实 ASR）
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
3. [incremental-graph-stability.md](C:/Users/finni/Desktop/ListenGraph/docs/extension/incremental-graph-stability.md)
4. [incremental-camera-follow.md](C:/Users/finni/Desktop/ListenGraph/docs/extension/incremental-camera-follow.md)
5. [docs/providers/README.md](C:/Users/finni/Desktop/ListenGraph/docs/providers/README.md)

### 想联调腾讯 realtime ASR
1. [tencent-asr-smoke.md](C:/Users/finni/Desktop/ListenGraph/docs/providers/tencent-asr-smoke.md)
2. [腾讯云实时语音识别-开发笔记.md](C:/Users/finni/Desktop/ListenGraph/docs/%E8%85%BE%E8%AE%AF%E4%BA%91%E5%AE%9E%E6%97%B6%E8%AF%AD%E9%9F%B3%E8%AF%86%E5%88%AB-%E5%BC%80%E5%8F%91%E7%AC%94%E8%AE%B0.md)
3. [fixtures/asr-realtime/README.md](C:/Users/finni/Desktop/ListenGraph/apps/extension/src/service-worker/fixtures/asr-realtime/README.md)

### 想看真实结构化回归怎么跑
1. [docs/testing/README.md](C:/Users/finni/Desktop/ListenGraph/docs/testing/README.md)
2. [structure-regression.md](C:/Users/finni/Desktop/ListenGraph/docs/testing/structure-regression.md)
3. [structurer-runtime.md](C:/Users/finni/Desktop/ListenGraph/docs/extension/structurer-runtime.md)
4. `pnpm run test:ext:replay`
5. 如需全量真实验收：
`pnpm --filter extension test:structure:real:full:part1`
`pnpm --filter extension test:structure:real:full:part2`

## 历史参考

> **注意**：`docs/plans/` 下以日期时间戳开头的文档（如 `2026-03-20-*.md`）是 **Cursor 的 plan 模式自动生成的**，非人工编写，仅供参考。

下面这些文档仍有价值，但不应当作”当前实现权威说明”：
- `docs/providers/tencent-asr.md`
- `docs/providers/zhipu-glm.md`
- `docs/providers/zhipu-glm-benchmark-2026-03-31.md`
- `docs/baidu-qianfan-structurer.md`
- `docs/plans/2026-03-20-extension-audio-pipeline-fix.md`
- `docs/plans/2026-03-21-extension-execution-baseline.md`
- `docs/plans/2026-03-23-extension-real-provider-phase.md`

阅读这类文档前，先确认其顶部状态说明。
