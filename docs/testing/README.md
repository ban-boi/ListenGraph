# Extension 测试入口

本文档定义 extension 当前的三层测试结构，目的是减少“这个问题该补哪层”的歧义。

## 三层结构

### 1. Runtime Contract
验证运行时状态机、消息编排、持久化和异常恢复。

当前主入口：
```powershell
pnpm run test:ext:contract
```

实际执行：
- `apps/extension/src/service-worker/index.test.ts`

适合放这里的问题：
- 启动/停止状态流
- content script 注入与重试
- provider 配置进入 runtime
- export/debug/replay 资产契约
- 错误收敛与竞态处理

### 2. Scenario Replay
验证真实 transcript / utterance 输入后，结构化和 ASR 行为是否稳定。

当前主入口：
```powershell
pnpm run test:ext:replay
```

核心命令：
- `pnpm --filter extension test:structure`
- `pnpm --filter extension test:asr:real`

适合放这里的问题：
- structurer prompt / normalize / merge 质量
- fallback 行为
- 腾讯 realtime utterance 验收
- 新 transcript 风格回归

### 3. Thin E2E
验证少量高价值用户闭环，证明扩展真的可以被操作并跑通。

当前主入口：
```powershell
pnpm run test:ext:e2e
pnpm run test:ext:e2e:closure
```

当前覆盖：
- `apps/extension/e2e/extension.local.spec.ts`
- `apps/extension/e2e/extension.closure.spec.ts`
- `apps/extension/e2e/extension.real.spec.ts`

适合放这里的问题：
- 本地 fixture 驱动的完整 UI 闭环
- provider 错误可见性
- 会后 debug/export/replay 可达性
- 真实 provider 的薄验收

## 推荐执行顺序

### 日常开发
1. `pnpm run test:ext:contract`
2. `pnpm run test:ext:replay`
3. 如改到真实用户闭环，再跑 `pnpm run test:ext:e2e`

### 改错误处理或会后资产
1. `pnpm run test:ext:contract`
2. `pnpm run test:ext:e2e:closure`

### 改结构化质量
1. `pnpm run test:ext:replay`
2. 需要时补 strict real suite，不要优先扩 Playwright

## 当前原则
- 高频问题优先落 `Runtime Contract` 或 `Scenario Replay`
- `Thin E2E` 只保留少量闭环型场景
- 不把结构化质量细节搬进 Playwright
