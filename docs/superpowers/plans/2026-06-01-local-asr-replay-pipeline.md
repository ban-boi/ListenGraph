# 真实 ASR → Structure Replay Fixture Pipeline 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立"真实音频 → 本地 ASR → raw utterance artifact → structure replay fixture scaffold"的完整 pipeline，用真实 ASR 分割分布补充现有结构化质量验收集。

**Architecture:** 复用现有本地 bridge 测试基础设施（`asr-local-bridge-helpers.ts` 的 LG-ASR-WS v1 协议），扩展 `asr-realtime.local-bridge.test.ts` 使其支持 artifact 写入；新建 scaffold 生成脚本将 artifact 转为带弱 acceptance 的 replay fixture。两层数据分离：`artifacts/local_*.utterances.json`（ASR 原始输出，不手改）+ `structure/replay-local-*.json`（acceptance 人工维护）。

**Tech Stack:** Node.js ESM (.mjs)、Vitest、WebSocket (LG-ASR-WS v1)、现有 fixture 体系

---

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `apps/extension/src/service-worker/asr-local-bridge-helpers.ts` | 新增 `writeLocalBridgeUtteranceArtifact()` 函数 |
| 修改 | `apps/extension/src/service-worker/asr-realtime.local-bridge.test.ts` | 测试完成后可选写入 local artifact |
| 创建 | `apps/extension/scripts/run-local-asr-for-artifacts.mjs` | 编排脚本：启动/检测 bridge → 跑 ASR → 写 artifact |
| 创建 | `apps/extension/scripts/prepare-local-replay-fixtures.mjs` | 从 local artifact 生成 replay fixture scaffold |
| 修改 | `apps/extension/package.json` | 新增 `prepare:asr:local`、`prepare:structure:local-replay` 脚本 |
| 修改 | `package.json`（根目录） | 新增 `pnpm prepare:asr:local`、`pnpm prepare:structure:local-replay` |

---

### Task 1: 在 `asr-local-bridge-helpers.ts` 中新增 artifact 写入函数

**Files:**
- 修改: `apps/extension/src/service-worker/asr-local-bridge-helpers.ts`

**背景：** 现有 `writeRealtimeUtteranceArtifact()` 保存的是 Tencent `StableUtterance` 格式。本地 bridge 使用 `BridgeUtterance` 格式（有 `utteranceId`/`finalReason`/`confidence`/`language`，没有 `voiceId`/`messageId`）。需要新增一个独立的写入函数，用 `local_` 前缀区分文件名，并在 artifact JSON 中标记 `source: "local-asr"`。

- [ ] **Step 1: 在 `asr-local-bridge-helpers.ts` 末尾（`export { ... }` 块之前）添加 `writeLocalBridgeUtteranceArtifact` 函数**

在 `safeClose` 函数之后、`export { ... }` 块之前插入：

```typescript
/**
 * 将本地 bridge ASR 的 utterance 结果写入 artifact 文件。
 * 文件名用 local_ 前缀与 Tencent artifact 区分。
 */
export function writeLocalBridgeUtteranceArtifact(
  fixture: AsrRealtimeFixture,
  utterances: BridgeUtterance[],
  bridgeEndpoint: string,
): void {
  fs.mkdirSync(ASR_ARTIFACT_DIR, { recursive: true });
  const artifactPath = path.join(
    ASR_ARTIFACT_DIR,
    `local_${sanitizeFileName(fixture.name)}.utterances.json`,
  );
  fs.writeFileSync(
    artifactPath,
    `${JSON.stringify(
      {
        fixtureName: fixture.name,
        audioFile: fixture.audioFile,
        audioClipDurationMs: fixture.audioClipDurationMs ?? null,
        source: 'local-asr',
        bridgeEndpoint,
        recordedAt: new Date().toISOString(),
        utterances,
      },
      null,
      2,
    )}\n`,
  );
}
```

注意：`asr-local-bridge-helpers.ts` 已经从 `asr-real-fixture-helpers.ts` 重导出了 `ASR_ARTIFACT_DIR` 所需的路径常量，但需要确认 `ASR_ARTIFACT_DIR` 是否被重导出。

- [ ] **Step 2: 在 `asr-local-bridge-helpers.ts` 中补充必要的 import**

在文件顶部 import 区域确认或添加 `ASR_ARTIFACT_DIR` 的导入。当前 import 为：

