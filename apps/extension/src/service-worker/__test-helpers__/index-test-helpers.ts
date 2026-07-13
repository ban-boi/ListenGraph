import { ProviderRequestError } from '@listen-graphic/providers';
import { vi, type Mock } from 'vitest';

// Lightweight test types
type TestMessage = { type: string; target?: string; payload?: Record<string, unknown> };
type TestMessageSender = { tab?: { id?: number } };
type TestMessageHandler = (message: TestMessage, sender: TestMessageSender, sendResponse: (response: Record<string, unknown>) => void) => boolean | void;

// Shared mock variables
export let messageListeners: TestMessageHandler[] = [];
/** dispatchMessage simulates chrome.runtime.sendMessage; response shapes vary per handler */
export let dispatchMessage: (
  message: TestMessage,
  sender?: TestMessageSender,
) => Promise<any>;
export let storageState: Record<string, unknown> = {};
export function resetStorageState(value: Record<string, unknown> = {}) {
  storageState = value;
}
export let transcribeChunkMock: Mock;
export let extractSegmentGraphMock: Mock;
export let saveSessionMock: Mock;
export let getSessionMock: Mock;
export let listRecentSessionsMock: Mock;
export let markEndedMock: Mock;
export let appendTranscriptChunkMock: Mock;
export let listTranscriptChunksBySessionMock: Mock;
export let appendSegmentGraphMock: Mock;
export let listSegmentGraphsBySessionMock: Mock;
export let saveMergedGraphMock: Mock;
export let getMergedGraphBySessionMock: Mock;
export let listAllMergedGraphsMock: Mock;
export let getProviderConfigMock: Mock;
export let createRuntimeProvidersMock: Mock;
export let asrResetMock: Mock;
export let structurerResetMock: Mock;

// Shared setup function that each test file's beforeEach will call
export async function setupServiceWorkerTests() {
  vi.clearAllMocks();
  vi.resetModules();
  messageListeners = [];
  storageState = {};
  transcribeChunkMock = vi.fn(async ({ sessionId, startMs, endMs, audio }: { sessionId: string; startMs: number; endMs: number; audio?: ArrayBuffer | Blob }) => ({
    chunkId: 'chunk_mock',
    sessionId,
    text: 'provider transcript',
    startMs,
    endMs,
    provider: 'mock-asr',
    raw: {
      audioSize:
        audio instanceof ArrayBuffer ? audio.byteLength : audio?.size ?? 0,
    },
  }));
  extractSegmentGraphMock = vi.fn(
    async ({ sessionId, transcriptWindow, previousGraph }: { sessionId: string; transcriptWindow: Array<{ chunkId: string; text: string; startMs: number; endMs: number }>; previousGraph?: { nodes?: Array<{ id: string }> } | null }) => ({
      segmentId: `segment_${transcriptWindow[transcriptWindow.length - 1].endMs}`,
      sessionId,
      startMs: previousGraph
        ? transcriptWindow[transcriptWindow.length - 1].startMs
        : transcriptWindow[0].startMs,
      endMs: transcriptWindow[transcriptWindow.length - 1].endMs,
      topic: 'provider topic',
      provider: 'mock-structurer',
      nodes: [
        {
          id: `segment_${transcriptWindow[transcriptWindow.length - 1].endMs}:node_${transcriptWindow.length}`,
          type: 'claim',
          text: transcriptWindow[transcriptWindow.length - 1].text,
          timestampMs: transcriptWindow[transcriptWindow.length - 1].startMs,
          status: 'confirmed',
          evidenceChunkIds: [transcriptWindow[transcriptWindow.length - 1].chunkId],
        },
      ],
      edges:
        previousGraph?.nodes && previousGraph.nodes.length > 0
          ? [
              {
                id: 'edge_mock',
                source: previousGraph.nodes[previousGraph.nodes.length - 1].id,
                target: `node_${transcriptWindow.length}`,
                type: 'supports',
                evidenceChunkIds: [transcriptWindow[transcriptWindow.length - 1].chunkId],
              },
            ]
          : [],
    }),
  );
  saveSessionMock = vi.fn(async () => undefined);
  getSessionMock = vi.fn(async () => undefined);
  listRecentSessionsMock = vi.fn(async () => []);
  markEndedMock = vi.fn(async () => undefined);
  appendTranscriptChunkMock = vi.fn(async () => undefined);
  listTranscriptChunksBySessionMock = vi.fn(async () => []);
  appendSegmentGraphMock = vi.fn(async () => undefined);
  listSegmentGraphsBySessionMock = vi.fn(async () => []);
  saveMergedGraphMock = vi.fn(async () => undefined);
  getMergedGraphBySessionMock = vi.fn(async () => undefined);
  listAllMergedGraphsMock = vi.fn(async () => []);
  getProviderConfigMock = vi.fn(async () => ({
    asr: {
      type: 'mock',
      mode: 'direct',
      model: 'mock-asr',
      language: 'zh',
    },
    structurer: {
      type: 'mock',
      mode: 'direct',
      model: 'mock-structurer',
      language: 'zh',
    },
  }));
  asrResetMock = vi.fn();
  structurerResetMock = vi.fn();
  createRuntimeProvidersMock = vi.fn((config: Record<string, unknown>) => ({
    config,
    asr: {
      name: 'mock-asr',
      transcribeChunk: transcribeChunkMock,
      reset: asrResetMock,
    },
    structurer: {
      name: 'mock-structurer',
      extractSegmentGraph: extractSegmentGraphMock,
      reset: structurerResetMock,
    },
  }));

  await initializeModule();
}

