import type {
  AppMessage,
  AsrStreamFinalPayload,
  AsrStreamPartialPayload,
  AsrStreamStartPayload,
} from '../shared/messages';
import {
  CAPTURE_CHANNELS,
  CAPTURE_AUDIO_MIME_TYPE,
  CAPTURE_SAMPLE_RATE,
  encodeAudioChunkAsWav,
  float32ToPcm16,
} from '../shared/audio';

let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: AudioWorkletNode | null = null;
let realtimeSocket: WebSocket | null = null;
let isCapturing = false;
let hasReportedCaptureEnd = false;
let activeCaptureRun = 0;

const SAMPLE_RATE = CAPTURE_SAMPLE_RATE;
const DEFAULT_REALTIME_FRAME_DURATION_MS = 40;

type FixtureCaptureChunk = {
  url: string;
  startMs: number;
  endMs: number;
  audioMimeType?: string;
  delayAfterMs?: number;
};

type FixtureCaptureManifest = {
  captureMode: 'fixture-chunks';
  chunkDelayMs?: number;
  chunks: FixtureCaptureChunk[];
};

type TencentRealtimeCaptureConfig = {
  signedUrl: string;
  sampleRate: number;
  frameDurationMs: number;
};

type ExternalBridgeCaptureConfig = {
  endpoint: string;
  protocol?: 'lg-asr-ws-v1';
  authToken?: string;
  sampleRate: number;
  frameDurationMs: number;
  provider: string;
};

type ActiveRealtimeStreamConfig =
  | { providerType: 'tencent'; provider: 'tencent-asr'; connectionUrl: string; frameDurationMs: number }
  | { providerType: 'external'; provider: string; connectionUrl: string; protocol?: 'lg-asr-ws-v1'; authToken?: string; frameDurationMs: number };

type TencentRealtimeServerMessage = {
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

type ExternalBridgeServerMessage =
  | {
      type: 'session.started';
      version?: string;
      bridge?: { model?: string };
    }
  | {
      type: 'status';
      status: 'connecting' | 'connected' | 'listening' | 'closing' | 'closed';
      detail?: string;
      bridge?: { protocol?: 'lg-asr-ws-v1'; endpoint?: string; model?: string };
    }
  | {
      type: 'transcript.partial';
      utterance: {
        utteranceId?: string;
        revision?: number;
        text?: string;
        startMs?: number;
        endMs?: number;
        confidence?: number;
      };
      vendor?: { name?: string; event?: string };
    }
  | {
      type: 'transcript.final';
      utterance: {
        utteranceId?: string;
        revision?: number;
        text?: string;
        startMs?: number;
        endMs?: number;
        confidence?: number;
        finalReason?: AsrStreamFinalPayload['finalReason'];
        stability?: 'stable';
        language?: string;
      };
      vendor?: { name?: string; event?: string };
    }
  | {
      type: 'error';
      error: {
        code?: string;
        message?: string;
      };
    };

let activeRealtimeStreamConfig: ActiveRealtimeStreamConfig | null = null;

chrome.runtime.onMessage.addListener((message: AppMessage | any, _sender, sendResponse) => {
  if (message.target && message.target !== 'content-script') return false;

  switch (message.type) {
    case 'START_CAPTURE':
      startTabCapture(message.payload)
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) =>
          sendResponse({ success: false, error: error.message }),
        );
      return true;
    case 'STOP_CAPTURE':
      stopCapture()
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) =>
          sendResponse({ success: false, error: error.message }),
        );
      return true;
    case 'SEEK_TO_TIMESTAMP':
      seekToTimestamp(message.payload.timestampMs)
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) =>
          sendResponse({ success: false, error: error.message }),
        );
      return true;
    default:
      return false;
  }
});