```typescript
import {
  loadAsrRealtimeFixtures,
  readPcm16MonoWav,
  resolveAudioPath,
  normalizeText,
  looselyMatchesNormalizedText,
  type AsrRealtimeFixture,
} from './asr-real-fixture-helpers';
```

需要追加 `ASR_ARTIFACT_DIR` 和 `sanitizeFileName`：

```typescript
import {
  loadAsrRealtimeFixtures,
  readPcm16MonoWav,
  resolveAudioPath,
  normalizeText,
  looselyMatchesNormalizedText,
  ASR_ARTIFACT_DIR,
  sanitizeFileName,
  type AsrRealtimeFixture,
} from './asr-real-fixture-helpers';
```

同时添加 `fs` 和 `path` 导入（如果文件中还没有）：

```typescript
import * as fs from 'fs';
import * as path from 'path';
```

- [ ] **Step 3: 确认 `asr-real-fixture-helpers.ts` 导出了 `ASR_ARTIFACT_DIR` 和 `sanitizeFileName`**

读取 `asr-real-fixture-helpers.ts`，确认以下两个标识符已被 export：
- `ASR_ARTIFACT_DIR`（第 54 行已有 `export const`）
- `sanitizeFileName`（搜索确认是否有 `export`）

如果 `sanitizeFileName` 没有 export，在该函数声明前添加 `export`。

- [ ] **Step 4: 在 `export { ... }` 块中追加新的导出**

更新文件末尾的 re-export 块，添加新函数：

```typescript
export {
  loadAsrRealtimeFixtures,
  readPcm16MonoWav,
  resolveAudioPath,
  normalizeText,
  looselyMatchesNormalizedText,
  writeLocalBridgeUtteranceArtifact,
  type AsrRealtimeFixture,
};
```

- [ ] **Step 5: 运行 TypeScript 检查**

Run: `pnpm --filter extension typecheck`

Expected: 无新增错误

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/service-worker/asr-local-bridge-helpers.ts
git commit -m "feat(asr): add writeLocalBridgeUtteranceArtifact helper"
```

---

### Task 2: 修改本地 bridge 测试以支持 artifact 写入

**Files:**
- 修改: `apps/extension/src/service-worker/asr-realtime.local-bridge.test.ts`

**背景：** 现有测试在 `bridgeAvailable` 时运行 fixture，收集 `BridgeUtterance[]`，但从不写 artifact。需要添加一个环境变量 `LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS`，当设置为 `1` 时，每个 fixture 成功后将 utterances 写入 `artifacts/local_*.utterances.json`。

- [ ] **Step 1: 在 `asr-realtime.local-bridge.test.ts` 顶部添加 artifact 写入环境变量**

在现有环境变量读取区域（第 17-25 行附近）追加：

```typescript
const shouldWriteArtifacts = process.env.LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS?.trim() === '1';
```

- [ ] **Step 2: 在 import 中添加 `writeLocalBridgeUtteranceArtifact`**

将第 7-15 行的 import 修改为：

```typescript
import {
  isBridgeHealthy,
  runLocalBridgeRealtimeFixture,
  writeLocalBridgeUtteranceArtifact,
  loadAsrRealtimeFixtures,
  readPcm16MonoWav,
  resolveAudioPath,
  normalizeText,
  looselyMatchesNormalizedText,
  type BridgeUtterance,
} from './asr-local-bridge-helpers';
```

- [ ] **Step 3: 在测试函数中添加 artifact 写入逻辑**

在 test body 中，`if (isRealAsr)` 块之后（约第 76 行），添加 artifact 写入：

```typescript
        // 仅在真实 ASR 模式下做文本匹配断言
        if (isRealAsr) {
          assertFixtureAccuracy(fixture, result.utterances);
        }

        // 可选：将 utterances 写入 artifact 文件
        if (shouldWriteArtifacts && !('skipped' in result)) {
          writeLocalBridgeUtteranceArtifact(fixture, result.utterances, bridgeEndpoint);
        }
```

- [ ] **Step 4: 运行 TypeScript 检查**

Run: `pnpm --filter extension typecheck`

Expected: 无新增错误

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/service-worker/asr-realtime.local-bridge.test.ts
git commit -m "feat(asr): support artifact writing in local bridge test"
```

