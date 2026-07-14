# Extension 测试入口

本文档定义 extension 当前的三层测试结构，目的是减少“这个问题该补哪层”的歧义。

**图谱排版 / revision 序列 fixture（DEV 控制台、Vitest、web-demo 预览）** 见 [graph-layout-fixtures.md](./graph-layout-fixtures.md)。

## 本仓库与本地 ASR 模型（避免误解）

- **本仓库不附带** Sherpa/ONNX 权重、词表等二进制资产；**克隆/拉代码后不会自动拥有**可跑本地流式 ASR 所需的文件。
- **`pnpm run test:ext:e2e:real:sherpa`** 由 `apps/extension/scripts/run-e2e-real-sherpa.mjs` 驱动。脚本默认在**仓库根目录**下寻找模型目录（可用 `LISTEN_GRAPHIC_SHERPA_MODEL_DIR` 覆盖）：

  - 默认路径：`<repoRoot>/.tmp/sherpa-model/sherpa-onnx-streaming-paraformer-bilingual-zh-en/`
  - 该目录下须存在：`encoder.int8.onnx`、`decoder.int8.onnx`、`tokens.txt`（与 bridge 启动参数一致）。

  `.tmp/` 已列入根目录 `.gitignore`，只作本机/CI 自准备目录，**不会**随仓库分发给他人。

- **Python**：脚本里有一份**本机开发机示例**的默认解释器路径；在其它机器上应设置 `LISTEN_GRAPHIC_SHERPA_PYTHON` 为已 `pip install sherpa-onnx` 的 `python` 可执行文件路径，否则会报找不到解释器或无法 import。
- 模型从何处下载、如何解压、推荐 int8 文件名，见 [SherpaOnnx 流式 Paraformer ASR — 开发笔记](../providers/sherpa-onnx-streaming-asr.md) 中「环境搭建 / 下载模型」一节；手工起 bridge 与联调见 [Local ASR Bridge 使用说明](../providers/local-asr-bridge-setup.md)。

## 三层结构

### 1. Runtime Contract
验证运行时状态机、消息编排、持久化和异常恢复。

当前主入口：
```powershell
pnpm run test:ext:contract
```

实际执行（`apps/extension/package.json` 的 `test:contract`，12 个测试文件 / ~101 用例）：
- `provider-contract.test.ts`、`provider-registry.test.ts`、`provider-recovery.test.ts`：provider 配置进入 runtime、契约与异常恢复
- `session-lifecycle.test.ts`、`realtime-asr.test.ts`：启动/停止状态流、ASR 编排
- `storage-contract.test.ts`、`state-persistence.test.ts`：持久化与并发
- `assembler.test.ts`、`assembler-flight-recorder.test.ts`、`audio-processing.test.ts`：音频处理、结构化与 assembler 契约
- `export-debug-replay.test.ts`、`export-formatters.test.ts`：export/debug/replay 资产契约

> 历史：曾有一个聚合文件 `src/service-worker/index.test.ts`，后按 `docs/superpowers/plans/2026-05-08-large-file-decomposition.md` 拆分为上述 12 个文件。老的 `vitest run src/service-worker/index.test.ts` 入口在拆分后失效，已在 2026-07 修复为指向真实文件集合。

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
- **本地 ASR → LLM Judge acceptance 校准**（见 [llm-judge-acceptance-calibration.md](./llm-judge-acceptance-calibration.md)）

### 本地 ASR → Acceptance 校准 Pipeline（第 3 层工具，非回归硬门）

从真实音频出发，通过 LLM-as-Judge 批量生成 acceptance 草稿。**这套 acceptance 是模型特异的**（编码了产生它的参考模型的输出分布），**不该当跨模型回归硬门**——用更弱的模型/端侧模型跑会大面积红，但那是模型能力差异不是代码回归。它的价值在第 3 层：assembler 效果检验 + 同模型代码回归。详见 [llm-judge-acceptance-calibration.md](./llm-judge-acceptance-calibration.md)。