async function startTabCapture(payload?: AsrStreamStartPayload) {
  if (isCapturing) {
    return;
  }

  try {
    hasReportedCaptureEnd = false;
    const realtimeConfig = resolveRealtimeStreamConfig(payload);
    const fixtureManifestUrl = readFixtureManifestUrl(document);
    if (fixtureManifestUrl) {
      if (realtimeConfig) {
        await openRealtimeSocket(realtimeConfig);
      }
      await startFixtureCapture(fixtureManifestUrl, realtimeConfig);
      return;
    }

    // 真实浏览器里通常需要同时请求 tab 视频，音频轨道才会稳定返回。
    const constraints = {
      audio: true,
      video: true,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
    } as DisplayMediaStreamOptions & Record<string, unknown>;

    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      ...constraints,
    });

    const videoTrack = mediaStream.getVideoTracks()[0];
    const displaySurface = videoTrack?.getSettings?.().displaySurface;
    if (displaySurface && displaySurface !== 'browser') {
      throw new Error('请选择浏览器标签页作为共享目标，而不是整个窗口或屏幕');
    }

    if (mediaStream.getAudioTracks().length === 0) {
      throw new Error('捕获到的流里没有音频轨道');
    }

    mediaStream.getVideoTracks().forEach((track) => {
      track.enabled = false;
    });
    mediaStream.getTracks().forEach((track) => {
      track.onended = () => {
        void reportCaptureEnded('share-ended');
        void stopCapture();
      };
    });

    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    const workletUrl = chrome.runtime.getURL('offscreen/audio-processor.worklet.js');
    await audioContext.audioWorklet.addModule(workletUrl);

    processorNode = new AudioWorkletNode(audioContext, 'audio-chunk-processor', {
      processorOptions: realtimeConfig
        ? {
            mode: 'frame',
            frameDurationMs:
              realtimeConfig.frameDurationMs ?? DEFAULT_REALTIME_FRAME_DURATION_MS,
          }
        : {
            mode: 'chunk',
            chunkDurationMs: 10_000,
          },
    });
    processorNode.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'AUDIO_CHUNK') {
        const wavChunk = encodeAudioChunkAsWav(new Float32Array(event.data.audioData), {
          sampleRate: SAMPLE_RATE,
          channels: CAPTURE_CHANNELS,
        });

        void chrome.runtime.sendMessage({
          type: 'AUDIO_CHUNK_READY',
          target: 'service-worker',
          payload: {
            ...wavChunk,
            startMs: event.data.startMs,
            endMs: event.data.endMs,
          },
        } as AppMessage);
        return;
      }

      if (event.data?.type === 'AUDIO_FRAME') {
        sendRealtimeAudioFrame(new Float32Array(event.data.audioData));
      }
    };

    if (realtimeConfig) {
      await openRealtimeSocket(realtimeConfig);
    }

    sourceNode.connect(processorNode);
    isCapturing = true;
  } catch (error) {
    await stopCapture();
    throw error instanceof Error ? error : new Error('启动标签页采集失败');
  }
}

async function stopCapture() {
  isCapturing = false;
  activeCaptureRun += 1;

  closeRealtimeSocket();
  activeRealtimeStreamConfig = null;

  if (processorNode) {
    processorNode.port.onmessage = null;
    processorNode.disconnect();
    processorNode = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }
}

async function reportCaptureEnded(
  reason: 'share-ended' | 'pagehide' | 'beforeunload',
) {
  if (hasReportedCaptureEnd) {
    return;
  }

  hasReportedCaptureEnd = true;
  await chrome.runtime.sendMessage({
    type: 'CAPTURE_ENDED',
    target: 'service-worker',
    payload: { reason },
  } as AppMessage);
}

async function seekToTimestamp(timestampMs: number) {
  const mediaElement = findMediaElement(document);
  if (!mediaElement) {
    throw new Error('当前页面没有可控制的音频或视频元素');
  }

  mediaElement.currentTime = timestampMs / 1000;
}

