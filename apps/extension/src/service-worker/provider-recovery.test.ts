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

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    messageListeners = [];
    storageState = {};
    createRuntimeProvidersMock = vi.fn((config: any) => ({
      config,
      asr: {
        name: 'mock-asr',
        transcribeChunk: vi.fn(async ({ sessionId, startMs, endMs, audio }: any) => ({
          chunkId: `chunk_${startMs}`,
          sessionId,
          text: startMs === 0 ? '第一段恢复前内容' : '第二段恢复后内容',
          startMs,
          endMs,
          provider: 'mock-asr',
          raw: {
            audioSize:
              audio instanceof ArrayBuffer ? audio.byteLength : audio?.size ?? 0,
          },
        })),
        reset: vi.fn(),
      },
      structurer: {
        name: 'mock-structurer',
        extractSegmentGraph: vi.fn(
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
        ),
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
      createMergedGraphRepository: () => ({
        save: vi.fn(async () => undefined),
        getBySession: vi.fn(async () => undefined),
      }),
      createSettingsRepository: () => ({
        getProviderConfig: vi.fn(async () => undefined),
      }),
      db: {
        sessions: {},
        transcriptChunks: {},
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

    await dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [1, 2, 3, 4],
          startMs: 0,
          endMs: 30000,
        },
      },
      { tab: { id: 123 } },
    );

    const onSuspendHandler =
      chromeMock.runtime.onSuspend.addListener.mock.calls.at(-1)?.[0];
    await onSuspendHandler?.();

    vi.resetModules();
    await initializeModule();

    await dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [5, 6, 7, 8],
          startMs: 30000,
          endMs: 60000,
        },
      },
      { tab: { id: 123 } },
    );

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(snapshotResponse.snapshot.graph.nodes[0].text).not.toBe(
      snapshotResponse.snapshot.graph.nodes[1].text,
    );
  });
});