两层定位（见 [structure-regression.md](./structure-regression.md)）：第 1 层确定性契约（模型无关，CI 硬门）+ 第 3 层质量断言（模型特异，默认 soft 不阻塞）。

```powershell
# 1. 分段（确定性，无 AI）
pnpm segment:asr:local

# 2. 生成 segment fixture（弱 scaffold）
pnpm prepare:structure:local-replay -- --segments

# 3. 跑 structurer 对比（with/without assembler）— 产双图
$env:LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE = "openai"
$env:LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY = "sk-..."
pnpm compare:structure:segments

# 4. LLM Judge（blind comparison + rubric 评分 + 草稿生成）
$env:LISTEN_GRAPHIC_JUDGE_PROVIDER = "opencode-serve"  # 或 openai
pnpm judge:acceptance

# 5. 草稿落地到 fixture（acceptance 标 promotedFrom，清 weak_scaffold）
node apps/extension/scripts/promote-judgment-to-fixture.mjs

# 6. assembler 效果报告（第 3 层产出，不进 CI）
pnpm --filter extension eval:assembler
```

### 3. Thin E2E
验证少量高价值用户闭环，证明扩展真的可以被操作并跑通。

当前主入口：
```powershell
pnpm run test:ext:real-fixture:check
pnpm run test:ext:e2e
pnpm run test:ext:e2e:closure
pnpm run test:ext:e2e:real:local-bridge
pnpm run test:ext:e2e:real:sherpa
```

当前覆盖：
- `apps/extension/e2e/extension.local.spec.ts`
- `apps/extension/e2e/extension.closure.spec.ts`
- `apps/extension/e2e/extension.real.spec.ts`
- `apps/extension/e2e/fixtures/fixture-manifest.json`
- `apps/extension/e2e/fixtures/README.md`

真实 E2E fixture 静态基线检查：
- `pnpm run test:ext:real-fixture:check`
- 检查 real fixture manifest、音频文件存在性、WAV 格式、chunk 时长与 acceptance 元数据
- 这一步不验证 ASR 语义，但能防止“把 fixture 基线资产改坏了还没发现”

真实本地 ASR bridge 的便捷入口：
- `pnpm run test:ext:e2e:real:local-bridge`
- 只要求某个符合 `lg-asr-ws-v1` 的本地 bridge 已经启动并可访问
- 默认会检查：
- `ws://127.0.0.1:15377/ws`
- `http://127.0.0.1:15377/healthz`
- 默认仍使用 `mock structurer`，避免真实 structurer 配额/网络污染 E2E 结果

Sherpa 专用便捷入口：
- `pnpm run test:ext:e2e:real:sherpa`
- 默认启动 `tools/sherpa-onnx-bridge.py`，并把 extension real E2E 需要的 env 一并注入
- 可通过环境变量覆盖：
- `LISTEN_GRAPHIC_SHERPA_PYTHON`
- `LISTEN_GRAPHIC_SHERPA_MODEL_DIR`
- `LISTEN_GRAPHIC_SHERPA_BRIDGE_SCRIPT`
- `LISTEN_GRAPHIC_SHERPA_BRIDGE_HOST`
- `LISTEN_GRAPHIC_SHERPA_BRIDGE_PORT`
- `LISTEN_GRAPHIC_E2E_REAL_FIXTURE_ROOT`
- `LISTEN_GRAPHIC_E2E_REAL_TIMEOUT_MS`
- `LISTEN_GRAPHIC_E2E_REAL_STRUCTURER_TYPE`
- `LISTEN_GRAPHIC_E2E_REAL_STRUCTURER_MODEL`
- `LISTEN_GRAPHIC_SHERPA_REUSE_EXISTING`
- `LISTEN_GRAPHIC_LOCAL_BRIDGE_HOST`
- `LISTEN_GRAPHIC_LOCAL_BRIDGE_PORT`
- `LISTEN_GRAPHIC_LOCAL_BRIDGE_PATH`
- `LISTEN_GRAPHIC_LOCAL_BRIDGE_HEALTH_URL`

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