async function startFixtureCapture(
  manifestUrl: string,
  realtimeConfig: ActiveRealtimeStreamConfig | null,
) {
  const manifest = await loadFixtureCaptureManifest(manifestUrl);
  const runId = ++activeCaptureRun;
  isCapturing = true;

  for (const chunk of manifest.chunks) {
    if (!isFixtureCaptureRunActive(runId)) {
      return;
    }

    const chunkUrl = new URL(chunk.url, window.location.href).toString();
    const response = await fetch(chunkUrl);
    if (!response.ok) {
      throw new Error(`读取测试音频失败: ${chunkUrl}`);
    }

    const audioBuffer = await response.arrayBuffer();
    if (!isFixtureCaptureRunActive(runId)) {
      return;
    }

    if (realtimeConfig) {
      await streamFixtureAudioChunk(audioBuffer, chunk, manifest);
      continue;
    }

    const chunkResponse = await chrome.runtime.sendMessage({
      type: 'AUDIO_CHUNK_READY',
      target: 'service-worker',
      payload: {
        audioData: Array.from(new Uint8Array(audioBuffer)),
        audioMimeType:
          chunk.audioMimeType ??
          response.headers.get('content-type') ??
          CAPTURE_AUDIO_MIME_TYPE,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
      },
    } as AppMessage);

    if (!chunkResponse?.success) {
      throw new Error(chunkResponse?.error ?? `处理测试音频块失败: ${chunkUrl}`);
    }

    const delayMs = chunk.delayAfterMs ?? manifest.chunkDelayMs ?? 0;
    if (delayMs > 0) {
      await delay(delayMs);
    }
  }

  if (realtimeConfig?.providerType === 'external') {
    sendRealtimeSocketJson({
      type: 'audio.flush',
      reason: 'input_finished',
    });
  }
}

async function streamFixtureAudioChunk(
  audioBuffer: ArrayBuffer,
  chunk: FixtureCaptureChunk,
  manifest: FixtureCaptureManifest,
) {
  const floatSamples = decodeFixtureWavToFloat32(audioBuffer);
  const frameSize = Math.max(
    1,
    Math.round((SAMPLE_RATE * DEFAULT_REALTIME_FRAME_DURATION_MS) / 1000),
  );

  for (let offset = 0; offset < floatSamples.length; offset += frameSize) {
    if (!isCapturing) {
      return;
    }
    const frame = floatSamples.subarray(offset, Math.min(offset + frameSize, floatSamples.length));
    sendRealtimeAudioFrame(frame);
    const delayMs = manifest.chunkDelayMs ?? 0;
    if (delayMs > 0) {
      await delay(delayMs);
    }
  }

  if (chunk.delayAfterMs && chunk.delayAfterMs > 0) {
    await delay(chunk.delayAfterMs);
  }
}

function decodeFixtureWavToFloat32(audioBuffer: ArrayBuffer): Float32Array {
  const view = new DataView(audioBuffer);
  if (view.byteLength < 44) {
    throw new Error('测试音频块格式无效: WAV 头过短');
  }

  const riff = readFourCc(view, 0);
  const wave = readFourCc(view, 8);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('测试音频块格式无效: 仅支持 PCM WAV');
  }

  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;
  let bitsPerSample = 16;
  let channels = 1;
  let audioFormat = 1;
  let sampleRate = SAMPLE_RATE;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readFourCc(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkDataOffset + chunkSize <= view.byteLength) {
      audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    } else if (
      chunkId === 'data' &&
      chunkDataOffset + chunkSize <= view.byteLength
    ) {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || bitsPerSample !== 16 || channels !== 1 || sampleRate !== SAMPLE_RATE) {
    throw new Error('测试音频块格式无效: 仅支持 16kHz/mono/pcm_s16le WAV');
  }

  if (dataOffset < 0 || dataSize <= 0) {
    throw new Error('测试音频块格式无效: 缺少 data chunk');
  }

  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 32768;
  }
  return samples;
}

