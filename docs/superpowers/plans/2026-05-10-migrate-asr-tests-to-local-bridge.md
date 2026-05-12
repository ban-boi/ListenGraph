# ASR 测试从腾讯云迁移到本地 Bridge 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将消耗腾讯云额度的 ASR 测试迁移到本地 bridge（mock / sherpa-onnx），仅各保留一条腾讯连通性测试。

**Architecture:** 新建 `asr-local-bridge-helpers.ts` 实现 LG-ASR-WS v1 协议的 fixture runner；新建 `asr-realtime.local-bridge.test.ts` 承载全部 fixture 的测试；将现有两个腾讯测试各瘦身到 1 个 fixture、仅验证连通性。

**Tech Stack:** Vitest、WebSocket（Node 原生）、LG-ASR-WS v1 协议、mock-asr-bridge.mjs / sherpa-onnx-bridge.py

---

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 创建 | `apps/extension/src/service-worker/asr-local-bridge-helpers.ts` | 本地 bridge WS 连接、LG-ASR-WS v1 协议 fixture runner |
| 创建 | `apps/extension/src/service-worker/asr-realtime.local-bridge.test.ts` | 本地 bridge 全 fixture 管线测试 |
| 修改 | `apps/extension/src/service-worker/asr-realtime.real.test.ts` | 瘦身为 1 fixture 连通性测试 |
| 修改 | `apps/extension/src/service-worker/asr-transport-compare.real.test.ts` | 瘦身为 1 fixture 双通道连通性测试 |
| 创建 | `apps/extension/scripts/run-asr-local-bridge-test.mjs` | 自动启动 mock bridge → 跑测试 → 清理 |
| 修改 | `apps/extension/package.json` | 新增 `test:asr:local-bridge` 等脚本 |
| 修改 | `package.json`（根目录） | 新增对应的根级脚本 |

---

## Task 1: 创建本地 bridge 测试辅助模块

**Files:**
- 创建: `apps/extension/src/service-worker/asr-local-bridge-helpers.ts`

- [ ] **Step 1: 编写 `asr-local-bridge-helpers.ts`**

此模块实现 LG-ASR-WS v1 协议的 fixture runner。核心函数 `runLocalBridgeRealtimeFixture` 通过 WebSocket 连接本地 bridge，发送 `session.start` → 流式 `audio.frame`（base64 编码 PCM）→ `audio.flush` → `session.stop`，收集所有 `transcript.final` 事件。