---

### Task 3: 创建 `run-local-asr-for-artifacts.mjs` 编排脚本

**Files:**
- 创建: `apps/extension/scripts/run-local-asr-for-artifacts.mjs`

**背景：** 类似 `run-asr-local-bridge-test.mjs`，但设置 `LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS=1` 使测试写出 artifacts。脚本需要：
1. 启动或检测本地 bridge（sherpa-onnx）
2. 运行本地 bridge 测试并开启 artifact 写入
3. 汇报结果

- [ ] **Step 1: 创建脚本文件**

```javascript
// apps/extension/scripts/run-local-asr-for-artifacts.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..', '..');

const DEFAULT_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_BRIDGE_PORT = 15377;
const mockBridgeScript = path.join(repoRoot, 'tools', 'mock-asr-bridge.mjs');

const env = { ...process.env };
const bridgeHost = env.LISTEN_GRAPHIC_LOCAL_BRIDGE_HOST?.trim() || DEFAULT_BRIDGE_HOST;
const bridgePort = Number.parseInt(
  env.LISTEN_GRAPHIC_LOCAL_BRIDGE_PORT?.trim() || String(DEFAULT_BRIDGE_PORT),
  10,
);
const useRealAsr = env.LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR?.trim() === '1';
const fixtureFilter = env.LISTEN_GRAPHIC_E2E_ASR_FIXTURE?.trim() || undefined;

let bridgeProcess = null;
let testProcess = null;
let shuttingDown = false;

function terminate(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch { /* noop */ }
}

async function waitForBridge(timeoutMs = 5_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${bridgeHost}:${bridgePort}/healthz`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`ASR bridge 在 ${timeoutMs}ms 内未就绪 (${bridgeHost}:${bridgePort})`);
}

function installSignalHandlers() {
  const handle = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    terminate(testProcess);
    terminate(bridgeProcess);
    process.exitCode = 1;
  };
  process.on('SIGINT', handle);
  process.on('SIGTERM', handle);
}

async function main() {
  installSignalHandlers();

  // 如果不是真实 ASR 模式，启动 mock bridge
  if (!useRealAsr) {
    console.log(`[local-asr-artifacts] 启动 mock bridge: ws://${bridgeHost}:${bridgePort}/ws`);
    bridgeProcess = spawn('node', [mockBridgeScript], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...env,
        LISTEN_GRAPHIC_MOCK_BRIDGE_HOST: bridgeHost,
        LISTEN_GRAPHIC_MOCK_BRIDGE_PORT: String(bridgePort),
      },
      shell: false,
    });
  }

  await waitForBridge();
  console.log(`[local-asr-artifacts] bridge 就绪 (${useRealAsr ? 'real/sherpa' : 'mock'})`);

  const testEnv = {
    ...env,
    LISTEN_GRAPHIC_LOCAL_BRIDGE_ENDPOINT: `ws://${bridgeHost}:${bridgePort}/ws`,
    LISTEN_GRAPHIC_LOCAL_BRIDGE_HEALTH_URL: `http://${bridgeHost}:${bridgePort}/healthz`,
    LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS: '1',
  };

  if (useRealAsr) {
    testEnv.LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR = '1';
  }

  const vitestFilter = fixtureFilter ? `src/service-worker/asr-realtime.local-bridge.test.ts -t ${fixtureFilter}` : 'src/service-worker/asr-realtime.local-bridge.test.ts';

  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args = process.platform === 'win32'
    ? ['/c', 'pnpm', 'exec', 'vitest', 'run', ...vitestFilter.split(' ')]
    : ['exec', 'vitest', 'run', ...vitestFilter.split(' ')];

  testProcess = spawn(command, args, {
    cwd: extensionRoot,
    stdio: 'inherit',
    env: testEnv,
    shell: false,
  });

  const exitCode = await new Promise((resolve) => {
    testProcess.on('exit', (code) => resolve(code ?? 1));
    testProcess.on('error', () => resolve(1));
  });

  terminate(bridgeProcess);

  if (exitCode === 0) {
    console.log('[local-asr-artifacts] artifacts 写入完成');
    console.log(`  目录: src/service-worker/fixtures/asr-realtime/artifacts/local_*.utterances.json`);
  }

  process.exit(Number(exitCode));
}

