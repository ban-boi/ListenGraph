import * as fs from 'fs';
import * as path from 'path';
import type { AsrProviderConfig } from '@listen-graphic/schema';
import { createTencentRealtimeSessionConfig } from './tencent-realtime';

export type AsrRealtimeFixture = {
  name: string;
  disabled?: boolean;
  audioFile: string;
  audioClipDurationMs?: number;
  structureReplay?: {
    name: string;
    acceptance: {
      minSegments: number;
      minMergedNodes: number;
      minMergedEdges: number;
      allowFallback: boolean;
      mustContainTexts?: string[];
      mustContainOneOfTexts?: string[][];
      requiredEdgeTypes?: string[];
    };
  };
  acceptance: {
    minStableUtterances: number;
    mustContainTexts?: string[];
    mustContainOneOfTexts?: string[][];
  };
};

export type TencentRealtimeServerMessage = {
  code?: number;
  message?: string;
  voice_id?: string;
  message_id?: string;
  result?: {
    slice_type?: number;
    voice_text_str?: string;
    start_time?: number;
    end_time?: number;
    word_size?: number;
  };
};

export type StableUtterance = {
  text: string;
  startMs: number;
  endMs: number;
  voiceId?: string;
  messageId?: string;
  raw: TencentRealtimeServerMessage;
};

export const ASR_FIXTURE_DIR = path.resolve(__dirname, './fixtures/asr-realtime');
export const ASR_ARTIFACT_DIR = path.resolve(ASR_FIXTURE_DIR, 'artifacts');
export const ASR_COMPARE_ARTIFACT_DIR = path.resolve(ASR_FIXTURE_DIR, 'compare-artifacts');

export function loadAsrRealtimeFixtures(requestedFixtureFilter?: string) {
  if (!fs.existsSync(ASR_FIXTURE_DIR)) {
    return [];
  }

  const fixtures = fs
    .readdirSync(ASR_FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const raw = fs.readFileSync(path.join(ASR_FIXTURE_DIR, name), 'utf-8');
      return JSON.parse(raw) as AsrRealtimeFixture;
    })
    .filter((fixture) => !fixture.disabled);

  if (!requestedFixtureFilter) {
    return fixtures;
  }

  const requestedNames = requestedFixtureFilter
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const filtered = fixtures.filter((fixture) =>
    requestedNames.some((name) => fixture.name.toLowerCase().includes(name)),
  );
  if (filtered.length === 0) {
    throw new Error(
      `No ASR realtime fixtures matched LISTEN_GRAPHIC_E2E_ASR_FIXTURE=${requestedFixtureFilter}`,
    );
  }

  return filtered;
}

export function resolveAudioPath(fixtureName: string, audioFile: string) {
  const directPath = path.resolve(ASR_FIXTURE_DIR, audioFile);
  if (fs.existsSync(directPath)) {
    assertSupportedAudioFixture(fixtureName, directPath);
    return directPath;
  }

  const repoRelativePath = path.resolve(process.cwd(), audioFile);
  if (fs.existsSync(repoRelativePath)) {
    assertSupportedAudioFixture(fixtureName, repoRelativePath);
    return repoRelativePath;
  }

  throw new Error(`${fixtureName} audio file not found: ${audioFile}`);
}

export function assertSupportedAudioFixture(fixtureName: string, audioPath: string) {
  const extension = path.extname(audioPath).toLowerCase();
  if (extension === '.wav') {
    return;
  }

  throw new Error(
    `${fixtureName} audio fixture must be a 16kHz mono PCM WAV file. ` +
      `Received ${extension || '<no extension>'}: ${audioPath}. ` +
      `Run "pnpm --filter extension prepare:asr:real" to convert mp3 sources before testing.`,
  );
}

export function readPcm16MonoWav(fileBytes: Buffer, clipDurationMs?: number) {
  const view = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  const riff = fileBytes.subarray(0, 4).toString('ascii');
  const wave = fileBytes.subarray(8, 12).toString('ascii');
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Only RIFF/WAVE fixtures are supported');
  }

  const audioFormat = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error('Only PCM16 mono WAV fixtures are supported');
  }

  let offset = 12;
  while (offset + 8 <= fileBytes.length) {
    const chunkId = fileBytes.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'data') {
      let data = fileBytes.subarray(offset + 8, offset + 8 + chunkSize);
      if (clipDurationMs && clipDurationMs > 0) {
        const clipByteLength = Math.max(
          2,
          Math.floor((sampleRate * 2 * clipDurationMs) / 1000 / 2) * 2,
        );
        data = data.subarray(0, Math.min(data.byteLength, clipByteLength));
      }
      return {
        sampleRate,
        data,
      };
    }
    offset += 8 + chunkSize;
  }

  throw new Error('WAV data chunk not found');
}