```typescript
// apps/extension/src/service-worker/asr-local-bridge-helpers.ts
import {
  loadAsrRealtimeFixtures,
  readPcm16MonoWav,
  resolveAudioPath,
  normalizeText,
  looselyMatchesNormalizedText,
  type AsrRealtimeFixture,
} from './asr-real-fixture-helpers';

export type BridgeUtterance = {
  text: string;
  utteranceId: string;
  startMs: number;
  endMs: number;
  finalReason: string;
  confidence: number;
  language: string;
};

export type BridgeFixtureResult =
  | { utterances: BridgeUtterance[] }
  | { skipped: true; reason: string };

/**
 * 检查本地 bridge 是否可达（GET /healthz）
 */
export async function isBridgeHealthy(
  healthUrl = 'http://127.0.0.1:15377/healthz',
  timeoutMs = 3_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(healthUrl, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 通过 LG-ASR-WS v1 协议将 PCM 音频流式发送到本地 bridge，收集 transcript.final 事件。
 */
export async function runLocalBridgeRealtimeFixture(params: {
  endpoint: string;
  authToken?: string;
  pcmData: Uint8Array;
  frameBytes: number;
  frameDurationMs: number;
  timeoutMs: number;
}): Promise<BridgeFixtureResult> {
  if (typeof WebSocket === 'undefined') {
    throw new Error('当前运行时不支持 WebSocket');
  }

  const utterances: BridgeUtterance[] = [];

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(params.endpoint);
    const timeout = setTimeout(() => {
      safeClose(ws);
      reject(new Error(`本地 bridge 超时 (${params.timeoutMs}ms)`));
    }, params.timeoutMs);

    let finalized = false;

    const finish = (result: BridgeFixtureResult) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const fail = (error: Error) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timeout);
      reject(error);
    };

    ws.onopen = () => {
      const startMsg = {
        type: 'session.start',
        session: {
          sessionId: `test-${Date.now()}`,
          language: 'zh',
        },
      };
      ws.send(JSON.stringify(startMsg));
    };

    ws.onmessage = (event) => {
      let payload: any;
      try {
        payload = typeof event.data === 'string'
          ? JSON.parse(event.data)
          : JSON.parse(Buffer.from(event.data).toString('utf-8'));
      } catch {
        return;
      }

      switch (payload?.type) {
        case 'session.started':
          void streamAudioFrames(ws, params.pcmData, params.frameBytes, params.frameDurationMs)
            .then(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'audio.flush' }));
                setTimeout(() => {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'session.stop' }));
                  }
                }, 500);
              }
            })
            .catch(fail);
          break;

        case 'transcript.final': {
          const utt = payload.utterance;
          if (utt && utt.text?.trim()) {
            utterances.push({
              text: utt.text.trim(),
              utteranceId: utt.utteranceId ?? '',
              startMs: utt.startMs ?? 0,
              endMs: utt.endMs ?? 0,
              finalReason: utt.finalReason ?? '',
              confidence: utt.confidence ?? 0,
              language: utt.language ?? 'zh',
            });
          }
          break;
        }

        case 'error':
          fail(new Error(`Bridge error: ${payload.error?.message ?? JSON.stringify(payload.error)}`));
          safeClose(ws);
          break;

        case 'status':
          if (payload.status === 'closing') {
            finish({ utterances });
            safeClose(ws);
          }
          break;
      }
    };

    ws.onerror = () => {
      fail(new Error('本地 bridge WebSocket 连接失败'));
    };

    ws.onclose = () => {
      finish({ utterances });
    };
  });
}

async function streamAudioFrames(
  ws: WebSocket,
  pcmData: Uint8Array,
  frameBytes: number,
  frameDurationMs: number,
) {
  const framesPerBurst = 6;
  const targetSpeed = 2.5;
  let burstCount = 0;

  for (let offset = 0; offset < pcmData.length; offset += frameBytes) {
    if (ws.readyState !== WebSocket.OPEN) {
      throw new Error(`WebSocket 在流式发送中关闭 (readyState=${ws.readyState})`);
    }

    const frame = pcmData.subarray(offset, Math.min(offset + frameBytes, pcmData.length));
    const base64 = Buffer.from(frame).toString('base64');
    ws.send(JSON.stringify({
      type: 'audio.frame',
      audio: {
        data: base64,
        encoding: 'pcm_s16le',
        sampleRate: 16000,
        channels: 1,
      },
    }));

    burstCount++;
    if (burstCount >= framesPerBurst) {
      const burstAudioMs = framesPerBurst * frameDurationMs;
      const waitMs = Math.max(1, Math.ceil(burstAudioMs / targetSpeed));
      burstCount = 0;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

function safeClose(ws: WebSocket) {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close();
  }
}

export {
  loadAsrRealtimeFixtures,
  readPcm16MonoWav,
  resolveAudioPath,
  normalizeText,
  looselyMatchesNormalizedText,
  type AsrRealtimeFixture,
};
```

- [ ] **Step 2: 验证编译**

Run: `cd apps/extension && npx tsc --noEmit src/service-worker/asr-local-bridge-helpers.ts`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/service-worker/asr-local-bridge-helpers.ts
git commit -m "feat(ext-test): 添加本地 bridge ASR 测试辅助模块 (LG-ASR-WS v1)"
```

---

## Task 2: 创建本地 bridge ASR 实时测试

**Files:**
- 创建: `apps/extension/src/service-worker/asr-realtime.local-bridge.test.ts`

- [ ] **Step 1: 编写测试文件**

```typescript
// apps/extension/src/service-worker/asr-realtime.local-bridge.test.ts
// @vitest-environment node