main().catch((err) => {
  terminate(bridgeProcess);
  console.error(`[local-asr-artifacts] 失败: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: 用 mock bridge 验证脚本可运行**

Run: `node apps/extension/scripts/run-local-asr-for-artifacts.mjs`

Expected: mock bridge 启动 → 测试运行 → artifacts 写入到 `artifacts/local_*.utterances.json`

验证 artifacts 已生成：

Run: `dir apps\extension\src\service-worker\fixtures\asr-realtime\artifacts\local_*`

Expected: 看到 4 个 `local_generated_*.utterances.json` 文件

- [ ] **Step 3: 检查一个 artifact 文件的格式**

读取任意一个 `local_*.utterances.json`，确认结构：
```json
{
  "fixtureName": "generated:...",
  "audioFile": "audio/generated/...",
  "audioClipDurationMs": 120000,
  "source": "local-asr",
  "bridgeEndpoint": "ws://127.0.0.1:15377/ws",
  "recordedAt": "2026-06-...",
  "utterances": [
    {
      "text": "...",
      "utteranceId": "...",
      "startMs": 0,
      "endMs": 0,
      "finalReason": "...",
      "confidence": 0,
      "language": "zh"
    }
  ]
}
```

mock bridge 场景下 utterances 可能有内容或为空（取决于 mock 行为），这是正常的。关键是 `source: "local-asr"` 和 `local_` 前缀。

- [ ] **Step 4: Commit**

```bash
git add apps/extension/scripts/run-local-asr-for-artifacts.mjs
git commit -m "feat(scripts): add run-local-asr-for-artifacts orchestration script"
```

---

### Task 4: 创建 `prepare-local-replay-fixtures.mjs` scaffold 生成脚本

**Files:**
- 创建: `apps/extension/scripts/prepare-local-replay-fixtures.mjs`

**背景：** 此脚本读取 `artifacts/local_*.utterances.json`，将每个 artifact 转换为 structure replay fixture scaffold。关键设计决策：
- **source 标记**：`raw.source = "local-asr-replay"`
- **弱 acceptance**：`allowFallback: true`、保守的 `minMergedNodes`、从 utterance 文本自动提取的 `mustContainOneOfTexts`
- **人工校准标记**：`manualReviewTags: ["needs-acceptance-calibration", "local-asr-source"]`
- **不覆盖已有文件**：默认保留已校准的 fixture（除非 `--force`）

- [ ] **Step 1: 创建脚本文件**

```javascript
// apps/extension/scripts/prepare-local-replay-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const asrFixtureDir = path.resolve(packageRoot, 'src', 'service-worker', 'fixtures', 'asr-realtime');
const artifactDir = path.resolve(asrFixtureDir, 'artifacts');
const structureFixtureDir = path.resolve(packageRoot, 'src', 'service-worker', 'fixtures', 'structure');

main();

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(artifactDir)) {
    throw new Error(`Artifact 目录不存在: ${artifactDir}。先运行 run-local-asr-for-artifacts.mjs。`);
  }

  fs.mkdirSync(structureFixtureDir, { recursive: true });

  const localArtifacts = fs
    .readdirSync(artifactDir)
    .filter((name) => name.startsWith('local_') && name.endsWith('.utterances.json'))
    .sort()
    .map((name) => ({
      fileName: name,
      path: path.join(artifactDir, name),
      raw: JSON.parse(fs.readFileSync(path.join(artifactDir, name), 'utf-8')),
    }));

  if (localArtifacts.length === 0) {
    throw new Error('未找到 local artifact (local_*.utterances.json)。先运行 run-local-asr-for-artifacts.mjs。');
  }

  const summary = [];
  for (const entry of localArtifacts) {
    const artifact = entry.raw;
    const replayName = buildReplayName(artifact.fixtureName);

    if (options.filter && !replayName.toLowerCase().includes(options.filter)) {
      continue;
    }

    const utterances = Array.isArray(artifact.utterances) ? artifact.utterances : [];
    if (utterances.length === 0) {
      console.warn(`跳过 ${artifact.fixtureName}: 无 utterances`);
      continue;
    }

    const structureFixture = {
      name: replayName,
      transcripts: utterances.map((utt, index) => ({
        chunkId: `${sanitizeFileName(replayName)}_${String(index + 1).padStart(2, '0')}`,
        text: utt.text,
        startMs: utt.startMs,
        endMs: utt.endMs,
        raw: {
          source: 'local-asr-replay',
          artifactFixtureName: artifact.fixtureName,
          utteranceId: utt.utteranceId ?? '',
          confidence: utt.confidence ?? 0,
          finalReason: utt.finalReason ?? '',
        },
      })),
      acceptance: buildWeakAcceptance(utterances),
    };

    const outputPath = path.join(structureFixtureDir, `${replayName}.json`);
    if (options.force || !fs.existsSync(outputPath)) {
      fs.writeFileSync(outputPath, `${JSON.stringify(structureFixture, null, 2)}\n`);
    }

    summary.push({
      replayName,
      outputPath,
      utteranceCount: utterances.length,
      preserved: !options.force && fs.existsSync(outputPath),
    });
  }

  console.log(`生成了 ${summary.length} 个 structure replay fixture scaffold。`);
  for (const item of summary) {
    console.log(`- ${item.replayName}`);
    console.log(`  文件: ${path.relative(packageRoot, item.outputPath)}`);
    console.log(`  utterances: ${item.utteranceCount}`);
    if (item.preserved) {
      console.log(`  状态: 已保留已有文件（用 --force 覆盖）`);
    }
    console.log(`  ⚠️  acceptance 需要人工校准`);
  }
}

/**
 * 从 fixture name 生成 replay fixture name。
 * "generated:1_信息密集型_罗翔十一学校讲座" → "replay-local-1-信息密集型-罗翔十一学校讲座"
 */
function buildReplayName(fixtureName) {
  const raw = fixtureName.replace(/^generated:/, '');
  const safe = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/_+/g, '-');
  return `replay-local-${safe}`;
}