export async function createTencentRealtimeConfigFromEnv(): Promise<AsrProviderConfig> {
  const tencentAppId = process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_APP_ID?.trim();
  const tencentSecretId = process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_ID?.trim();
  const tencentSecretKey = process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_KEY?.trim();
  const tencentEngineModel = process.env.LISTEN_GRAPHIC_E2E_ASR_ENGINE_MODEL?.trim() || '16k_zh';

  return {
    type: 'tencent',
    mode: 'direct',
    transport: 'ws',
    appId: tencentAppId,
    model: tencentEngineModel,
    language: 'zh',
    secretId: tencentSecretId,
    secretKey: tencentSecretKey,
    needVad: true,
    vadSilenceTimeMs: 1000,
    maxSpeakTimeMs: 60000,
    wordInfo: 0,
  };
}

export async function createTencentBatchConfigFromEnv(): Promise<AsrProviderConfig> {
  const tencentSecretId = process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_ID?.trim();
  const tencentSecretKey = process.env.LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_KEY?.trim();
  const tencentEngineModel = process.env.LISTEN_GRAPHIC_E2E_ASR_ENGINE_MODEL?.trim() || '16k_zh';

  return {
    type: 'tencent',
    mode: 'direct',
    transport: 'batch',
    model: tencentEngineModel,
    language: 'zh',
    secretId: tencentSecretId,
    secretKey: tencentSecretKey,
    retry: {
      timeoutMs: 180_000,
    },
  };
}

export async function runTencentRealtimeFixture(params: {
  config: AsrProviderConfig;
  pcmData: Uint8Array;
  frameBytes: number;
  frameDurationMs: number;
  timeoutMs: number;
  allowExternalIssueSkip: boolean;
}): Promise<
  | { utterances: StableUtterance[] }
  | { skippedDueToExternalIssue: true; reason: string }
> {
  if (typeof WebSocket === 'undefined') {
    throw new Error('Current runtime does not provide WebSocket');
  }

  const session = await createTencentRealtimeSessionConfig(params.config);
  const utterances: StableUtterance[] = [];

  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(session.signedUrl);
    const timeout = setTimeout(() => {
      safeCloseWebSocket(ws);
      const reason = `Tencent realtime ASR timed out after ${params.timeoutMs}ms`;
      if (params.allowExternalIssueSkip) {
        resolve({
          skippedDueToExternalIssue: true,
          reason,
        });
        return;
      }
      reject(new Error(reason));
    }, params.timeoutMs);

    let finalized = false;

    const finish = (
      result:
        | { utterances: StableUtterance[] }
        | { skippedDueToExternalIssue: true; reason: string },
    ) => {
      if (finalized) {
        return;
      }
      finalized = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const fail = (error: Error) => {
      if (finalized) {
        return;
      }
      finalized = true;
      clearTimeout(timeout);
      reject(error);
    };

    ws.onopen = () => {
      void streamPcmFrames(ws, params.pcmData, params.frameBytes, params.frameDurationMs).catch((error) => {
        const streamError =
          error instanceof Error ? error : new Error(`Failed to stream PCM frames: ${String(error)}`);
        fail(streamError);
        safeCloseWebSocket(ws);
      });
    };

    ws.onerror = () => {
      const reason = 'Tencent realtime ASR websocket error';
      if (params.allowExternalIssueSkip) {
        finish({ skippedDueToExternalIssue: true, reason });
        return;
      }
      fail(new Error(reason));
    };

    ws.onmessage = (event) => {
      const payload = parseTencentRealtimeServerMessage(event.data);
      if (!payload) {
        return;
      }

      if ((payload.code ?? 0) !== 0) {
        const message = payload.message ?? `Tencent realtime ASR error code=${payload.code}`;
        const isExternalIssue =
          payload.code === 4008 ||
          payload.code === 4009 ||
          payload.code === 4010 ||
          payload.code === 4011 ||
          payload.code === 5000;
        if (isExternalIssue && params.allowExternalIssueSkip) {
          finish({
            skippedDueToExternalIssue: true,
            reason: message,
          });
          safeCloseWebSocket(ws);
          return;
        }
        fail(new Error(message));
        safeCloseWebSocket(ws);
        return;
      }

      const result = payload.result;
      if (!result || result.slice_type !== 2) {
        return;
      }

      const text = result.voice_text_str?.trim() ?? '';
      if (!text) {
        return;
      }

      utterances.push({
        text,
        startMs: result.start_time ?? 0,
        endMs: result.end_time ?? result.start_time ?? 0,
        voiceId: payload.voice_id,
        messageId: payload.message_id,
        raw: payload,
      });
    };

    ws.onclose = () => {
      finish({ utterances });
    };
  });
}

