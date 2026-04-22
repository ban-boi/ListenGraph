# Provider 文档导航

本文档用于区分：
- 当前 extension 正在使用或推荐的 provider 文档
- 仍有参考价值但不再代表当前默认实现的历史文档

## 当前有效

### 腾讯 ASR
- [腾讯 ASR 联调 Checklist](C:/Users/finni/Desktop/ListenGraph/docs/providers/tencent-asr-smoke.md)
  - 当前推荐入口
  - 面向 `tencent/direct + transport=ws`
- [腾讯云实时语音识别（WebSocket）开发笔记](C:/Users/finni/Desktop/ListenGraph/docs/%E8%85%BE%E8%AE%AF%E4%BA%91%E5%AE%9E%E6%97%B6%E8%AF%AD%E9%9F%B3%E8%AF%86%E5%88%AB-%E5%BC%80%E5%8F%91%E7%AC%94%E8%AE%B0.md)
  - 官方参数、返回格式、ListenGraph 项目内接入备注

### 本地 / 外部 ASR Bridge 设计
- [LG-ASR-WS v1 协议草案](C:/Users/finni/Desktop/ListenGraph/docs/providers/lg-asr-ws-v1.md)
  - ListenGraph 面向本地 / 外部流式 ASR 的统一 WebSocket 协议
  - 定义 `partial/final/status/error` 四类产品语义
- [Local ASR Bridge 最小接入规范](C:/Users/finni/Desktop/ListenGraph/docs/providers/local-asr-bridge-min-spec.md)
  - 面向第三方 bridge 作者的最小实现要求
  - 重点是“最少做到什么，ListenGraph 才能吃”
- [Local ASR Bridge 自检清单](C:/Users/finni/Desktop/ListenGraph/docs/providers/local-asr-bridge-self-checklist.md)
  - 面向接入前和分发前的快速核对单
  - 包含 `healthz`、`audio.flush`、`final` 与 real E2E 验证
- [本地 ASR / WS Bridge 接入改造清单](C:/Users/finni/Desktop/ListenGraph/docs/providers/local-asr-productization-plan.md)
  - 基于当前仓库结构的可执行改造计划
  - 包含 schema、extension、provider、测试与 sherpa reference bridge 的拆解
- [SherpaOnnx 流式 Paraformer ASR — 开发笔记](C:/Users/finni/Desktop/ListenGraph/docs/providers/sherpa-onnx-streaming-asr.md)
  - 当前本地流式 ASR 的验证记录
  - 作为 `Local ASR Bridge` 的首个参考后端背景材料
- [Local ASR Bridge 使用说明](C:/Users/finni/Desktop/ListenGraph/docs/providers/local-asr-bridge-setup.md)
  - 使用 `tools/sherpa-onnx-bridge.py` 启动本机 reference bridge 的最短路径
  - 对接 sidepanel 的 endpoint / protocol / auth token 配置
  - 文首已强调：**模型不在仓库内**；`pnpm run test:ext:e2e:real:sherpa` 的默认本机模型目录为 `<repo>/.tmp/sherpa-model/.../`，更多前提见同文档与 [Extension 测试入口](C:/Users/finni/Desktop/ListenGraph/docs/testing/README.md)
- [SherpaOnnx Reference Bridge README](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/README.md)
  - 面向分发和复用的 reference bridge 入口
  - 包含 Windows 启动模板和最短排错路径
- [SherpaOnnx Reference Bridge Quickstart](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/QUICKSTART.md)
  - 第一次给别人使用时最短的上手入口
  - 适合直接转发给本地测试用户
- [SherpaOnnx Reference Bridge Release Packaging](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/RELEASE.md)
  - 说明对外打 zip 时该包含哪些文件
  - 面向分发前整理
- [SherpaOnnx Reference Bridge Release Checklist](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/RELEASE-CHECKLIST.md)
  - 发出去前的最终核对单
  - 用来避免“我这能跑，别人那不行”

### Structurer Provider
- 当前 extension 默认 structurer provider：`aliyun`
- 当前权威行为说明不在单独 provider 文档，而在：
  - [扩展当前运行现状](C:/Users/finni/Desktop/ListenGraph/docs/extension/current-runtime.md)
  - [扩展 Structurer 运行时行为](C:/Users/finni/Desktop/ListenGraph/docs/extension/structurer-runtime.md)

## 历史参考

### 腾讯
- [腾讯云 ASR 开发文档](C:/Users/finni/Desktop/ListenGraph/docs/providers/tencent-asr.md)
  - 以录音文件识别 / batch 方案为主的历史整理
  - 仍可用于查 batch API、TC3 签名和老链路背景

### 智谱
- [智谱 GLM Structurer 开发文档](C:/Users/finni/Desktop/ListenGraph/docs/providers/zhipu-glm.md)
  - 历史主 provider 文档
  - 当前不再是 extension 默认 provider
- [Zhipu GLM-4.7-Flash 性能基准测试](C:/Users/finni/Desktop/ListenGraph/docs/providers/zhipu-glm-benchmark-2026-03-31.md)
  - 2026-03-31 的基准测试归档
  - 适合看当时的 reasoning/latency 结论，不应用作当前默认选型结论

### 百度
- [百度千帆 ERNIE-Speed 接入开发文档](C:/Users/finni/Desktop/ListenGraph/docs/baidu-qianfan-structurer.md)
  - 历史选型/接入记录
  - 当前百度 provider 仍可手动使用，但不是默认路径

## 当前推荐结论
- ASR：优先 `tencent/ws`
- Structurer：默认 `aliyun`
- 旧 provider 保留为手动 fallback / 对照，不做 runtime 自动切换

## 阅读建议
- 如果你是在改当前 extension 主链路：先读“当前有效”
- 如果你是在追历史决策、查旧实现背景：再读“历史参考”