/**
 * 生成弱 acceptance scaffold。
 * 保守估计，标记需要人工校准。
 */
function buildWeakAcceptance(utterances) {
  const totalText = utterances.map((u) => u.text).join('');
  const weakAnchors = extractWeakAnchors(totalText);

  const acceptance = {
    minSegments: 1,
    minMergedNodes: Math.max(2, Math.ceil(utterances.length * 0.5)),
    minMergedEdges: 0,
    allowFallback: true,
    manualReviewTags: ['needs-acceptance-calibration', 'local-asr-source'],
  };

  if (weakAnchors.length > 0) {
    acceptance.mustContainOneOfTexts = weakAnchors.map((anchor) => [anchor]);
  }

  return acceptance;
}

/**
 * 从 utterance 文本中提取弱锚点短语。
 * 策略：按中文标点分句，选长度 6-16 字符、含中文的片段，取前 3 个。
 */
function extractWeakAnchors(totalText, maxCount = 3) {
  const sentences = totalText
    .split(/[。！？；\n\r]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && s.length <= 16)
    .filter((s) => /[\p{Script=Han}]/u.test(s));

  const unique = [];
  const seen = new Set();
  for (const s of sentences) {
    const normalized = s.replace(/[\s，、,.]/gu, '');
    if (normalized.length < 4 || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
    if (unique.length >= maxCount) break;
  }

  return unique;
}

function parseArgs(argv) {
  const options = { force: false, help: false, filter: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    switch (cur) {
      case '--force':
        options.force = true;
        break;
      case '--filter':
        options.filter = requireValue(argv, ++i, '--filter').trim().toLowerCase();
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`未知参数: ${cur}`);
    }
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} 需要一个值`);
  return value;
}

function printHelp() {
  console.log(`从本地 ASR artifact 生成 structure replay fixture scaffold。

用法:
  node scripts/prepare-local-replay-fixtures.mjs [选项]

选项:
  --filter <text>   只生成名称包含此文本的 fixture
  --force           覆盖已有的 replay fixture
  --help            显示此帮助

前提:
  先运行 node scripts/run-local-asr-for-artifacts.mjs 生成 local artifact。

输出:
  src/service-worker/fixtures/structure/replay-local-*.json

注意:
  acceptance 是弱 scaffold，必须人工校准后才能作为回归门槛。
  查看 manualReviewTags 包含 "needs-acceptance-calibration" 的 fixture。
`);
}

function sanitizeFileName(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}
```

- [ ] **Step 2: 用 Task 3 生成的 artifact 验证脚本**

Run: `node apps/extension/scripts/prepare-local-replay-fixtures.mjs`

Expected: 输出类似：
```
生成了 4 个 structure replay fixture scaffold。
- replay-local-1-信息密集型-罗翔十一学校讲座
  文件: src/service-worker/fixtures/structure/replay-local-1-信息密集型-罗翔十一学校讲座.json
  utterances: N
  ⚠️  acceptance 需要人工校准
...
```

- [ ] **Step 3: 检查一个生成的 scaffold 文件**

读取 `structure/replay-local-*.json`，确认：
- `name` 格式为 `replay-local-...`
- `transcripts[].raw.source` 为 `"local-asr-replay"`
- `acceptance` 包含 `manualReviewTags: ["needs-acceptance-calibration", "local-asr-source"]`
- `acceptance.allowFallback` 为 `true`
- `acceptance.mustContainOneOfTexts` 包含弱锚点（如果 utterance 文本足够长）

- [ ] **Step 4: 验证 scaffold 能被 structure 测试加载**

Run: `LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE="replay-local-" pnpm --filter extension test:structure:real`

Expected: 测试能加载并尝试运行（可能因没有真实 structurer key 而跳过或失败，但不应有 fixture 加载错误）

- [ ] **Step 5: Commit**

```bash
git add apps/extension/scripts/prepare-local-replay-fixtures.mjs
git commit -m "feat(scripts): add prepare-local-replay-fixtures scaffold generator"
```

---

### Task 5: 在 `package.json` 中注册新脚本

**Files:**
- 修改: `apps/extension/package.json`
- 修改: `package.json`（根目录）

- [ ] **Step 1: 在 `apps/extension/package.json` 的 `scripts` 中添加**

在 `prepare:structure:replay` 行之后添加：

```json
    "prepare:asr:local": "node ./scripts/run-local-asr-for-artifacts.mjs",
    "prepare:structure:local-replay": "node ./scripts/prepare-local-replay-fixtures.mjs",
```

- [ ] **Step 2: 在根 `package.json` 的 `scripts` 中添加对应入口**

查找现有的 `prepare:asr:real` 和 `prepare:structure:replay` 对应的根级脚本位置，在其后添加：

```json
    "prepare:asr:local": "pnpm --filter extension prepare:asr:local",
    "prepare:structure:local-replay": "pnpm --filter extension prepare:structure:local-replay",
```

- [ ] **Step 3: 验证脚本可从根目录调用**

Run: `pnpm prepare:asr:local --help`

Expected: 输出 run-local-asr-for-artifacts.mjs 的帮助信息（或直接运行 mock bridge 测试）

Run: `pnpm prepare:structure:local-replay --help`

Expected: 输出 prepare-local-replay-fixtures.mjs 的帮助信息

- [ ] **Step 4: Commit**

```bash
git add apps/extension/package.json package.json
git commit -m "chore: register local ASR artifact and replay scaffold scripts"
```

---

### Task 6: 端到端验证与真实 ASR 运行指南

**Files:**
- 无代码修改，纯验证步骤

**背景：** 用 mock bridge 验证完整 pipeline 后，记录用真实 sherpa-onnx bridge 运行的步骤。这是最终用户（你）手动执行的部分。

- [ ] **Step 1: 用 mock bridge 跑完整 pipeline 验证**

```bash
# 1. 生成 local ASR artifacts（使用 mock bridge）
pnpm prepare:asr:local

# 2. 从 artifacts 生成 replay fixture scaffold
pnpm prepare:structure:local-replay

# 3. 确认文件已生成
ls apps/extension/src/service-worker/fixtures/asr-realtime/artifacts/local_*
ls apps/extension/src/service-worker/fixtures/structure/replay-local-*
```

Expected: 两层数据文件都存在

- [ ] **Step 2: 确认 artifact 的 source 标记正确**

读取任意 `local_*.utterances.json`，确认 `"source": "local-asr"`。

读取任意 `replay-local-*.json`，确认 `transcripts[].raw.source` 为 `"local-asr-replay"`。

- [ ] **Step 3: 人工校准 acceptance（手动步骤）**

对每个 `replay-local-*.json`，需要人工完成：

1. **阅读 transcripts 文本**，理解内容
2. **设置核心语义锚点**：`mustContainOneOfTexts` 中每组放同义表达（如 `["法治", "法律", "法学"]`）
3. **收紧节点数范围**：`minMergedNodes` 设为合理下限，添加 `maxMergedNodes` 防止过度拆分
4. **添加关系要求**：`requiredEdgeTypes` 标注必须出现的大类关系
5. **添加幻觉防护**：`forbiddenTexts` 列出不应出现在该主题中的词
6. **移除** `manualReviewTags` 中的 `"needs-acceptance-calibration"`（表示已校准）
7. **调整** `allowFallback`：如果对这段内容结构化不应 fallback，设为 `false`

示例：校准前 → 校准后：

```json
// 校准前（scaffold）
{
  "acceptance": {
    "minSegments": 1,
    "minMergedNodes": 2,
    "minMergedEdges": 0,
    "allowFallback": true,
    "mustContainOneOfTexts": [["法治信念"], ["最古老学科"], ["医学"]],
    "manualReviewTags": ["needs-acceptance-calibration", "local-asr-source"]
  }
}

// 校准后（人工维护）
{
  "acceptance": {
    "minSegments": 1,
    "minMergedNodes": 3,
    "maxMergedNodes": 8,
    "minMergedEdges": 1,
    "allowFallback": false,
    "maxFallbackRuns": 0,
    "mustContainOneOfTexts": [
      ["法治", "法律", "法学"],
      ["最古老", "学科"],
      ["医学"],
      ["信念", "法治信念"]
    ],
    "mustHaveNodeTypes": ["claim"],
    "requiredEdgeTypes": ["supports"],
    "forbiddenTexts": ["股票", "天气"],
    "manualReviewTags": ["local-asr-source", "calibrated"]
  }
}
```

- [ ] **Step 4: 真实 sherpa-onnx bridge 运行（手动步骤）**

当有 sherpa-onnx bridge 可用时：

```bash
# 设置真实 ASR 环境变量
set LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR=1
set LISTEN_GRAPHIC_LOCAL_BRIDGE_ENDPOINT=ws://127.0.0.1:<port>/ws
set LISTEN_GRAPHIC_LOCAL_BRIDGE_HEALTH_URL=http://127.0.0.1:<port>/healthz

# 运行真实 ASR 并写 artifacts
pnpm prepare:asr:local

# 重新生成 scaffold（--force 覆盖 mock 数据）
pnpm prepare:structure:local-replay --force
```

然后用 Task 6 Step 3 的流程人工校准 acceptance。

---

## Self-Review

### 1. Spec 覆盖检查

| 需求 | 对应 Task |
|------|-----------|
| 准备真实音频文件 | 复用现有 `audio/generated/*.wav`，无需额外准备 |
| 用本地 ASR 跑出 utterance 数据 | Task 2（测试支持）+ Task 3（编排脚本） |
| 保留 ASR 原始句子/时间戳/置信度 | Task 1（artifact 格式保留全部 BridgeUtterance 字段） |
| 转成 structure replay fixture | Task 4（scaffold 生成脚本） |
| 人工补充 acceptance | Task 6 Step 3（人工校准指南） |
| `artifacts/local_*.utterances.json` 不手改 | Task 1（`local_` 前缀 + `source: "local-asr"`） |
| `structure/replay-local-*.json` acceptance 人工维护 | Task 4（默认不覆盖 `--force`） |
| source 标清楚 | Task 1 + Task 4（`local-asr` / `local-asr-replay`） |
| 弱 anchor 自动生成 | Task 4（`extractWeakAnchors` + `buildWeakAcceptance`） |
| package.json 脚本注册 | Task 5 |

### 2. Placeholder 扫描

无 TBD / TODO / "implement later" / "add validation" 等。所有代码步骤都包含完整实现。

### 3. 类型一致性

- `BridgeUtterance` 类型定义在 `asr-local-bridge-helpers.ts` 第 11-19 行，所有引用一致
- `StructureFixture` 类型在 `structure-focused.real.test.ts` 第 13-40 行定义
- `writeLocalBridgeUtteranceArtifact` 签名中 `AsrRealtimeFixture` 和 `BridgeUtterance[]` 与实际使用处一致
- `sanitizeFileName` 在多个文件中有相同实现（非导出函数，各自定义）
- artifact JSON 的 `source` 字段：Task 1 写 `"local-asr"`，Task 4 读并标记为 `"local-asr-replay"`，不冲突