export function writeRealtimeUtteranceArtifact(fixture: AsrRealtimeFixture, utterances: StableUtterance[]) {
  fs.mkdirSync(ASR_ARTIFACT_DIR, { recursive: true });
  const artifactPath = path.join(ASR_ARTIFACT_DIR, `${sanitizeFileName(fixture.name)}.utterances.json`);
  fs.writeFileSync(
    artifactPath,
    `${JSON.stringify(
      {
        fixtureName: fixture.name,
        audioFile: fixture.audioFile,
        audioClipDurationMs: fixture.audioClipDurationMs,
        recordedAt: new Date().toISOString(),
        utterances,
      },
      null,
      2,
    )}\n`,
  );
}

export function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[，。！？、,.!?\s]/g, '')
    .replace(/[啊呀呢嘛吧呃额嗯]/g, '');
}

export function looselyMatchesNormalizedText(actual: string, expected: string) {
  if (!actual || !expected) {
    return false;
  }

  if (actual.includes(expected) || expected.includes(actual)) {
    return true;
  }

  const lcsRatio = longestCommonSubsequenceLength(actual, expected) / Math.min(actual.length, expected.length);
  return lcsRatio >= 0.8;
}

export function sanitizeFileName(value: string) {
  // eslint-disable-next-line no-control-regex -- 有意过滤文件名中的控制字符（\x00-\x1F），这是 sanitize 的本职
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function longestCommonSubsequenceLength(left: string, right: string) {
  const columns = right.length + 1;
  let previous = new Uint16Array(columns);
  let current = new Uint16Array(columns);

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      if (left[row - 1] === right[column - 1]) {
        current[column] = previous[column - 1] + 1;
      } else {
        current[column] = Math.max(previous[column], current[column - 1]);
      }
    }

    const next = previous;
    previous = current;
    current = next;
    current.fill(0);
  }

  return previous[right.length];
}

function parseTencentRealtimeServerMessage(data: unknown): TencentRealtimeServerMessage | null {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as TencentRealtimeServerMessage;
    } catch {
      return null;
    }
  }

  if (data instanceof ArrayBuffer) {
    try {
      return JSON.parse(Buffer.from(data).toString('utf-8')) as TencentRealtimeServerMessage;
    } catch {
      return null;
    }
  }

  if (ArrayBuffer.isView(data)) {
    try {
      return JSON.parse(Buffer.from(data.buffer).toString('utf-8')) as TencentRealtimeServerMessage;
    } catch {
      return null;
    }
  }

  return null;
}

function safeCloseWebSocket(socket: WebSocket) {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}

async function streamPcmFrames(
  socket: WebSocket,
  pcmData: Uint8Array,
  frameBytes: number,
  frameDurationMs: number,
) {
  const targetAudioSecondsPerSecond = 2.5;
  const framesPerBurst = 6;
  let framesInBurst = 0;

  for (let offset = 0; offset < pcmData.length; offset += frameBytes) {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Tencent realtime ASR socket closed while streaming: readyState=${socket.readyState}`);
    }

    const frame = pcmData.subarray(offset, Math.min(offset + frameBytes, pcmData.length));
    socket.send(toArrayBuffer(frame));
    framesInBurst += 1;

    if (framesInBurst >= framesPerBurst) {
      const burstAudioMs = framesPerBurst * frameDurationMs;
      const waitMs = Math.max(1, Math.ceil(burstAudioMs / targetAudioSecondsPerSecond));
      framesInBurst = 0;
      await delay(waitMs);
    }
  }

  if (socket.readyState === WebSocket.OPEN) {
    socket.send('{"type": "end"}');
  }
}

function toArrayBuffer(view: Uint8Array) {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
