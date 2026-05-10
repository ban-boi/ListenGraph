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