function readFourCc(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function findMediaElement(root: Document | ShadowRoot): HTMLMediaElement | null {
  const directMatch = root.querySelector('audio, video');
  if (directMatch instanceof HTMLMediaElement) {
    return directMatch;
  }

  for (const element of Array.from(root.querySelectorAll('*'))) {
    const host = element as HTMLElement & { shadowRoot?: ShadowRoot | null };
    if (host.shadowRoot) {
      const nestedMatch = findMediaElement(host.shadowRoot);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }

  return null;
}

function readFixtureManifestUrl(root: Document | ShadowRoot) {
  const meta = root.querySelector('meta[name="listen-graphic-test-manifest"]');
  if (!(meta instanceof HTMLMetaElement)) {
    return null;
  }

  const content = meta.content?.trim();
  return content || null;
}

async function loadFixtureCaptureManifest(manifestUrl: string): Promise<FixtureCaptureManifest> {
  const response = await fetch(new URL(manifestUrl, window.location.href).toString());
  if (!response.ok) {
    throw new Error(`读取测试 manifest 失败: ${manifestUrl}`);
  }

  const payload = await response.json();
  if (!isFixtureCaptureManifest(payload)) {
    throw new Error(`测试 manifest 格式无效: ${manifestUrl}`);
  }

  return payload;
}

function isFixtureCaptureManifest(value: unknown): value is FixtureCaptureManifest {
  if (!isRecord(value) || value.captureMode !== 'fixture-chunks' || !Array.isArray(value.chunks)) {
    return false;
  }

  return value.chunks.every(isFixtureCaptureChunk);
}

function isFixtureCaptureChunk(value: unknown): value is FixtureCaptureChunk {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    Number.isFinite(value.startMs) &&
    Number.isFinite(value.endMs) &&
    (value.audioMimeType === undefined || typeof value.audioMimeType === 'string') &&
    (value.delayAfterMs === undefined || Number.isFinite(value.delayAfterMs))
  );
}

function isFixtureCaptureRunActive(runId: number) {
  return isCapturing && activeCaptureRun === runId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRealtimeStreamConfig(payload?: AsrStreamStartPayload): ActiveRealtimeStreamConfig | null {
  if (payload?.transport !== 'ws') {
    return null;
  }

  if (payload.stream?.providerType === 'external') {
    const endpoint = payload.stream.endpoint?.trim();
    if (!endpoint) {
      throw new Error('缺少 Local ASR Bridge WebSocket 连接参数');
    }

    return {
      providerType: 'external',
      provider: payload.stream.provider,
      connectionUrl: endpoint,
      protocol: payload.stream.protocol,
      authToken: payload.stream.authToken,
      frameDurationMs: payload.stream.frameDurationMs ?? DEFAULT_REALTIME_FRAME_DURATION_MS,
    };
  }

  const tencentRealtime = payload?.tencentRealtime;
  if (!tencentRealtime?.signedUrl) {
    throw new Error('缺少腾讯实时 ASR WebSocket 连接参数');
  }

  return {
    providerType: 'tencent',
    provider: 'tencent-asr',
    connectionUrl: tencentRealtime.signedUrl,
    frameDurationMs: tencentRealtime.frameDurationMs ?? DEFAULT_REALTIME_FRAME_DURATION_MS,
  };
}

async function openRealtimeSocket(config: ActiveRealtimeStreamConfig) {
  activeRealtimeStreamConfig = config;
  if (config.providerType === 'tencent') {
    await openTencentRealtimeSocket(config);
    return;
  }

  await openExternalBridgeSocket(config);
}

async function openTencentRealtimeSocket(config: ActiveRealtimeStreamConfig & { providerType: 'tencent' }) {
  await chrome.runtime.sendMessage({
    type: 'ASR_STREAM_STATUS',
    target: 'service-worker',
    payload: {
      status: 'connecting',
      provider: 'tencent-asr',
      detail: '腾讯实时 ASR 连接中',
    },
  } as AppMessage);

  realtimeSocket = await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(config.connectionUrl);
    ws.binaryType = 'arraybuffer';

    const cleanup = () => {
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('error', handleError);
    };

    const handleOpen = () => {
      cleanup();
      resolve(ws);
    };

    const handleError = () => {
      cleanup();
      reject(new Error('腾讯实时 ASR WebSocket 连接失败'));
    };

    ws.addEventListener('open', handleOpen, { once: true });
    ws.addEventListener('error', handleError, { once: true });
  });

  realtimeSocket.onmessage = (event) => {
    void handleTencentRealtimeMessage(event.data);
  };
  realtimeSocket.onerror = () => {
    void chrome.runtime.sendMessage({
      type: 'ASR_STREAM_ERROR',
      target: 'service-worker',
      payload: {
        provider: 'tencent-asr',
        code: 'NETWORK_ERROR',
        message: '腾讯实时 ASR WebSocket 连接异常',
      },
    } as AppMessage);
  };
  realtimeSocket.onclose = () => {
    void chrome.runtime.sendMessage({
      type: 'ASR_STREAM_STATUS',
      target: 'service-worker',
      payload: {
        status: 'closed',
        provider: 'tencent-asr',
        detail: '腾讯实时 ASR 已断开',
      },
    } as AppMessage);
  };

  await chrome.runtime.sendMessage({
    type: 'ASR_STREAM_STATUS',
    target: 'service-worker',
    payload: {
      status: 'connected',
      provider: 'tencent-asr',
      detail: '腾讯实时 ASR 已连接',
    },
  } as AppMessage);
}