import { describe, expect, test, beforeAll } from 'vitest';
import * as fs from 'fs';
import {
  isBridgeHealthy,
  runLocalBridgeRealtimeFixture,
  loadAsrRealtimeFixtures,
  readPcm16MonoWav,
  resolveAudioPath,
  normalizeText,
  looselyMatchesNormalizedText,
  type BridgeUtterance,
} from './asr-local-bridge-helpers';

const bridgeEndpoint = process.env.LISTEN_GRAPHIC_LOCAL_BRIDGE_ENDPOINT?.trim() || 'ws://127.0.0.1:15377/ws';
const bridgeHealthUrl = process.env.LISTEN_GRAPHIC_LOCAL_BRIDGE_HEALTH_URL?.trim() || 'http://127.0.0.1:15377/healthz';
const bridgeAuthToken = process.env.LISTEN_GRAPHIC_LOCAL_BRIDGE_AUTH_TOKEN?.trim() || undefined;
const requestedFixtureFilter = process.env.LISTEN_GRAPHIC_E2E_ASR_FIXTURE?.trim().toLowerCase();
const realtimeTimeoutMs = Number.parseInt(process.env.LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS?.trim() || '', 10);
const effectiveTimeoutMs = Number.isFinite(realtimeTimeoutMs) ? realtimeTimeoutMs : 90_000;

// 是否使用真实 ASR（sherpa-onnx）；mock bridge 时只做管线检查
const isRealAsr = process.env.LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR?.trim() === '1';

let bridgeAvailable = false;

beforeAll(async () => {
  bridgeAvailable = await isBridgeHealthy(bridgeHealthUrl);
});

describe.skipIf(() => !bridgeAvailable)('ASR 本地 bridge fixture 测试', () => {
  const fixtures = loadAsrRealtimeFixtures(requestedFixtureFilter);

  for (const fixture of fixtures) {
    test(
      fixture.name,
      { timeout: effectiveTimeoutMs + 30_000 },
      async () => {
        const audioPath = resolveAudioPath(fixture.name, fixture.audioFile);
        const wavBytes = fs.readFileSync(audioPath);
        const pcmPayload = readPcm16MonoWav(wavBytes, fixture.audioClipDurationMs);

        const result = await runLocalBridgeRealtimeFixture({
          endpoint: bridgeEndpoint,
          authToken: bridgeAuthToken,
          pcmData: pcmPayload.data,
          frameBytes: Math.max(1, Math.round((pcmPayload.sampleRate * 2 * 40) / 1000)),
          frameDurationMs: 40,
          timeoutMs: effectiveTimeoutMs,
        });

        if ('skipped' in result) {
          console.warn(result.reason);
          return;
        }

        // 管线级别断言：至少收到 1 条 final transcript
        expect(
          result.utterances.length,
          `${fixture.name} 应至少返回 1 条 final transcript`,
        ).toBeGreaterThanOrEqual(1);

        const totalText = result.utterances.map((u) => u.text).join('');
        expect(totalText.length, `${fixture.name} transcript 总文本长度应 > 0`).toBeGreaterThan(0);

        // 仅在真实 ASR 模式下做文本匹配断言
        if (isRealAsr) {
          assertFixtureAccuracy(fixture, result.utterances);
        }
      },
    );
  }
});

function assertFixtureAccuracy(
  fixture: import('./asr-local-bridge-helpers').AsrRealtimeFixture,
  utterances: BridgeUtterance[],
) {
  const normalizedTexts = utterances.map((u) => normalizeText(u.text));

  for (const expected of fixture.acceptance.mustContainTexts ?? []) {
    const norm = normalizeText(expected);
    const matched = normalizedTexts.some((t) => looselyMatchesNormalizedText(t, norm));
    expect(matched, `${fixture.name} 应包含 "${expected}"`).toBe(true);
  }

  for (const group of fixture.acceptance.mustContainOneOfTexts ?? []) {
    const matched = group.some((cand) => {
      const norm = normalizeText(cand);
      return normalizedTexts.some((t) => looselyMatchesNormalizedText(t, norm));
    });
    expect(matched, `${fixture.name} 应包含 [${group.join('/')}] 之一`).toBe(true);
  }
}
```

- [ ] **Step 2: 用 mock bridge 验证测试可发现并运行**

启动 mock bridge：
```bash
node tools/mock-asr-bridge.mjs &
```

Run: `cd apps/extension && npx vitest run src/service-worker/asr-realtime.local-bridge.test.ts`
Expected: mock bridge 返回固定文本，至少 1 条 final transcript，管线断言通过

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/service-worker/asr-realtime.local-bridge.test.ts
git commit -m "feat(ext-test): 添加本地 bridge ASR 全 fixture 管线测试"
```

