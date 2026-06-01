// apps/extension/src/service-worker/asr-local-bridge-helpers.ts
import * as fs from 'fs';
import * as path from 'path';
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
    const wsUrl = params.authToken
      ? `${params.endpoint}${params.endpoint.includes('?') ? '&' : '?'}token=${encodeURIComponent(params.authToken)}`
      : params.endpoint;
    const ws = new WebSocket(wsUrl);
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

export {
  loadAsrRealtimeFixtures,
  readPcm16MonoWav,
  resolveAudioPath,
  normalizeText,
  looselyMatchesNormalizedText,
  type AsrRealtimeFixture,
};