async function openExternalBridgeSocket(
  config: ActiveRealtimeStreamConfig & { providerType: 'external' },
) {
  await chrome.runtime.sendMessage({
    type: 'ASR_STREAM_STATUS',
    target: 'service-worker',
    payload: {
      status: 'connecting',
      provider: config.provider,
      detail: 'Local ASR Bridge 连接中',
      bridge: {
        protocol: config.protocol,
        endpoint: config.connectionUrl,
      },
    },
  } as AppMessage);

  realtimeSocket = await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(config.connectionUrl);
    ws.binaryType = 'arraybuffer';

    const cleanup = () => {
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('error', handleError);
    };

    const handleOpen = () => {
      cleanup();
      resolve(ws);
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Local ASR Bridge WebSocket 连接失败'));
    };

    ws.addEventListener('open', handleOpen, { once: true });
    ws.addEventListener('error', handleError, { once: true });
  });

  realtimeSocket.onmessage = (event) => {
    void handleExternalBridgeMessage(event.data);
  };
  realtimeSocket.onerror = () => {
    void chrome.runtime.sendMessage({
      type: 'ASR_STREAM_ERROR',
      target: 'service-worker',
      payload: {
        provider: config.provider,
        code: 'NETWORK_ERROR',
        message: 'Local ASR Bridge WebSocket 连接异常',
      },
    } as AppMessage);
  };
  realtimeSocket.onclose = () => {
    void chrome.runtime.sendMessage({
      type: 'ASR_STREAM_STATUS',
      target: 'service-worker',
      payload: {
        status: 'closed',
        provider: config.provider,
        detail: 'Local ASR Bridge 已断开',
        bridge: {
          protocol: config.protocol,
          endpoint: config.connectionUrl,
        },
      },
    } as AppMessage);
  };

  sendRealtimeSocketJson({
    type: 'session.start',
    version: '1',
    session: {
      sessionId: crypto.randomUUID(),
    },
    audio: {
      codec: 'pcm_s16le',
      sampleRate: SAMPLE_RATE,
      channels: 1,
      frameDurationMs: config.frameDurationMs,
    },
    options: {
      partials: true,
      finals: true,
      tokens: false,
      timestamps: false,
    },
    authToken: config.authToken,
  });

  await chrome.runtime.sendMessage({
    type: 'ASR_STREAM_STATUS',
    target: 'service-worker',
    payload: {
      status: 'connected',
      provider: config.provider,
      detail: 'Local ASR Bridge 已连接',
      bridge: {
        protocol: config.protocol,
        endpoint: config.connectionUrl,
      },
    },
  } as AppMessage);
}