---

## Task 3: 瘦身腾讯实时 ASR 测试为连通性检查

**Files:**
- 修改: `apps/extension/src/service-worker/asr-realtime.real.test.ts`

- [ ] **Step 1: 重写文件为单 fixture 连通性测试**

改动要点：
1. 只取第一个 fixture（`fixtures[0]`），不再遍历全部
2. 断言从准确度匹配简化为：至少 1 条 utterance 且文本非空
3. describe 块重命名为 `'Tencent 实时 ASR 连通性检查'`
4. 删除 `assertFixtureAcceptance` 函数

```typescript
// apps/extension/src/service-worker/asr-realtime.real.test.ts
// @vitest-environment node

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import {
  createTencentRealtimeConfigFromEnv,
  loadAsrRealtimeFixtures,
  readPcm16MonoWav,
  resolveAudioPath,
  runTencentRealtimeFixture,
  normalizeText,
} from './asr-real-fixture-helpers';

const canRunRealAsr = Boolean(
  process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_APP_ID?.trim() &&
    process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_ID?.trim() &&
    process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_KEY?.trim(),
);
const describeReal = canRunRealAsr ? describe : describe.skip;

const realtimeTimeoutMs = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS?.trim() || '',
  10,
);
const effectiveRealtimeTimeoutMs = Number.isFinite(realtimeTimeoutMs) ? realtimeTimeoutMs : 90_000;
const allowExternalIssueSkip =
  process.env.LISTEN_GRAPHIC_E2E_ASR_ALLOW_EXTERNAL_SKIP?.trim() === '1';

describeReal('Tencent 实时 ASR 连通性检查', () => {
  const allFixtures = loadAsrRealtimeFixtures();
  const fixture = allFixtures[0];

  test(
    fixture ? `${fixture.name} (connectivity)` : 'no fixtures available',
    { timeout: effectiveRealtimeTimeoutMs + 30_000 },
    async () => {
      if (!fixture) return;

      const audioPath = resolveAudioPath(fixture.name, fixture.audioFile);
      const wavBytes = fs.readFileSync(audioPath);
      const pcmPayload = readPcm16MonoWav(wavBytes, fixture.audioClipDurationMs);
      const config = await createTencentRealtimeConfigFromEnv();

      const result = await runTencentRealtimeFixture({
        config,
        pcmData: pcmPayload.data,
        frameBytes: Math.max(1, Math.round((pcmPayload.sampleRate * 2 * 40) / 1000)),
        frameDurationMs: 40,
        timeoutMs: effectiveRealtimeTimeoutMs,
        allowExternalIssueSkip,
      });

      if ('skippedDueToExternalIssue' in result) {
        console.warn(result.reason);
        return;
      }

      expect(result.utterances.length).toBeGreaterThanOrEqual(1);
      const totalText = result.utterances.map((u) => u.text).join('');
      expect(normalizeText(totalText).length).toBeGreaterThan(0);
    },
  );
});
```

- [ ] **Step 2: 验证编译**

Run: `cd apps/extension && npx tsc --noEmit src/service-worker/asr-realtime.real.test.ts`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/service-worker/asr-realtime.real.test.ts
git commit -m "refactor(ext-test): 腾讯实时 ASR 测试瘦身至单 fixture 连通性检查"
```

---

## Task 4: 瘦身腾讯传输对比测试为双通道连通性检查

**Files:**
- 修改: `apps/extension/src/service-worker/asr-transport-compare.real.test.ts`

- [ ] **Step 1: 重写文件为单 fixture 双通道连通性测试**

改动要点：
1. 只取第一个 fixture
2. 断言简化为：realtime 和 batch 都返回非空结果
3. describe 重命名为 `'Tencent ASR 双通道连通性检查'`
4. 删除 artifact 写入、`summarizeRealtime`/`summarizeBatch`/`cleanBatchTranscriptText`/`toOwnedArrayBuffer` 等辅助函数

```typescript
// apps/extension/src/service-worker/asr-transport-compare.real.test.ts
// @vitest-environment node

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import { TencentAsrProvider } from '@listen-graphic/providers';
import { encodePcm16AsWav } from '../shared/audio';
import {
  createTencentBatchConfigFromEnv,
  createTencentRealtimeConfigFromEnv,
  loadAsrRealtimeFixtures,
  readPcm16MonoWav,
  resolveAudioPath,
  runTencentRealtimeFixture,
  sanitizeFileName,
} from './asr-real-fixture-helpers';

