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