function sendRealtimeAudioFrame(floatSamples: Float32Array) {
  if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  const pcm16 = float32ToPcm16(floatSamples);
  const config = activeRealtimeStreamConfig;
  if (config?.providerType === 'external') {
    sendRealtimeSocketJson({
      type: 'audio.frame',
      audio: {
        codec: 'pcm_s16le',
        data: bytesToBase64(new Uint8Array(pcm16.buffer.slice(0))),
        samples: pcm16.length,
      },
    });
    return;
  }

  realtimeSocket.send(new Uint8Array(pcm16.buffer.slice(0)));
}

async function handleTencentRealtimeMessage(data: unknown) {
  const payload = parseTencentRealtimeServerMessage(data);
  if (!payload) {
    return;
  }

  if ((payload.code ?? 0) !== 0) {
    await chrome.runtime.sendMessage({
      type: 'ASR_STREAM_ERROR',
      target: 'service-worker',
      payload: {
        provider: 'tencent-asr',
        code: String(payload.code ?? 'ASR_STREAM_ERROR'),
        message: payload.message ?? '腾讯实时 ASR 返回错误',
      },
    } as AppMessage);
    return;
  }

  const result = payload.result;
  if (!result) {
    return;
  }

  const text = result.voice_text_str?.trim() ?? '';
  const sliceType =
    result.slice_type === 0 || result.slice_type === 1 || result.slice_type === 2
      ? result.slice_type
      : null;
  if (sliceType === null) {
    return;
  }

  if (sliceType === 0 || sliceType === 1) {
    const partialPayload: AsrStreamPartialPayload = {
      text,
      provider: 'tencent-asr',
      kind: 'partial',
      stability: 'interim',
      sliceType,
      startMs: result.start_time,
      endMs: result.end_time,
      vendor: {
        name: 'tencent',
        event: `slice_type_${sliceType}`,
        voiceId: payload.voice_id,
        messageId: payload.message_id,
      },
      raw: payload,
    };
    await chrome.runtime.sendMessage({
      type: 'ASR_STREAM_PARTIAL_UPDATED',
      target: 'service-worker',
      payload: partialPayload,
    } as AppMessage);
    return;
  }

  if (!text) {
    return;
  }

  const utterancePayload: AsrStreamFinalPayload = {
    text,
    startMs: result.start_time ?? 0,
    endMs: result.end_time ?? result.start_time ?? 0,
    provider: 'tencent-asr',
    kind: 'final',
    finalReason: 'vendor_defined',
    stability: 'stable',
    transport: 'ws',
    vendor: {
      name: 'tencent',
      event: 'slice_type_2',
      voiceId: payload.voice_id,
      messageId: payload.message_id,
      wordSize: result.word_size,
    },
    raw: payload,
  };
  await chrome.runtime.sendMessage({
    type: 'ASR_STREAM_FINAL_READY',
    target: 'service-worker',
    payload: utterancePayload,
  } as AppMessage);
}