const canRunRealAsr = Boolean(
  process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_APP_ID?.trim() &&
    process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_ID?.trim() &&
    process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_KEY?.trim(),
);
const describeReal = canRunRealAsr ? describe : describe.skip;

const realtimeTimeoutMs = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS?.trim() || '',
  10,
);
const effectiveRealtimeTimeoutMs = Number.isFinite(realtimeTimeoutMs) ? realtimeTimeoutMs : 90_000;
const batchChunkMs = 10_000;
const allowExternalIssueSkip =
  process.env.LISTEN_GRAPHIC_E2E_ASR_ALLOW_EXTERNAL_SKIP?.trim() === '1';

describeReal('Tencent ASR 双通道连通性检查', () => {
  const allFixtures = loadAsrRealtimeFixtures();
  const fixture = allFixtures[0];

  test(
    fixture ? `${fixture.name} (connectivity)` : 'no fixtures available',
    { timeout: 5 * 60_000 },
    async () => {
      if (!fixture) return;

      const audioPath = resolveAudioPath(fixture.name, fixture.audioFile);
      const wavBytes = fs.readFileSync(audioPath);
      const pcmPayload = readPcm16MonoWav(wavBytes, fixture.audioClipDurationMs);

      // 验证实时 WebSocket 通道
      const realtimeConfig = await createTencentRealtimeConfigFromEnv();
      const realtimeResult = await runTencentRealtimeFixture({
        config: realtimeConfig,
        pcmData: pcmPayload.data,
        frameBytes: Math.max(1, Math.round((pcmPayload.sampleRate * 2 * 40) / 1000)),
        frameDurationMs: 40,
        timeoutMs: effectiveRealtimeTimeoutMs,
        allowExternalIssueSkip,
      });

      if (!('skippedDueToExternalIssue' in realtimeResult)) {
        expect(
          realtimeResult.utterances.length,
          '实时 ASR 应至少返回 1 条识别结果',
        ).toBeGreaterThan(0);
      }

      // 验证批量 HTTP 通道（录音文件转文字）
      const batchConfig = await createTencentBatchConfigFromEnv();
      const provider = new TencentAsrProvider(batchConfig);
      try {
        const chunkByteLength = Math.max(
          2,
          Math.floor((pcmPayload.sampleRate * 2 * batchChunkMs) / 1000 / 2) * 2,
        );
        const chunkBytes = pcmPayload.data.subarray(0, Math.min(chunkByteLength, pcmPayload.data.length));
        const pcm16 = new Int16Array(
          chunkBytes.buffer.slice(chunkBytes.byteOffset, chunkBytes.byteOffset + chunkBytes.byteLength),
        );
        const wavForBatch = encodePcm16AsWav(pcm16, { sampleRate: pcmPayload.sampleRate, channels: 1 });
        const wavBuffer = new Uint8Array(wavForBatch);
        const copy = new Uint8Array(wavBuffer.byteLength);
        copy.set(wavBuffer);

        const transcript = await provider.transcribeChunk({
          sessionId: `connectivity_${sanitizeFileName(fixture.name)}`,
          audio: new Blob([copy.buffer], { type: 'audio/wav' }),
          startMs: 0,
          endMs: batchChunkMs,
          language: 'zh',
        });

        expect(
          transcript.text.trim().length,
          '批量 ASR 应返回非空文本',
        ).toBeGreaterThan(0);
      } finally {
        provider.reset?.();
      }
    },
  );
});
```

- [ ] **Step 2: 验证编译**

Run: `cd apps/extension && npx tsc --noEmit src/service-worker/asr-transport-compare.real.test.ts`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/service-worker/asr-transport-compare.real.test.ts
git commit -m "refactor(ext-test): 腾讯 ASR 传输对比瘦身至单 fixture 双通道连通性检查"
```

