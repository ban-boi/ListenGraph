import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Service Worker - 当前主链路', () => {
  let messageListeners: Array<
    (message: any, sender: any, sendResponse: (response: any) => void) => boolean | void
  > = [];
  let dispatchMessage: (
    message: any,
    sender?: { tab?: { id: number } },
  ) => Promise<any>;
  let storageState: Record<string, unknown> = {};
  let transcribeChunkMock: any;
  let extractSegmentGraphMock: any;
  let saveSessionMock: any;
  let getSessionMock: any;
  let listRecentSessionsMock: any;
  let markEndedMock: any;
  let appendTranscriptChunkMock: any;
  let listTranscriptChunksBySessionMock: any;
  let saveMergedGraphMock: any;
  let getMergedGraphBySessionMock: any;
  let getProviderConfigMock: any;
  let createRuntimeProvidersMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    messageListeners = [];
    storageState = {};
    transcribeChunkMock = vi.fn(async ({ sessionId, startMs, endMs, audio }: any) => ({
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
      async ({ sessionId, transcriptWindow, previousGraph }: any) => ({
        segmentId: 'segment_mock',
        sessionId,
        startMs: transcriptWindow[transcriptWindow.length - 1].startMs,
        endMs: transcriptWindow[transcriptWindow.length - 1].endMs,
        topic: 'provider topic',
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
    saveMergedGraphMock = vi.fn(async () => undefined);
    getMergedGraphBySessionMock = vi.fn(async () => undefined);
    getProviderConfigMock = vi.fn(async () => undefined);
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
      createProviderRegistry: () => ({
        createRuntimeProviders: createRuntimeProvidersMock,
      }),
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
      createMergedGraphRepository: () => ({
        save: saveMergedGraphMock,
        getBySession: getMergedGraphBySessionMock,
      }),
      createSettingsRepository: () => ({
        getProviderConfig: getProviderConfigMock,
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

  it('注册扩展生命周期监听器', () => {
    const chromeMock = (globalThis as any).chrome;
    expect(chromeMock.runtime.onInstalled.addListener).toHaveBeenCalled();
    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalled();
    expect(chromeMock.runtime.onSuspend.addListener).toHaveBeenCalled();
    expect(chromeMock.action.onClicked.addListener).toHaveBeenCalled();
  });

  it('启动会话时会通知 content script 开始捕获', async () => {
    const chromeMock = (globalThis as any).chrome;
    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      123,
      expect.objectContaining({ type: 'START_CAPTURE' }),
    );
  });

  it('启动会话时会写入 session 资产记录', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    expect(startResponse.success).toBe(true);
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: startResponse.sessionId,
        sourceType: 'tab',
        createdAt: expect.any(Number),
      }),
    );
  });

  it('如果 session 资产写入失败，会回滚 worker 状态并反向停止 content script 采集', async () => {
    const chromeMock = (globalThis as any).chrome;
    saveSessionMock.mockRejectedValueOnce(new Error('session db unavailable'));

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    expect(startResponse.success).toBe(false);
    expect(chromeMock.tabs.sendMessage).toHaveBeenNthCalledWith(
      2,
      123,
      expect.objectContaining({ type: 'STOP_CAPTURE' }),
    );

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });
    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
  });

  it('如果 content script 拒绝非标签页共享目标，会回滚会话状态', async () => {
    const chromeMock = (globalThis as any).chrome;
    chromeMock.tabs.sendMessage.mockResolvedValueOnce({
      success: false,
      error: '请选择浏览器标签页作为共享目标，而不是整个窗口或屏幕',
    });

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    expect(startResponse.success).toBe(false);
    expect(startResponse.error).toContain('请选择浏览器标签页');

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });
    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
  });

  it('收到音频 chunk 后会广播 transcript 与 graph 更新', async () => {
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

    const sentMessageTypes = chromeMock.runtime.sendMessage.mock.calls.map(
      (call: any[]) => call[0]?.type,
    );
    expect(sentMessageTypes).toContain('TRANSCRIPT_READY');
    expect(sentMessageTypes).toContain('MERGED_GRAPH_UPDATED');
  });

  it('收到音频 chunk 后会通过 providers 契约处理 transcript 与 segment', async () => {
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

    expect(transcribeChunkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        startMs: 0,
        endMs: 30000,
        audio: expect.any(ArrayBuffer),
      }),
    );
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        transcriptWindow: [
          expect.objectContaining({
            text: 'provider transcript',
            provider: 'mock-asr',
          }),
        ],
      }),
    );
  });

  it('收到音频 chunk 后会持久化 transcript 与 merged graph 资产', async () => {
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

    expect(appendTranscriptChunkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: 'chunk_mock',
        text: 'provider transcript',
      }),
    );
    expect(saveMergedGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            text: 'provider transcript',
          }),
        ]),
      }),
    );
  });

  it('如果 transcript 落库失败，不会推进 runtime transcript 与时间状态', async () => {
    appendTranscriptChunkMock.mockRejectedValueOnce(new Error('chunk db unavailable'));

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkResponse = await dispatchMessage(
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

    expect(chunkResponse.success).toBe(false);
    expect(extractSegmentGraphMock).not.toHaveBeenCalled();

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });
    expect(snapshotResponse.snapshot.currentTimeMs).toBe(0);
    expect(snapshotResponse.snapshot.graph).toBeNull();
  });

  it('IndexedDB backing store 短暂失败时会重试 transcript 落库', async () => {
    appendTranscriptChunkMock
      .mockRejectedValueOnce(
        new Error('UnknownError Internal error opening backing store for indexedDB.open.'),
      )
      .mockResolvedValueOnce(undefined);

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkResponse = await dispatchMessage(
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

    expect(chunkResponse.success).toBe(true);
    expect(appendTranscriptChunkMock).toHaveBeenCalledTimes(2);
  });

  it('IndexedDB backing store 持续失败时仍会保留内存态 graph，避免主链路直接中断', async () => {
    appendTranscriptChunkMock.mockRejectedValue(
      new Error('UnknownError Internal error opening backing store for indexedDB.open.'),
    );
    saveMergedGraphMock.mockRejectedValue(
      new Error('UnknownError Internal error opening backing store for indexedDB.open.'),
    );

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkResponse = await dispatchMessage(
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

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(chunkResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.currentTimeMs).toBe(30000);
    expect(snapshotResponse.snapshot.graph?.nodes[0]?.text).toBe('provider transcript');
  });

  it('runtime state 持久化命中 backing store 异常时不会中断 chunk 处理', async () => {
    const chromeMock = (globalThis as any).chrome;

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );
    chromeMock.storage.session.set.mockRejectedValueOnce(
      new Error('UnknownError Internal error opening backing store for indexedDB.open.'),
    );

    const chunkResponse = await dispatchMessage(
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
    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(chunkResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.graph?.nodes[0]?.text).toBe('provider transcript');
  });

  it('如果 merged graph 落库失败，不会把未落盘 graph 暴露到 runtime snapshot', async () => {
    saveMergedGraphMock.mockRejectedValueOnce(new Error('graph db unavailable'));

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkResponse = await dispatchMessage(
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

    expect(chunkResponse.success).toBe(false);

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });
    expect(snapshotResponse.snapshot.graph).toBeNull();
    expect(snapshotResponse.snapshot.currentTimeMs).toBe(30000);
  });

  it('节点点击时会把跳转请求转发给原始 tab', async () => {
    const chromeMock = (globalThis as any).chrome;

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );
    const sessionId = startResponse.sessionId as string;

    await dispatchMessage(
      {
        type: 'NODE_CLICKED',
        target: 'service-worker',
        payload: {
          sessionId,
          nodeId: 'n1',
          timestampMs: 15000,
        },
      },
      { tab: { id: 123 } },
    );

    expect(chromeMock.tabs.sendMessage.mock.calls).toEqual(
      expect.arrayContaining([
        [
          123,
          expect.objectContaining({
            type: 'SEEK_TO_TIMESTAMP',
            payload: expect.objectContaining({ timestampMs: 15000 }),
          }),
        ],
      ]),
    );
  });

  it('可以返回当前运行时快照供 sidepanel 冷启动恢复', async () => {
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

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.state).toBe('capturing');
    expect(snapshotResponse.snapshot.graph?.nodes.length).toBeGreaterThan(0);
    expect(snapshotResponse.snapshot.currentView).toBeDefined();
  });

  it('收到 CAPTURE_ENDED 后会清理活动会话', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const sessionId = startResponse.sessionId as string;

    await dispatchMessage(
      {
        type: 'CAPTURE_ENDED',
        target: 'service-worker',
        payload: { reason: 'share-ended' },
      },
      { tab: { id: 123 } },
    );

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');

    const stopResponse = await dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId },
    });
    expect(stopResponse.success).toBe(true);
  });

  it('会话结束时会标记 session 资产已结束', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await dispatchMessage(
      {
        type: 'CAPTURE_ENDED',
        target: 'service-worker',
        payload: { reason: 'share-ended' },
      },
      { tab: { id: 123 } },
    );

    expect(markEndedMock).toHaveBeenCalledWith(
      startResponse.sessionId,
      expect.any(Number),
    );
  });

  it('即使 markEnded 失败，也会完成内存态与 runtime state 清理', async () => {
    markEndedMock.mockRejectedValueOnce(new Error('db unavailable'));

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
        type: 'CAPTURE_ENDED',
        target: 'service-worker',
        payload: { reason: 'share-ended' },
      },
      { tab: { id: 123 } },
    );

    expect(storageState['listen-graphic-runtime-state']).toEqual(
      expect.objectContaining({
        pendingSessionFinalize: expect.objectContaining({
          sessionId: expect.any(String),
          endedAt: expect.any(Number),
        }),
      }),
    );

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
    expect(markEndedMock).toHaveBeenCalledTimes(2);
    expect(storageState['listen-graphic-runtime-state']).toBeUndefined();
  });

  it('worker 重载后仍可从持久化状态恢复快照', async () => {
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

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.sessionId).toBeTruthy();
    expect(snapshotResponse.snapshot.state).toBe('capturing');
    expect(snapshotResponse.snapshot.currentTimeMs).toBe(30000);
    expect(snapshotResponse.snapshot.graph?.nodes.length).toBeGreaterThan(0);
  });

  it('runtime state 丢失时会从 storage 恢复最近会话资产', async () => {
    storageState = {};
    listRecentSessionsMock.mockResolvedValue([
      {
        sessionId: 'session_recovered',
        sourceType: 'tab',
        createdAt: 100,
        endedAt: 120,
      },
    ]);
    listTranscriptChunksBySessionMock.mockResolvedValue([
      {
        chunkId: 'chunk_1',
        sessionId: 'session_recovered',
        text: '第一段',
        startMs: 0,
        endMs: 30000,
        provider: 'mock-asr',
      },
      {
        chunkId: 'chunk_2',
        sessionId: 'session_recovered',
        text: '第二段',
        startMs: 30000,
        endMs: 60000,
        provider: 'mock-asr',
      },
    ]);
    getMergedGraphBySessionMock.mockResolvedValue({
      sessionId: 'session_recovered',
      revision: 2,
      topics: [],
      nodes: [
        {
          id: 'node_1',
          type: 'claim',
          text: '恢复的节点',
          timestampMs: 30000,
          status: 'confirmed',
        },
      ],
      edges: [],
      viewHints: {
        defaultView: 'timeline',
      },
      updatedAt: 200,
    });

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.sessionId).toBe('session_recovered');
    expect(snapshotResponse.snapshot.graph?.nodes[0]?.text).toBe('恢复的节点');
    expect(snapshotResponse.snapshot.currentTimeMs).toBe(60000);
    expect(snapshotResponse.snapshot.currentView).toBe('timeline');
  });

  it('runtime state 丢失时只会恢复最近一个已结束会话的资产', async () => {
    storageState = {};
    listRecentSessionsMock.mockResolvedValue([
      {
        sessionId: 'session_active_like',
        sourceType: 'tab',
        createdAt: 200,
      },
      {
        sessionId: 'session_ended',
        sourceType: 'tab',
        createdAt: 100,
        endedAt: 150,
      },
    ]);
    listTranscriptChunksBySessionMock.mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session_ended') {
        return [
          {
            chunkId: 'chunk_ended',
            sessionId,
            text: '已结束会话',
            startMs: 0,
            endMs: 30000,
            provider: 'mock-asr',
          },
        ];
      }
      return [
        {
          chunkId: 'chunk_active_like',
          sessionId,
          text: '不应该被恢复',
          startMs: 0,
          endMs: 30000,
          provider: 'mock-asr',
        },
      ];
    });
    getMergedGraphBySessionMock.mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session_ended') {
        return {
          sessionId,
          revision: 1,
          topics: [],
          nodes: [
            {
              id: 'node_ended',
              type: 'claim',
              text: '只恢复已结束会话',
              timestampMs: 0,
              status: 'confirmed',
            },
          ],
          edges: [],
          viewHints: {
            defaultView: 'causal',
          },
          updatedAt: 150,
        };
      }
      return {
        sessionId,
        revision: 1,
        topics: [],
        nodes: [
          {
            id: 'node_active_like',
            type: 'claim',
            text: '不应该被恢复',
            timestampMs: 0,
            status: 'confirmed',
          },
        ],
        edges: [],
        viewHints: {
          defaultView: 'timeline',
        },
        updatedAt: 200,
      };
    });

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.sessionId).toBe('session_ended');
    expect(snapshotResponse.snapshot.graph?.nodes[0]?.text).toBe('只恢复已结束会话');
    expect(listTranscriptChunksBySessionMock).toHaveBeenCalledWith('session_ended');
    expect(getMergedGraphBySessionMock).toHaveBeenCalledWith('session_ended');
  });

  it('可以导出当前会话的 JSON 资产', async () => {
    getSessionMock.mockResolvedValue({
      sessionId: 'session_export',
      sourceType: 'tab',
      createdAt: 100,
      endedAt: 200,
    });
    listTranscriptChunksBySessionMock.mockResolvedValue([
      {
        chunkId: 'chunk_export',
        sessionId: 'session_export',
        text: '导出文本',
        startMs: 0,
        endMs: 30000,
        provider: 'mock-asr',
      },
    ]);
    getMergedGraphBySessionMock.mockResolvedValue({
      sessionId: 'session_export',
      revision: 1,
      topics: [],
      nodes: [
        {
          id: 'node_export',
          type: 'claim',
          text: '导出节点',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
      edges: [],
      viewHints: {
        defaultView: 'timeline',
      },
      updatedAt: 200,
    });

    const exportResponse = await dispatchMessage({
      type: 'EXPORT_SESSION',
      target: 'service-worker',
      payload: { sessionId: 'session_export', format: 'json' },
    });

    expect(exportResponse.success).toBe(true);
    expect(exportResponse.exportData.filename).toContain('session_export');
    expect(exportResponse.exportData.mimeType).toBe('application/json');
    expect(exportResponse.exportData.content).toContain('"sessionId": "session_export"');
    expect(exportResponse.exportData.content).toContain('"导出文本"');
    expect(exportResponse.exportData.content).toContain('"导出节点"');
  });

  it('缺少 graph 资产时不会导出 Mermaid', async () => {
    getSessionMock.mockResolvedValue({
      sessionId: 'session_without_graph',
      sourceType: 'tab',
      createdAt: 100,
      endedAt: 200,
    });
    listTranscriptChunksBySessionMock.mockResolvedValue([]);
    getMergedGraphBySessionMock.mockResolvedValue(undefined);

    const exportResponse = await dispatchMessage({
      type: 'EXPORT_SESSION',
      target: 'service-worker',
      payload: { sessionId: 'session_without_graph', format: 'mermaid' },
    });

    expect(exportResponse.success).toBe(false);
    expect(exportResponse.error).toContain('graph');
  });

  it('当前会话处于 transcribing 时不会导出不一致快照', async () => {
    let resolveTranscribe!: (value: any) => void;
    transcribeChunkMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscribe = resolve;
        }),
    );

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkPromise = dispatchMessage(
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    const exportResponse = await dispatchMessage({
      type: 'EXPORT_SESSION',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId, format: 'json' },
    });

    resolveTranscribe({
      chunkId: 'chunk_after_export_attempt',
      sessionId: startResponse.sessionId,
      text: '稍后完成',
      startMs: 0,
      endMs: 30000,
      provider: 'mock-asr',
    });
    await chunkPromise;

    expect(exportResponse.success).toBe(false);
    expect(exportResponse.error).toContain('处理中');
  });

  it('可以返回当前会话的 debug 资产快照', async () => {
    getSessionMock.mockResolvedValue({
      sessionId: 'session_debug',
      sourceType: 'tab',
      createdAt: 100,
      endedAt: 200,
    });
    listTranscriptChunksBySessionMock.mockResolvedValue([
      {
        chunkId: 'chunk_debug_1',
        sessionId: 'session_debug',
        text: '第一段调试转写',
        startMs: 0,
        endMs: 30000,
        provider: 'mock-asr',
      },
    ]);
    getMergedGraphBySessionMock.mockResolvedValue({
      sessionId: 'session_debug',
      revision: 1,
      topics: [],
      nodes: [
        {
          id: 'node_debug',
          type: 'claim',
          text: '调试节点',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
      edges: [],
      viewHints: {
        defaultView: 'timeline',
      },
      updatedAt: 200,
    });

    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId: 'session_debug' },
    });

    expect(debugResponse.success).toBe(true);
    expect(debugResponse.debugData.session.sessionId).toBe('session_debug');
    expect(debugResponse.debugData.transcripts).toHaveLength(1);
    expect(debugResponse.debugData.graph.nodes[0].text).toBe('调试节点');
  });

  it('可以返回会话回放所需的 transcript 和时长', async () => {
    getSessionMock.mockResolvedValue({
      sessionId: 'session_replay',
      sourceType: 'tab',
      createdAt: 100,
      endedAt: 200,
    });
    listTranscriptChunksBySessionMock.mockResolvedValue([
      {
        chunkId: 'chunk_replay_1',
        sessionId: 'session_replay',
        text: '第一段回放转写',
        startMs: 0,
        endMs: 30000,
        provider: 'mock-asr',
      },
      {
        chunkId: 'chunk_replay_2',
        sessionId: 'session_replay',
        text: '第二段回放转写',
        startMs: 30000,
        endMs: 60000,
        provider: 'mock-asr',
      },
    ]);
    getMergedGraphBySessionMock.mockResolvedValue({
      sessionId: 'session_replay',
      revision: 1,
      topics: [],
      nodes: [
        {
          id: 'node_replay',
          type: 'claim',
          text: '回放节点',
          timestampMs: 30000,
          status: 'confirmed',
        },
      ],
      edges: [],
      viewHints: {
        defaultView: 'timeline',
      },
      updatedAt: 200,
    });

    const replayResponse = await dispatchMessage({
      type: 'GET_REPLAY_SESSION',
      target: 'service-worker',
      payload: { sessionId: 'session_replay' },
    });

    expect(replayResponse.success).toBe(true);
    expect(replayResponse.replayData.session.sessionId).toBe('session_replay');
    expect(replayResponse.replayData.transcripts).toHaveLength(2);
    expect(replayResponse.replayData.durationMs).toBe(60000);
    expect(replayResponse.replayData.graph.nodes[0].text).toBe('回放节点');
  });

  it('stop 发生在 transcribing 中途时会等待当前 chunk 收口后再清理会话', async () => {
    let resolveTranscribe!: (value: any) => void;
    transcribeChunkMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscribe = resolve;
        }),
    );

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkPromise = dispatchMessage(
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stopPromise = dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId },
    });

    resolveTranscribe({
      chunkId: 'chunk_stop_race',
      sessionId: startResponse.sessionId,
      text: '停止前最后一段',
      startMs: 0,
      endMs: 30000,
      provider: 'mock-asr',
    });

    const chunkResponse = await chunkPromise;
    const stopResponse = await stopPromise;
    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(chunkResponse.success).toBe(true);
    expect(stopResponse.success).toBe(true);
    expect(saveMergedGraphMock).toHaveBeenCalled();
    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
  });

  it('stop 先发出而最后一个 chunk 后到时，仍会在清理前收口该 chunk', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const stopPromise = dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId },
    });

    const lateChunkResponse = await dispatchMessage(
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
    const stopResponse = await stopPromise;
    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(lateChunkResponse.success).toBe(true);
    expect(stopResponse.success).toBe(true);
    expect(saveMergedGraphMock).toHaveBeenCalled();
    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
  });

  it('停止请求如果带着旧 sessionId，不会误清理当前活动会话', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const stopResponse = await dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId: 'session_stale' },
    });
    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(stopResponse.success).toBe(false);
    expect(stopResponse.error).toContain('不匹配');
    expect(markEndedMock).not.toHaveBeenCalled();
    expect(snapshotResponse.snapshot.sessionId).toBe(startResponse.sessionId);
    expect(snapshotResponse.snapshot.state).toBe('capturing');
  });

  it('worker 重载后仍会恢复用户手选视图', async () => {
    const chromeMock = (globalThis as any).chrome;

    const startResponse = await dispatchMessage(
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

    await dispatchMessage({
      type: 'VIEW_SELECTED',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId, view: 'timeline' },
    });

    const onSuspendHandler =
      chromeMock.runtime.onSuspend.addListener.mock.calls.at(-1)?.[0];
    await onSuspendHandler?.();

    vi.resetModules();
    await initializeModule();

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.currentView).toBe('timeline');
    expect(snapshotResponse.snapshot.currentViewPinned).toBe(true);
  });

  it('worker 重载后若标签页被关闭，仍会清理持久化会话', async () => {
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

    const onRemovedHandler =
      chromeMock.tabs.onRemoved.addListener.mock.calls.at(-1)?.[0];
    await onRemovedHandler?.(123);

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
  });
});