async function handleExternalBridgeMessage(data: unknown) {
  const payload = parseExternalBridgeServerMessage(data);
  if (!payload || !activeRealtimeStreamConfig || activeRealtimeStreamConfig.providerType !== 'external') {
    return;
  }

  if (payload.type === 'session.started') {
    await chrome.runtime.sendMessage({
      type: 'ASR_STREAM_STATUS',
      target: 'service-worker',
      payload: {
        status: 'listening',
        provider: activeRealtimeStreamConfig.provider,
        detail: 'Local ASR Bridge 握手成功',
        bridge: {
          protocol: activeRealtimeStreamConfig.protocol,
          endpoint: activeRealtimeStreamConfig.connectionUrl,
          model: payload.bridge?.model,
        },
      },
    } as AppMessage);
    return;
  }

  if (payload.type === 'status') {
    await chrome.runtime.sendMessage({
      type: 'ASR_STREAM_STATUS',
      target: 'service-worker',
      payload: {
        status: payload.status,
        provider: activeRealtimeStreamConfig.provider,
        detail: payload.detail,
        bridge: {
          protocol: payload.bridge?.protocol ?? activeRealtimeStreamConfig.protocol,
          endpoint: payload.bridge?.endpoint ?? activeRealtimeStreamConfig.connectionUrl,
          model: payload.bridge?.model,
        },
      },
    } as AppMessage);
    return;
  }

  if (payload.type === 'error') {
    await chrome.runtime.sendMessage({
      type: 'ASR_STREAM_ERROR',
      target: 'service-worker',
      payload: {
        provider: activeRealtimeStreamConfig.provider,
        code: payload.error.code ?? 'ASR_STREAM_ERROR',
        message: payload.error.message ?? 'Local ASR Bridge 返回错误',
      },
    } as AppMessage);
    return;
  }

  if (payload.type === 'transcript.partial') {
    await chrome.runtime.sendMessage({
      type: 'ASR_STREAM_PARTIAL_UPDATED',
      target: 'service-worker',
      payload: {
        text: payload.utterance.text ?? '',
        provider: activeRealtimeStreamConfig.provider,
        utteranceId: payload.utterance.utteranceId,
        revision: payload.utterance.revision,
        kind: 'partial',
        stability: 'interim',
        startMs: payload.utterance.startMs,
        endMs: payload.utterance.endMs,
        vendor: payload.vendor,
        raw: payload,
      },
    } as AppMessage);
    return;
  }

  if (!payload.utterance.text?.trim()) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: 'ASR_STREAM_FINAL_READY',
    target: 'service-worker',
    payload: {
      text: payload.utterance.text,
      provider: activeRealtimeStreamConfig.provider,
      utteranceId: payload.utterance.utteranceId,
      revision: payload.utterance.revision,
      kind: 'final',
      finalReason: payload.utterance.finalReason ?? 'vendor_defined',
      stability: payload.utterance.stability ?? 'stable',
      transport: 'ws',
      language: payload.utterance.language,
      startMs: payload.utterance.startMs ?? 0,
      endMs: payload.utterance.endMs ?? payload.utterance.startMs ?? 0,
      confidence: payload.utterance.confidence,
      vendor: payload.vendor,
      raw: payload,
    },
  } as AppMessage);
}

function closeRealtimeSocket() {
  if (!realtimeSocket) {
    return;
  }

  const socket = realtimeSocket;
  realtimeSocket = null;

  if (socket.readyState === WebSocket.OPEN) {
    try {
      if (activeRealtimeStreamConfig?.providerType === 'external') {
        sendRealtimeSocketJson({ type: 'audio.flush', reason: 'input_finished' }, socket);
        sendRealtimeSocketJson({ type: 'session.stop' }, socket);
      } else {
        socket.send('{"type": "end"}');
      }
    } catch (error) {
      console.warn('[content-script] 实时 ASR 结束标记发送失败:', error);
    }
  }

  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}

function parseTencentRealtimeServerMessage(data: unknown): TencentRealtimeServerMessage | null {
  if (typeof data !== 'string') {
    return null;
  }

  try {
    return JSON.parse(data) as TencentRealtimeServerMessage;
  } catch {
    return null;
  }
}

function parseExternalBridgeServerMessage(data: unknown): ExternalBridgeServerMessage | null {
  if (typeof data !== 'string') {
    return null;
  }

  try {
    return JSON.parse(data) as ExternalBridgeServerMessage;
  } catch {
    return null;
  }
}

function sendRealtimeSocketJson(payload: unknown, socket: WebSocket | null = realtimeSocket) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

window.addEventListener('beforeunload', () => {
  void reportCaptureEnded('beforeunload');
  void stopCapture();
});

window.addEventListener('pagehide', () => {
  void reportCaptureEnded('pagehide');
  void stopCapture();
});