---

## Task 5: 创建自动启动 mock bridge 的测试运行脚本

**Files:**
- 创建: `apps/extension/scripts/run-asr-local-bridge-test.mjs`

- [ ] **Step 1: 编写脚本**

参考 `run-e2e-real-local-bridge.mjs` 模式：自动启动 mock bridge → 跑测试 → 清理。

```javascript
// apps/extension/scripts/run-asr-local-bridge-test.mjs
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
  throw new Error(`Mock bridge 在 ${timeoutMs}ms 内未就绪`);
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

  console.log(`[asr-local-bridge-test] 启动 mock bridge: ws://${bridgeHost}:${bridgePort}/ws`);

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

  await waitForBridge();
  console.log('[asr-local-bridge-test] mock bridge 就绪');

  const testEnv = {
    ...env,
    LISTEN_GRAPHIC_LOCAL_BRIDGE_ENDPOINT: `ws://${bridgeHost}:${bridgePort}/ws`,
    LISTEN_GRAPHIC_LOCAL_BRIDGE_HEALTH_URL: `http://${bridgeHost}:${bridgePort}/healthz`,
  };

  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args = process.platform === 'win32'
    ? ['/c', 'pnpm', 'exec', 'vitest', 'run', 'src/service-worker/asr-realtime.local-bridge.test.ts']
    : ['exec', 'vitest', 'run', 'src/service-worker/asr-realtime.local-bridge.test.ts'];

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
  process.exit(Number(exitCode));
}

main().catch((err) => {
  terminate(bridgeProcess);
  console.error(`[asr-local-bridge-test] 失败: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: 验证脚本可执行**

Run: `cd apps/extension && node scripts/run-asr-local-bridge-test.mjs`
Expected: mock bridge 启动 → 测试运行 → 管线断言通过

- [ ] **Step 3: Commit**

```bash
git add apps/extension/scripts/run-asr-local-bridge-test.mjs
git commit -m "feat(ext-test): 添加自动启动 mock bridge 的 ASR 本地测试脚本"
```

---

## Task 6: 更新 package.json 脚本

**Files:**
- 修改: `apps/extension/package.json`
- 修改: `package.json`（根目录）

- [ ] **Step 1: 在 `apps/extension/package.json` 的 scripts 中新增两行**

在 `"test:asr:compare"` 行后插入：

```json
"test:asr:local-bridge": "vitest run src/service-worker/asr-realtime.local-bridge.test.ts",
"test:asr:local-bridge:mock": "node ./scripts/run-asr-local-bridge-test.mjs",
```

- [ ] **Step 2: 在根目录 `package.json` 的 scripts 中新增两行**

在 `test:ext:e2e:real:sherpa` 行后插入：

```json
"test:ext:asr:local-bridge": "pnpm --filter extension test:asr:local-bridge",
"test:ext:asr:local-bridge:mock": "pnpm --filter extension test:asr:local-bridge:mock",
```

- [ ] **Step 3: Commit**

```bash
git add apps/extension/package.json package.json
git commit -m "feat: 添加 ASR 本地 bridge 测试脚本命令"
```

---

## 验证清单

- [ ] `pnpm test:ext:asr:local-bridge:mock` — mock bridge 自动启动 + 全 fixture 管线测试通过
- [ ] `pnpm test:ext:asr:local-bridge` — 连接已有 bridge（mock 或 sherpa）+ 全 fixture 测试通过
- [ ] `pnpm --filter extension test:asr:real` — 腾讯实时连通性（1 fixture）
- [ ] `pnpm --filter extension test:asr:compare` — 腾讯双通道连通性（1 fixture）
- [ ] `pnpm --filter extension test:run` — 所有单元测试（含 mock ASR）仍通过
- [ ] `pnpm typecheck` — 类型检查无错误
