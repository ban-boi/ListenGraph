# 扩展真实 Provider 阶段

## 目的
本文记录「provider 化」落地之后、真实 provider 阶段的执行基线。
目标是让实现、测试以及当前 **direct（直连）** 范围与扩展当前主链路保持一致。

## 权威来源
- 扩展主链路：`docs/plans/2026-03-21-extension-execution-baseline.md`
- 当前结构化增量设计：`docs/plans/2026-03-31-extension-structurer-incremental-design.md`
- 工程设计：`doc/更工程化的技术设计文档.md`
- 产品/阶段参考：`doc/重构版 design 文档 v2.md`

## 已落地内容
- `packages/schema/src/provider.ts`
  - 增加 `ProviderConfig`、重试策略、运行时摘要、可序列化的 provider 错误。
- `packages/providers/src/*`
  - 增加配置归一化、provider 注册表、重试辅助，以及首批真实适配器：
    - `OpenAIAsrProvider`
    - `OpenAIStructurerProvider`
- `packages/storage/src/*`
  - 增加 `settings` 存储与 `createSettingsRepository()`，用于持久化 provider 配置与清除密钥。
- `apps/extension/src/service-worker/index.ts`
  - 用「由配置驱动的 provider 运行时加载」取代原先硬编码的顶层 mock 构造。
  - 增加 provider 设置相关消息：
    - `GET_PROVIDER_SETTINGS`
    - `SAVE_PROVIDER_SETTINGS`
    - `CLEAR_PROVIDER_SECRETS`
  - 在运行时/调试侧暴露 provider 摘要与最近一次 provider 错误。
  - 在主路径上对「瞬时 IndexedDB backing-store 失败」做有界重试与降级。
- `apps/extension/src/sidepanel/App.tsx`
  - 在侧栏增加 provider 设置 UI。
  - 增加仅保存在本地的密钥的保存/清除流程。

## 当前 Provider 策略：
- 默认本地配置仍为 `mock + mock`。
- 真实 provider 路径为 `openai + openai`。
- 当前产品面仅支持 **direct** 访问模式：
  - 用户提供的 API Key 或腾讯云直连凭据，仅存于本地存储
  - `relay` 仍保留在 schema / provider 合约中，作为预留的后续路径；**当前不在范围内**，且不在设置 UI 中暴露
- 业务代码仍依赖 provider **合约**，而非各厂商专用 SDK。

## 主链路规则
活跃的扩展数据路径仍为：

`sidepanel -> service-worker -> content-script -> getDisplayMedia -> AudioWorklet -> service-worker -> sidepanel`

本阶段**不会**把 `tabCapture` 或 `offscreen` 恢复为生产执行宿主。

## 设置与密钥规则
- Provider 设置通过 `packages/storage` 写入扩展本地 IndexedDB。
- 密钥**绝不**写入同步存储。
- Sidepanel 提供：
  - provider 类型
  - endpoint（端点）
  - model（模型）
  - API key
  - 腾讯云 `secretId` / `secretKey`
  - language（语言）
- 专用「清除密钥」操作会移除 `apiKey`、`sessionToken`、`secretId`、`secretKey`，其余配置保留。
- 若历史存储里仍含 `relay`，当前 UI/运行时会在加载/保存时将其归一为 `direct`。

## 测试基线
测试现分为三层：

1. 单元与集成
- Provider 配置归一化与注册表契约
- 真实适配器的请求/响应映射
- 重试策略与 provider 错误向上传播
- Service worker：provider 加载、运行时重新补水、存储降级处理
- Sidepanel 设置交互

2. 确定性浏览器 E2E
- 基于构建产物的 sidepanel + 有状态运行时 mock，现已覆盖：
  - provider 设置保存
  - `AUDIO_CHUNK_READY` 流程
  - 图谱渲染
  - 刷新恢复
  - 调试面中的 provider 摘要

3. 真实扩展持久化 E2E
- 既有 Playwright 扩展测试仍验证：
  - 运行时/存储资产读取
  - 扩展重启
  - IndexedDB 降级恢复

## 真实 Provider 冒烟指引
推荐使用用户提供真实密钥时的手工冒烟路径：

1. 使用 `pnpm --filter extension build` 构建扩展
2. 将 `apps/extension/dist` 作为解压扩展加载
3. 打开 sidepanel 并保存真实的 ASR / 结构化配置
4. 在真实标签页上开始采集会话
5. 确认：
   - 出现转写日志
   - 出现图谱节点
   - 调试面板显示 provider 摘要
   - 会话结束后导出仍可用

## 已知约束
Chromium 下的 Playwright 运行仍可能间歇性遇到扩展 IndexedDB backing-store 失败。
当前代码在主路径上将此类失败视为**瞬时**问题：
- 先对持久化重试
- 若 backing-store 仍不可用，则保留内存中的图/运行时
- 对非 backing-store 异常的普通存储错误仍**硬失败**

## 下一步
下一档自然增量是 **direct 模式加固**，而非先上托管 relay：
- 保持 `ProviderConfig` 与未来 relay 工作兼容，但当前 UI 不暴露 relay
- 完成对 `mock`、`openai`、`tencent` 等 provider 组合的 direct 模式冒烟验证
- 让文档与验收检查与当前「仅 direct」产品面一致