export async function initializeModule() {
  const chromeMock = (globalThis as any).chrome;
  messageListeners = [];

  vi.doMock('@listen-graphic/providers', () => ({
    createDefaultProviderConfig: () => ({
      asr: { type: 'mock', mode: 'direct', model: 'mock-asr', language: 'zh' },
      structurer: {
        type: 'mock',
        mode: 'direct',
        model: 'mock-structurer',
        language: 'zh',
      },
    }),
    normalizeProviderConfig: (config: { asr: Record<string, unknown>; structurer: Record<string, unknown> }) => config,
    createProviderRegistry: () => ({
      createRuntimeProviders: createRuntimeProvidersMock,
    }),
    TencentAsrProvider: class {},
    redactProviderConfig: (config: { asr: Record<string, unknown>; structurer: Record<string, unknown> }) => ({
      asr: {
        type: config.asr.type,
        mode: config.asr.mode,
        endpoint: config.asr.endpoint,
        model: config.asr.model,
        language: config.asr.language,
        apiKeyConfigured: Boolean(config.asr.apiKey),
        sessionTokenConfigured: Boolean(config.asr.sessionToken),
      },
      structurer: {
        type: config.structurer.type,
        mode: config.structurer.mode,
        endpoint: config.structurer.endpoint,
        model: config.structurer.model,
        language: config.structurer.language,
        apiKeyConfigured: Boolean(config.structurer.apiKey),
        sessionTokenConfigured: Boolean(config.structurer.sessionToken),
      },
    }),
    ProviderRequestError: class extends Error {
      code = 'TRANSCRIBE_ERROR';
      provider = 'mock-asr';
      stage = 'asr';
      retriable = false;
      status = undefined;
      attemptCount = 1;
      toJSON() {
        return {
          code: this.code,
          message: this.message,
          provider: this.provider,
          stage: this.stage,
          retriable: this.retriable,
          status: this.status,
          attemptCount: this.attemptCount,
        };
      }
    },
  }));
  vi.doMock('@listen-graphic/storage', () => ({
    createSessionRepository: () => ({
      save: saveSessionMock,
      get: getSessionMock,
      listRecent: listRecentSessionsMock,
      markEnded: markEndedMock,
    }),
    createTranscriptChunkRepository: () => ({
      append: appendTranscriptChunkMock,
      listBySession: listTranscriptChunksBySessionMock,
    }),
    createSegmentGraphRepository: () => ({
      append: appendSegmentGraphMock,
      listBySession: listSegmentGraphsBySessionMock,
    }),
    createMergedGraphRepository: () => ({
      save: saveMergedGraphMock,
      getBySession: getMergedGraphBySessionMock,
      listAll: listAllMergedGraphsMock,
    }),
    createSettingsRepository: () => ({
      getProviderConfig: getProviderConfigMock,
    }),
    db: {
      sessions: {},
      transcriptChunks: {},
      segmentGraphs: {},
      mergedGraphs: {},
      settings: {},
    },
  }));

  chromeMock.storage.session.get.mockImplementation((key: string) =>
    Promise.resolve({ [key]: storageState[key] }),
  );
  chromeMock.storage.session.set.mockImplementation((value: Record<string, unknown>) => {
    storageState = { ...storageState, ...value };
    return Promise.resolve();
  });
  chromeMock.storage.session.remove.mockImplementation((key: string) => {
    delete storageState[key];
    return Promise.resolve();
  });

  chromeMock.runtime.onMessage.addListener.mockImplementation((listener: TestMessageHandler) => {
    messageListeners.push(listener);
  });
  chromeMock.runtime.sendMessage.mockImplementation(
    (message: TestMessage, callback?: (response: Record<string, unknown>) => void) => {
      const sendResponse = (response: Record<string, unknown>) => {
        callback?.(response);
      };

      for (const listener of messageListeners) {
        const result = listener(message, { tab: { id: 1 } }, sendResponse);
        if (result === true) {
          return Promise.resolve({ success: true });
        }
      }

      return Promise.resolve({ success: true });
    },
  );

  await import('../index');

  dispatchMessage = (message, sender = { tab: { id: 1 } }) =>
    new Promise((resolve) => {
      const listener = messageListeners[0];
      listener(message, sender, resolve);
    });
}

