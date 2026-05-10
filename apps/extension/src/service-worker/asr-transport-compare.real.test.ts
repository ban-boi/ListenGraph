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
