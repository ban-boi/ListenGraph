// @vitest-environment node

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TencentAsrProvider } from '@listen-graphic/providers';
import { encodePcm16AsWav } from '../shared/audio';
import {
  ASR_COMPARE_ARTIFACT_DIR,
  createTencentBatchConfigFromEnv,
  createTencentRealtimeConfigFromEnv,
  loadAsrRealtimeFixtures,
  normalizeText,
  readPcm16MonoWav,
  resolveAudioPath,
  runTencentRealtimeFixture,
  sanitizeFileName,
  type StableUtterance,
} from './asr-real-fixture-helpers';

type BatchChunkResult = {
  chunkId: string;
  startMs: number;
  endMs: number;
  text: string;
  rawText: string;
};

const requestedFixtureFilter = process.env.LISTEN_GRAPHIC_E2E_ASR_FIXTURE?.trim().toLowerCase();
const allowExternalIssueSkip =
  process.env.LISTEN_GRAPHIC_E2E_ASR_ALLOW_EXTERNAL_SKIP?.trim() === '1';
const shouldWriteCompareArtifacts =
  process.env.LISTEN_GRAPHIC_E2E_ASR_WRITE_COMPARE_ARTIFACTS?.trim() !== '0';
const realtimeTimeoutMs = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS?.trim() || '',
  10,
);
const effectiveRealtimeTimeoutMs = Number.isFinite(realtimeTimeoutMs) ? realtimeTimeoutMs : 90_000;
const batchChunkMs = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_ASR_BATCH_CHUNK_MS?.trim() || '',
  10,
);
const effectiveBatchChunkMs = Number.isFinite(batchChunkMs) ? batchChunkMs : 10_000;
const canRunRealAsr = Boolean(
  process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_APP_ID?.trim() &&
    process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_ID?.trim() &&
    process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_KEY?.trim(),
);
const describeReal = canRunRealAsr ? describe : describe.skip;

describeReal('ASR transport comparison', () => {
  const fixtures = loadAsrRealtimeFixtures(requestedFixtureFilter);

  for (const fixture of fixtures) {
    test(
      fixture.name,
      { timeout: 15 * 60_000 },
      async () => {
        const audioPath = resolveAudioPath(fixture.name, fixture.audioFile);
        const wavBytes = fs.readFileSync(audioPath);
        const pcmPayload = readPcm16MonoWav(wavBytes, fixture.audioClipDurationMs);
        const realtimeConfig = await createTencentRealtimeConfigFromEnv();
        const batchConfig = await createTencentBatchConfigFromEnv();

        const realtimeResult = await runTencentRealtimeFixture({
          config: realtimeConfig,
          pcmData: pcmPayload.data,
          frameBytes: Math.max(1, Math.round((pcmPayload.sampleRate * 2 * 40) / 1000)),
          frameDurationMs: 40,
          timeoutMs: effectiveRealtimeTimeoutMs,
          allowExternalIssueSkip,
        });
        if ('skippedDueToExternalIssue' in realtimeResult) {
          console.warn(realtimeResult.reason);
          return;
        }

        const batchResult = await runTencentBatchComparison({
          fixtureName: fixture.name,
          sampleRate: pcmPayload.sampleRate,
          pcmData: pcmPayload.data,
          batchChunkMs: effectiveBatchChunkMs,
          config: batchConfig,
        });

        expect(
          realtimeResult.utterances.length,
          `${fixture.name} realtime utterances should not be empty`,
        ).toBeGreaterThan(0);
        expect(
          batchResult.nonEmptyChunks.length,
          `${fixture.name} batch transcripts should not be empty`,
        ).toBeGreaterThan(0);

        const compareArtifact = {
          fixtureName: fixture.name,
          recordedAt: new Date().toISOString(),
          audioFile: fixture.audioFile,
          audioClipDurationMs: fixture.audioClipDurationMs,
          batchChunkMs: effectiveBatchChunkMs,
          realtime: summarizeRealtime(realtimeResult.utterances),
          batch: summarizeBatch(batchResult.nonEmptyChunks, batchResult.allChunks.length),
          normalizedComparison: {
            realtimeCorpus: normalizeText(realtimeResult.utterances.map((item) => item.text).join('')),
            batchCorpus: normalizeText(batchResult.nonEmptyChunks.map((item) => item.text).join('')),
          },
        };

        if (shouldWriteCompareArtifacts) {
          fs.mkdirSync(ASR_COMPARE_ARTIFACT_DIR, { recursive: true });
          const outputPath = path.join(
            ASR_COMPARE_ARTIFACT_DIR,
            `${sanitizeFileName(fixture.name)}.compare.json`,
          );
          fs.writeFileSync(`${outputPath}`, `${JSON.stringify(compareArtifact, null, 2)}\n`);
        }
      },
    );
  }
});

async function runTencentBatchComparison(params: {
  fixtureName: string;
  sampleRate: number;
  pcmData: Uint8Array;
  batchChunkMs: number;
  config: Awaited<ReturnType<typeof createTencentBatchConfigFromEnv>>;
}) {
  const provider = new TencentAsrProvider(params.config);
  const chunkByteLength = Math.max(
    2,
    Math.floor((params.sampleRate * 2 * params.batchChunkMs) / 1000 / 2) * 2,
  );
  const allChunks: BatchChunkResult[] = [];

  try {
    for (let offset = 0; offset < params.pcmData.length; offset += chunkByteLength) {
      const chunkBytes = params.pcmData.subarray(
        offset,
        Math.min(offset + chunkByteLength, params.pcmData.length),
      );
      const startMs = Math.floor((offset / 2 / params.sampleRate) * 1000);
      const endMs = Math.floor(((offset + chunkBytes.length) / 2 / params.sampleRate) * 1000);
      const pcm16 = new Int16Array(
        chunkBytes.buffer.slice(chunkBytes.byteOffset, chunkBytes.byteOffset + chunkBytes.byteLength),
      );
      const wavBytes = encodePcm16AsWav(pcm16, {
        sampleRate: params.sampleRate,
        channels: 1,
      });
      const wavArrayBuffer = toOwnedArrayBuffer(wavBytes);
      const transcript = await provider.transcribeChunk({
        sessionId: `compare_${sanitizeFileName(params.fixtureName)}`,
        audio: new Blob([wavArrayBuffer], { type: 'audio/wav' }),
        startMs,
        endMs,
        language: 'zh',
      });
      const rawText = transcript.text.trim();
      allChunks.push({
        chunkId: transcript.chunkId,
        startMs,
        endMs,
        text: cleanBatchTranscriptText(rawText),
        rawText,
      });
    }
  } finally {
    provider.reset?.();
  }

  return {
    allChunks,
    nonEmptyChunks: allChunks.filter((chunk) => chunk.text.length > 0),
  };
}

function summarizeRealtime(utterances: StableUtterance[]) {
  return {
    stableUtteranceCount: utterances.length,
    totalTextLength: utterances.reduce((sum, item) => sum + item.text.length, 0),
    utterances,
  };
}

function summarizeBatch(chunks: BatchChunkResult[], totalChunkCount: number) {
  return {
    totalChunkCount,
    nonEmptyChunkCount: chunks.length,
    totalTextLength: chunks.reduce((sum, item) => sum + item.text.length, 0),
    chunks,
  };
}

function cleanBatchTranscriptText(value: string) {
  return value.replace(/\[\d+:\d+\.\d+,\d+:\d+\.\d+\]\s*/g, '').trim();
}

function toOwnedArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