export async function sendAudioChunk(params: {
  startMs: number;
  endMs: number;
  audioData?: number[];
  audioMimeType?: string;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  tabId?: number;
}) {
  return dispatchMessage(
    {
      type: 'AUDIO_CHUNK_READY',
      target: 'service-worker',
      payload: {
        audioData: params.audioData ?? [1, 2, 3, 4],
        audioMimeType: params.audioMimeType,
        sampleRate: params.sampleRate,
        channels: params.channels,
        bitDepth: params.bitDepth,
        startMs: params.startMs,
        endMs: params.endMs,
      },
    },
    { tab: { id: params.tabId ?? 123 } },
  );
}

export async function bootstrapStructurerWindow() {
  await sendAudioChunk({ startMs: 0, endMs: 10000 });
  await sendAudioChunk({ startMs: 10000, endMs: 20000 });
  return sendAudioChunk({ startMs: 20000, endMs: 30000 });
}

export function mockRealtimeProviderConfig() {
  getProviderConfigMock.mockResolvedValue({
    asr: {
      type: 'tencent',
      mode: 'direct',
      transport: 'ws',
      appId: '1250000000',
      model: '16k_zh',
      language: 'zh',
      secretId: 'secret-id',
      secretKey: 'secret-key',
    },
    structurer: {
      type: 'mock',
      mode: 'direct',
      model: 'mock-structurer',
      language: 'zh',
    },
  });
}

export async function startRealtimeSession() {
  mockRealtimeProviderConfig();
  return await dispatchMessage(
    {
      type: 'SESSION_START',
      target: 'service-worker',
      payload: { tabId: 123 },
    },
    { tab: { id: 123 } },
  );
}

export async function startExternalRealtimeSession() {
  getProviderConfigMock.mockResolvedValue({
    asr: {
      type: 'external',
      mode: 'direct',
      transport: 'ws',
      endpoint: 'ws://127.0.0.1:15377/ws',
      bridgeProtocol: 'lg-asr-ws-v1',
      bridgeAuthToken: 'bridge-token',
      language: 'zh',
    },
    structurer: {
      type: 'mock',
      mode: 'direct',
      model: 'mock-structurer',
      language: 'zh',
    },
  });

  return await dispatchMessage(
    {
      type: 'SESSION_START',
      target: 'service-worker',
      payload: { tabId: 123 },
    },
    { tab: { id: 123 } },
  );
}

export async function sendStableUtterance(params: {
  text: string;
  startMs: number;
  endMs: number;
  provider?: string;
  finalReason?: 'endpoint' | 'input_finished' | 'manual_flush' | 'vendor_defined';
}) {
  return await dispatchMessage({
    type: 'ASR_STREAM_UTTERANCE_READY',
    target: 'service-worker',
    payload: {
      text: params.text,
      startMs: params.startMs,
      endMs: params.endMs,
      provider: params.provider ?? 'tencent-asr',
      finalReason: params.finalReason,
      raw: { result: { slice_type: 2 } },
    },
  });
}

export async function runInjectedStructurerSession(params: {
  transcripts: Array<{
    chunkId: string;
    text: string;
    startMs: number;
    endMs: number;
    provider?: string;
    transport?: 'batch' | 'ws';
  }>;
  seed?: {
    sessionId?: string;
    sourceType?: 'tab' | 'file';
    transcriptWindow?: Array<{
      chunkId: string;
      sessionId?: string;
      text: string;
      startMs: number;
      endMs: number;
      provider?: string;
      transport?: 'batch' | 'ws';
    }>;
    mergedGraph?: Record<string, unknown>;
    currentTimeMs?: number;
    chunkIndex?: number;
  };
  finalizeSession?: boolean;
}) {
  return await dispatchMessage({
    type: 'TEST_STRUCTURER_SESSION_RUN',
    target: 'service-worker',
    payload: {
      transcripts: params.transcripts.map((transcript) => ({
        sessionId: 'session_injected',
        provider: 'fixture-asr',
        transport: transcript.transport ?? 'batch',
        ...transcript,
      })),
      seed: params.seed
        ? {
            ...params.seed,
            transcriptWindow: params.seed.transcriptWindow?.map((transcript) => ({
              sessionId: 'session_injected',
              provider: 'fixture-asr',
              transport: transcript.transport ?? 'batch',
              ...transcript,
            })),
          }
        : undefined,
      finalizeSession: params.finalizeSession,
    },
  });
}
