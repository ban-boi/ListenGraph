import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Service Worker - provider recovery', () => {
  let messageListeners: Array<
    (message: any, sender: any, sendResponse: (response: any) => void) => boolean | void
  > = [];
  let dispatchMessage: (
    message: any,
    sender?: { tab?: { id: number } },
  ) => Promise<any>;
  let storageState: Record<string, unknown> = {};
  let createRuntimeProvidersMock: any;
  /** 与 worker 内 structurerProvider 同一引用，便于断言调用次数（勿在 factory 内联 new vi.fn，否则易与 runtime 脱节） */
  let extractSegmentGraphMock: any;
  let transcribeChunkMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    messageListeners = [];
    storageState = {};

    transcribeChunkMock = vi.fn(async ({ sessionId, startMs, endMs, audio }: any) => ({
      chunkId: `chunk_${startMs}`,
      sessionId,
      text: `恢复片段@${startMs}-${endMs}`,
      startMs,
      endMs,
      provider: 'mock-asr',
      raw: {
        audioSize:
          audio instanceof ArrayBuffer ? audio.byteLength : audio?.size ?? 0,
      },
    }));

    extractSegmentGraphMock = vi.fn(
      async ({ sessionId, transcriptWindow, previousGraph }: any) => ({
        segmentId: `segment_${transcriptWindow.length}`,
        sessionId,
        startMs: transcriptWindow[transcriptWindow.length - 1].startMs,
        endMs: transcriptWindow[transcriptWindow.length - 1].endMs,
        topic: '恢复测试主题',
        provider: 'mock-structurer',
        nodes: [
          {
            id: `node_${transcriptWindow.length}`,
            type: 'claim',
            text: transcriptWindow[transcriptWindow.length - 1].text,
            timestampMs: transcriptWindow[transcriptWindow.length - 1].startMs,
            status: 'confirmed',
            evidenceChunkIds: [transcriptWindow[transcriptWindow.length - 1].chunkId],
          },
        ],
        edges:
          previousGraph?.nodes?.length > 0
            ? [
                {
                  id: 'edge_mock',
                  source: previousGraph.nodes[previousGraph.nodes.length - 1].id,
                  target: `node_${transcriptWindow.length}`,
                  type: 'supports',
                  evidenceChunkIds: [
                    transcriptWindow[transcriptWindow.length - 1].chunkId,
                  ],
                },
              ]
            : [],
      }),
    );

    createRuntimeProvidersMock = vi.fn((config: any) => ({
      config,
      asr: {
        name: 'mock-asr',
        transcribeChunk: transcribeChunkMock,
        reset: vi.fn(),
      },
      structurer: {
        name: 'mock-structurer',
        extractSegmentGraph: extractSegmentGraphMock,
        reset: vi.fn(),
      },
    }));

    await initializeModule();
  });

  async function initializeModule() {
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
      normalizeProviderConfig: (config: any) => config,
      createProviderRegistry: () => ({
        createRuntimeProviders: createRuntimeProvidersMock,
      }),
      TencentAsrProvider: class {},
      redactProviderConfig: (config: any) => ({
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
        toJSON() {
          return {
            code: 'TRANSCRIBE_ERROR',
            message: this.message,
            provider: 'mock-asr',
            stage: 'asr',
            retriable: false,
          };
        }
      },
    }));
    vi.doMock('@listen-graphic/storage', () => ({
      createSessionRepository: () => ({
        save: vi.fn(async () => undefined),
        get: vi.fn(async () => undefined),
        listRecent: vi.fn(async () => []),
        markEnded: vi.fn(async () => undefined),
      }),
      createTranscriptChunkRepository: () => ({
        append: vi.fn(async () => undefined),
        listBySession: vi.fn(async () => []),
      }),
      createSegmentGraphRepository: () => ({
        append: vi.fn(async () => undefined),
        listBySession: vi.fn(async () => []),
      }),
      createMergedGraphRepository: () => ({
        save: vi.fn(async () => undefined),
        getBySession: vi.fn(async () => undefined),
      }),
      createSettingsRepository: () => ({
        getProviderConfig: vi.fn(async () => ({
          asr: { type: 'mock', mode: 'direct', model: 'mock-asr', language: 'zh' },
          structurer: {
            type: 'mock',
            mode: 'direct',
            model: 'mock-structurer',
            language: 'zh',
          },
        })),
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

    chromeMock.runtime.onMessage.addListener.mockImplementation((listener: any) => {
      messageListeners.push(listener);
    });
    chromeMock.runtime.sendMessage.mockImplementation(
      (message: any, callback?: (response: any) => void) => {
        const sendResponse = (response: any) => {
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

    await import('./index');

    dispatchMessage = (message, sender = { tab: { id: 1 } }) =>
      new Promise((resolve) => {
        const listener = messageListeners[0];
        listener(message, sender, resolve);
      });
  }

  async function sendAudioChunk(params: {
    startMs: number;
    endMs: number;
    tabId?: number;
  }) {
    return dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [1, 2, 3, 4],
          startMs: params.startMs,
          endMs: params.endMs,
        },
      },
      { tab: { id: params.tabId ?? 123 } },
    );
  }

  /** 与主链路 index.test 一致：第三条音频后才满足 bootstrap，首次写入 mergedGraph */
  async function bootstrapMergedGraph() {
    await sendAudioChunk({ startMs: 0, endMs: 10_000 });
    await sendAudioChunk({ startMs: 10_000, endMs: 20_000 });
    await sendAudioChunk({ startMs: 20_000, endMs: 30_000 });
  }

  it('worker 重载后继续处理 chunk 时不会让 mock provider 序列回到起点', async () => {
    const chromeMock = (globalThis as any).chrome;

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await bootstrapMergedGraph();

    const peekAfterBootstrap = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });
    expect(extractSegmentGraphMock).toHaveBeenCalled();
    expect(peekAfterBootstrap.snapshot.graph?.nodes?.length ?? 0).toBeGreaterThan(0);

    const onSuspendHandler =
      chromeMock.runtime.onSuspend.addListener.mock.calls.at(-1)?.[0];
    await onSuspendHandler?.();

    // onSuspend 里是 void ensureHydrated().then(() => persistRuntimeState())，须等落盘后再重载模块
    const runtimeKey = 'listen-graphic-runtime-state';
    await vi.waitFor(() => {
      const payload = storageState[runtimeKey] as
        | { mergedGraph?: { nodes?: unknown[] } }
        | undefined;
      expect(payload?.mergedGraph?.nodes?.length ?? 0).toBeGreaterThan(0);
    });

    vi.resetModules();
    await initializeModule();

    await sendAudioChunk({ startMs: 30_000, endMs: 40_000 });

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    const graph = snapshotResponse.snapshot.graph;
    expect(graph).not.toBeNull();
    expect(graph!.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph!.nodes[0].text).not.toBe(graph!.nodes[1].text);
  });
});
