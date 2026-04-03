// @vitest-environment node

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import {
  createTencentRealtimeConfigFromEnv,
  loadAsrRealtimeFixtures,
  looselyMatchesNormalizedText,
  normalizeText,
  readPcm16MonoWav,
  resolveAudioPath,
  runTencentRealtimeFixture,
  type AsrRealtimeFixture,
  type StableUtterance,
  writeRealtimeUtteranceArtifact,
} from './asr-real-fixture-helpers';

const requestedFixtureFilter = process.env.LISTEN_GRAPHIC_E2E_ASR_FIXTURE?.trim().toLowerCase();
const allowExternalIssueSkip =
  process.env.LISTEN_GRAPHIC_E2E_ASR_ALLOW_EXTERNAL_SKIP?.trim() === '1';
const shouldWriteArtifacts =
  process.env.LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS?.trim() === '1';
const realtimeTimeoutMs = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS?.trim() || '',
  10,
);
const effectiveRealtimeTimeoutMs = Number.isFinite(realtimeTimeoutMs) ? realtimeTimeoutMs : 90_000;
const canRunRealAsr = Boolean(
  process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_APP_ID?.trim() &&
    process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_ID?.trim() &&
    process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_KEY?.trim(),
);
const describeReal = canRunRealAsr ? describe : describe.skip;

describeReal('ASR-focused Tencent realtime fixtures', () => {
  const fixtures = loadAsrRealtimeFixtures(requestedFixtureFilter);

  for (const fixture of fixtures) {
    test(
      fixture.name,
      { timeout: effectiveRealtimeTimeoutMs + 30_000 },
      async () => {
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

        assertFixtureAcceptance(fixture, result.utterances);
        if (shouldWriteArtifacts) {
          writeRealtimeUtteranceArtifact(fixture, result.utterances);
        }
      },
    );
  }
});

function assertFixtureAcceptance(
  fixture: AsrRealtimeFixture,
  utterances: StableUtterance[],
) {
  expect(
    utterances.length,
    `${fixture.name} stable utterances=${JSON.stringify(utterances, null, 2)}`,
  ).toBeGreaterThanOrEqual(fixture.acceptance.minStableUtterances);

  const normalizedTexts = utterances.map((utterance) => normalizeText(utterance.text));

  for (const expectedText of fixture.acceptance.mustContainTexts ?? []) {
    const normalizedExpected = normalizeText(expectedText);
    const matched = normalizedTexts.some((text) =>
      looselyMatchesNormalizedText(text, normalizedExpected),
    );
    expect(
      matched,
      `${fixture.name} should contain text "${expectedText}" utterances=${JSON.stringify(utterances, null, 2)}`,
    ).toBe(true);
  }

  for (const candidateGroup of fixture.acceptance.mustContainOneOfTexts ?? []) {
    const matched = candidateGroup.some((candidateText) => {
      const normalizedExpected = normalizeText(candidateText);
      return normalizedTexts.some((text) =>
        looselyMatchesNormalizedText(text, normalizedExpected),
      );
    });
    expect(
      matched,
      `${fixture.name} should contain one of ${JSON.stringify(candidateGroup)} utterances=${JSON.stringify(utterances, null, 2)}`,
    ).toBe(true);
  }
}
