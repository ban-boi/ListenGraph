// apps/extension/src/service-worker/asr-realtime.local-bridge.test.ts
// @vitest-environment node

import { describe, expect, test, beforeAll } from 'vitest';
import * as fs from 'fs';
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

const bridgeEndpoint = process.env.LISTEN_GRAPHIC_LOCAL_BRIDGE_ENDPOINT?.trim() || 'ws://127.0.0.1:15377/ws';
const bridgeHealthUrl = process.env.LISTEN_GRAPHIC_LOCAL_BRIDGE_HEALTH_URL?.trim() || 'http://127.0.0.1:15377/healthz';
const bridgeAuthToken = process.env.LISTEN_GRAPHIC_LOCAL_BRIDGE_AUTH_TOKEN?.trim() || undefined;
const requestedFixtureFilter = process.env.LISTEN_GRAPHIC_E2E_ASR_FIXTURE?.trim().toLowerCase() || undefined;
const realtimeTimeoutMs = Number.parseInt(process.env.LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS?.trim() || '', 10);
const effectiveTimeoutMs = Number.isFinite(realtimeTimeoutMs) ? realtimeTimeoutMs : 90_000;

// 是否使用真实 ASR（sherpa-onnx）；mock bridge 时只做管线检查
const isRealAsr = process.env.LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR?.trim() === '1';

// 可选：将 utterances 写入 artifact 文件（供 scaffold 生成管线使用）
const shouldWriteArtifacts = process.env.LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS?.trim() === '1';

let bridgeAvailable = false;

beforeAll(async () => {
  bridgeAvailable = await isBridgeHealthy(bridgeHealthUrl);
});

describe('ASR 本地 bridge fixture 测试', () => {
  const fixtures = loadAsrRealtimeFixtures(requestedFixtureFilter);

  for (const fixture of fixtures) {
    test(
      fixture.name,
      { timeout: effectiveTimeoutMs + 30_000 },
      async (ctx) => {
        if (!bridgeAvailable) {
          ctx.skip();
          return;
        }
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

        // 可选：将 utterances 写入 artifact 文件
        if (shouldWriteArtifacts && !('skipped' in result)) {
          writeLocalBridgeUtteranceArtifact(fixture, result.utterances, bridgeEndpoint);
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
