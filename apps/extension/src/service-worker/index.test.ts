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
  let appendSegmentGraphMock: any;
  let listSegmentGraphsBySessionMock: any;
  let saveMergedGraphMock: any;
  let getMergedGraphBySessionMock: any;
  let getProviderConfigMock: any;
  let createRuntimeProvidersMock: any;
  let asrResetMock: any;
  let structurerResetMock: any;

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
    appendSegmentGraphMock = vi.fn(async () => undefined);
    listSegmentGraphsBySessionMock = vi.fn(async () => []);
    saveMergedGraphMock = vi.fn(async () => undefined);
    getMergedGraphBySessionMock = vi.fn(async () => undefined);
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
    createRuntimeProvidersMock = vi.fn((config: any) => ({
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

  async function bootstrapStructurerWindow() {
    await sendAudioChunk({ startMs: 0, endMs: 10000 });
    await sendAudioChunk({ startMs: 10000, endMs: 20000 });
    return sendAudioChunk({ startMs: 20000, endMs: 30000 });
  }

  async function runInjectedStructurerSession(params: {
    transcripts: Array<{
      chunkId: string;
      text: string;
      startMs: number;
      endMs: number;
      provider?: string;
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
      }>;
      mergedGraph?: any;
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
          ...transcript,
        })),
        seed: params.seed
          ? {
              ...params.seed,
              transcriptWindow: params.seed.transcriptWindow?.map((transcript) => ({
                sessionId: 'session_injected',
                provider: 'fixture-asr',
                ...transcript,
              })),
            }
          : undefined,
        finalizeSession: params.finalizeSession,
      },
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
      expect.objectContaining({
        type: 'START_CAPTURE',
        payload: expect.objectContaining({ transport: 'batch' }),
      }),
    );
  });

  it('腾讯 realtime 配置会把一次性 WebSocket 参数下发给 content script', async () => {
    const chromeMock = (globalThis as any).chrome;
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
      expect.objectContaining({
        type: 'START_CAPTURE',
        payload: expect.objectContaining({
          transport: 'ws',
          tencentRealtime: expect.objectContaining({
            signedUrl: expect.stringContaining('wss://asr.cloud.tencent.com/asr/v2/1250000000?'),
            sampleRate: 16000,
            frameDurationMs: 40,
          }),
        }),
      }),
    );
  });

  it('扩展重载后当前标签页缺少 content script 时，会重新注入并重试启动采集', async () => {
    const chromeMock = (globalThis as any).chrome;
    chromeMock.tabs.sendMessage
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.'),
      )
      .mockResolvedValueOnce({ success: true });

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    expect(startResponse.success).toBe(true);
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 123 },
      files: ['content-script/content-script.js'],
    });
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(2);
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

  it('provider 配置错误会写入 lastProviderError，便于 UI 和快照统一感知', async () => {
    await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    createRuntimeProvidersMock.mockImplementationOnce(() => {
      throw new Error('Tencent ASR provider requires secretId and secretKey (or apiKey) for direct mode');
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
    expect(startResponse.error).toContain('requires secretId and secretKey');

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.state).toBe('idle');
    expect(snapshotResponse.snapshot.lastProviderError).toEqual(
      expect.objectContaining({
        code: 'CONFIG_ERROR',
        provider: 'provider-config',
        retriable: false,
      }),
    );
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

    await bootstrapStructurerWindow();

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

    await sendAudioChunk({
      startMs: 0,
      endMs: 10000,
      audioMimeType: 'audio/wav',
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
    });
    await sendAudioChunk({ startMs: 10000, endMs: 20000 });
    await sendAudioChunk({ startMs: 20000, endMs: 30000 });

    expect(transcribeChunkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        startMs: 0,
        endMs: 10000,
        audio: expect.any(Blob),
      }),
    );
    const transcribeInput = transcribeChunkMock.mock.calls[0]?.[0];
    expect(transcribeInput.audio.type).toBe('audio/wav');
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        transcriptWindow: expect.arrayContaining([
          expect.objectContaining({
            text: 'provider transcript',
            provider: 'mock-asr',
          }),
        ]),
      }),
    );
    expect(extractSegmentGraphMock.mock.calls[0]?.[0].transcriptWindow).toHaveLength(3);
  });

  it('structure-focused 注入链路会绕过 ASR，直接驱动真实 structurer 挂点', async () => {
    const response = await runInjectedStructurerSession({
      transcripts: [
        {
          chunkId: 'chunk_1',
          text: '第一段结构化输入',
          startMs: 0,
          endMs: 10000,
        },
        {
          chunkId: 'chunk_2',
          text: '第二段结构化输入',
          startMs: 10000,
          endMs: 20000,
        },
        {
          chunkId: 'chunk_3',
          text: '第三段结构化输入',
          startMs: 20000,
          endMs: 30000,
        },
      ],
      finalizeSession: false,
    });

    expect(response.success).toBe(true);
    expect(transcribeChunkMock).not.toHaveBeenCalled();
    expect(extractSegmentGraphMock).toHaveBeenCalledTimes(1);
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptWindow: [
          expect.objectContaining({ text: '第一段结构化输入' }),
          expect.objectContaining({ text: '第二段结构化输入' }),
          expect.objectContaining({ text: '第三段结构化输入' }),
        ],
      }),
    );

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });
    expect(snapshotResponse.snapshot.sessionId).toBeTruthy();
    expect(snapshotResponse.snapshot.graph?.nodes.length).toBeGreaterThan(0);
  });

  it('structure-focused 注入链路支持以现有 graph 作为增量上下文', async () => {
    const previousGraph = {
      sessionId: 'session_injected',
      revision: 1,
      topics: [],
      nodes: [
        {
          id: 'existing_node_1',
          type: 'claim',
          text: '已有观点',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
      edges: [],
      updatedAt: 1,
    };

    const response = await runInjectedStructurerSession({
      seed: {
        sessionId: 'session_injected',
        transcriptWindow: [
          {
            chunkId: 'chunk_seed_1',
            text: '已有上下文一',
            startMs: 0,
            endMs: 10000,
          },
          {
            chunkId: 'chunk_seed_2',
            text: '已有上下文二',
            startMs: 10000,
            endMs: 20000,
          },
          {
            chunkId: 'chunk_seed_3',
            text: '已有上下文三',
            startMs: 20000,
            endMs: 30000,
          },
        ],
        mergedGraph: previousGraph,
        currentTimeMs: 30000,
        chunkIndex: 3,
      },
      transcripts: [
        {
          chunkId: 'chunk_4',
          text: '新的增量信息',
          startMs: 30000,
          endMs: 40000,
        },
      ],
    });

    expect(response.success).toBe(true);
    expect(transcribeChunkMock).not.toHaveBeenCalled();
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        previousGraph: expect.objectContaining({
          nodes: [expect.objectContaining({ id: 'existing_node_1' })],
        }),
        transcriptWindow: [
          expect.objectContaining({ text: '已有上下文二' }),
          expect.objectContaining({ text: '已有上下文三' }),
          expect.objectContaining({ text: '新的增量信息' }),
        ],
      }),
    );
  });

  it('structure-focused 导出会在 merged graph 缺失时从 segments 重建 graph', async () => {
    const transcriptRecords = new Map<string, any[]>();
    const segmentRecords = new Map<string, any[]>();

    appendTranscriptChunkMock.mockImplementation(async (chunk: any) => {
      const current = transcriptRecords.get(chunk.sessionId) ?? [];
      transcriptRecords.set(chunk.sessionId, [...current, chunk]);
    });
    listTranscriptChunksBySessionMock.mockImplementation(
      async (sessionId: string) => transcriptRecords.get(sessionId) ?? [],
    );
    appendSegmentGraphMock.mockImplementation(async (segment: any) => {
      const current = segmentRecords.get(segment.sessionId) ?? [];
      segmentRecords.set(segment.sessionId, [...current, segment]);
    });
    listSegmentGraphsBySessionMock.mockImplementation(
      async (sessionId: string) => segmentRecords.get(sessionId) ?? [],
    );
    getMergedGraphBySessionMock.mockResolvedValue(undefined);

    const response = await runInjectedStructurerSession({
      transcripts: [
        {
          chunkId: 'chunk_1',
          text: '第一段结构化输入',
          startMs: 0,
          endMs: 10000,
        },
        {
          chunkId: 'chunk_2',
          text: '第二段结构化输入',
          startMs: 10000,
          endMs: 20000,
        },
        {
          chunkId: 'chunk_3',
          text: '第三段结构化输入',
          startMs: 20000,
          endMs: 30000,
        },
      ],
    });

    expect(response.success).toBe(true);
    getSessionMock.mockResolvedValue({
      sessionId: response.sessionId,
      sourceType: 'file',
      createdAt: 100,
      endedAt: 200,
    });

    const exportResponse = await dispatchMessage({
      type: 'EXPORT_SESSION',
      target: 'service-worker',
      payload: { sessionId: response.sessionId, format: 'json' },
    });
    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId: response.sessionId },
    });

    expect(exportResponse.success).toBe(true);
    expect(exportResponse.exportData.content).toContain('第三段结构化输入');
    expect(debugResponse.success).toBe(true);
    expect(debugResponse.debugData.graph?.nodes.length).toBeGreaterThan(0);
  });

  it('前两个 10 秒 chunk 只累计上下文，不会提前触发 structurer', async () => {
    const chromeMock = (globalThis as any).chrome;

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await sendAudioChunk({ startMs: 0, endMs: 10000 });
    await sendAudioChunk({ startMs: 10000, endMs: 20000 });

    expect(extractSegmentGraphMock).not.toHaveBeenCalled();

    const sentProgressMessages = chromeMock.runtime.sendMessage.mock.calls
      .map((call: any[]) => call[0])
      .filter((message: any) => message?.type === 'PROVIDER_PROGRESS');
    expect(sentProgressMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            stage: 'structurer',
            message: expect.stringContaining('等待 30 秒上下文'),
          }),
        }),
      ]),
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

    await bootstrapStructurerWindow();

    expect(appendTranscriptChunkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: 'chunk_mock',
        text: 'provider transcript',
      }),
    );
    expect(appendSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentId: 'segment_30000',
        topic: 'provider topic',
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

  it('收到腾讯实时稳定句段后会持久化 transcript 并驱动 structurer', async () => {
    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await dispatchMessage({
      type: 'ASR_STREAM_UTTERANCE_READY',
      target: 'service-worker',
      payload: {
        text: '第一句稳定话语',
        startMs: 0,
        endMs: 10000,
        provider: 'tencent-asr',
        raw: { result: { slice_type: 2 } },
      },
    });
    await dispatchMessage({
      type: 'ASR_STREAM_UTTERANCE_READY',
      target: 'service-worker',
      payload: {
        text: '第二句稳定话语',
        startMs: 10000,
        endMs: 20000,
        provider: 'tencent-asr',
        raw: { result: { slice_type: 2 } },
      },
    });
    await dispatchMessage({
      type: 'ASR_STREAM_UTTERANCE_READY',
      target: 'service-worker',
      payload: {
        text: '第三句稳定话语',
        startMs: 20000,
        endMs: 30000,
        provider: 'tencent-asr',
        raw: { result: { slice_type: 2 } },
      },
    });

    expect(appendTranscriptChunkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '第三句稳定话语',
        provider: 'tencent-asr',
        raw: expect.objectContaining({
          transport: 'ws',
        }),
      }),
    );
    expect(extractSegmentGraphMock).toHaveBeenCalledTimes(1);
    expect(saveMergedGraphMock).toHaveBeenCalled();
  });

  it('调试会话会返回 transcript、segment 和逐轮 trace', async () => {
    const storedTranscripts: any[] = [];
    const storedSegments: any[] = [];
    let storedGraph: any;

    appendTranscriptChunkMock.mockImplementation(async (chunk: any) => {
      storedTranscripts.push(chunk);
    });
    listTranscriptChunksBySessionMock.mockImplementation(async (sessionId: string) =>
      storedTranscripts.filter((chunk) => chunk.sessionId === sessionId),
    );
    appendSegmentGraphMock.mockImplementation(async (segment: any) => {
      storedSegments.push(segment);
    });
    listSegmentGraphsBySessionMock.mockImplementation(async (sessionId: string) =>
      storedSegments.filter((segment) => segment.sessionId === sessionId),
    );
    saveMergedGraphMock.mockImplementation(async (graph: any) => {
      storedGraph = graph;
    });
    getMergedGraphBySessionMock.mockImplementation(async (sessionId: string) =>
      storedGraph?.sessionId === sessionId ? storedGraph : undefined,
    );

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );
    const sessionId = startResponse.sessionId;

    await bootstrapStructurerWindow();

    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId },
    });

    expect(debugResponse.success).toBe(true);
    expect(debugResponse.debugData.transcripts).toHaveLength(3);
    expect(debugResponse.debugData.segments).toHaveLength(1);
    expect(debugResponse.debugData.structurerRuns).toHaveLength(1);
    expect(debugResponse.debugData.traces).toHaveLength(3);
    expect(debugResponse.debugData.traces).toEqual([
      expect.objectContaining({
        sequence: 1,
        segment: null,
        structurerRun: null,
      }),
      expect.objectContaining({
        sequence: 2,
        segment: null,
        structurerRun: null,
      }),
      expect.objectContaining({
        sequence: 3,
        transcript: expect.objectContaining({
          chunkId: 'chunk_mock',
          text: 'provider transcript',
        }),
        transcriptWindow: [
          expect.objectContaining({
            chunkId: 'chunk_mock',
          }),
          expect.objectContaining({
            chunkId: 'chunk_mock',
          }),
          expect.objectContaining({
            chunkId: 'chunk_mock',
          }),
        ],
        segment: expect.objectContaining({
          segmentId: 'segment_30000',
          provider: 'mock-structurer',
        }),
        structurerRun: expect.objectContaining({
          segmentId: 'segment_30000',
          status: 'success',
          windowChunkCount: 3,
        }),
        mergedGraphAfter: expect.objectContaining({
          sessionId,
          nodes: expect.arrayContaining([
            expect.objectContaining({
              text: 'provider transcript',
            }),
          ]),
        }),
      }),
    ]);
  });

  it('多个音频 chunk 会串行处理，避免并发触发多个 ASR 请求', async () => {
    let activeTranscribeCalls = 0;
    let maxConcurrentTranscribeCalls = 0;
    let releaseFirstChunk!: () => void;

    transcribeChunkMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            activeTranscribeCalls += 1;
            maxConcurrentTranscribeCalls = Math.max(
              maxConcurrentTranscribeCalls,
              activeTranscribeCalls,
            );
            releaseFirstChunk = () => {
              activeTranscribeCalls -= 1;
              resolve({
                chunkId: 'chunk_serial_1',
                sessionId: 'session_serial',
                text: '第一段',
                startMs: 0,
                endMs: 10000,
                provider: 'mock-asr',
              });
            };
          }),
      )
      .mockImplementationOnce(async () => {
        activeTranscribeCalls += 1;
        maxConcurrentTranscribeCalls = Math.max(
          maxConcurrentTranscribeCalls,
          activeTranscribeCalls,
        );
        activeTranscribeCalls -= 1;
        return {
          chunkId: 'chunk_serial_2',
          sessionId: 'session_serial',
          text: '第二段',
          startMs: 10000,
          endMs: 20000,
          provider: 'mock-asr',
        };
      });

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const firstChunkPromise = dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [1, 2, 3, 4],
          startMs: 0,
          endMs: 10000,
        },
      },
      { tab: { id: 123 } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondChunkPromise = dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [5, 6, 7, 8],
          startMs: 10000,
          endMs: 20000,
        },
      },
      { tab: { id: 123 } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transcribeChunkMock).toHaveBeenCalledTimes(1);

    releaseFirstChunk();

    const firstChunkResponse = await firstChunkPromise;
    const secondChunkResponse = await secondChunkPromise;

    expect(firstChunkResponse.success).toBe(true);
    expect(secondChunkResponse.success).toBe(true);
    expect(transcribeChunkMock).toHaveBeenCalledTimes(2);
    expect(maxConcurrentTranscribeCalls).toBe(1);
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

    const chunkResponse = await bootstrapStructurerWindow();

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

    const chunkResponse = await bootstrapStructurerWindow();
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

    const chunkResponse = await bootstrapStructurerWindow();

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

    await bootstrapStructurerWindow();

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

    await bootstrapStructurerWindow();

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

  it('stop 发生在 transcribing 中途时会中断当前 chunk 并立即清理会话', async () => {
    let rejectTranscribe!: (reason?: unknown) => void;
    transcribeChunkMock.mockImplementationOnce(
      () => new Promise((_, reject) => {
        rejectTranscribe = reject;
      }),
    );
    asrResetMock.mockImplementation(() => {
      if (rejectTranscribe) {
        rejectTranscribe(new Error('Tencent ASR polling aborted for task 9529'));
      }
    });

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

    const stopResponse = await dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId },
    });
    const chunkResponse = await chunkPromise;
    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(chunkResponse.success).toBe(false);
    expect(chunkResponse.error).toContain('停止中');
    expect(stopResponse.success).toBe(true);
    expect(asrResetMock).toHaveBeenCalled();
    expect(saveMergedGraphMock).not.toHaveBeenCalled();
    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
  });

  it('stop 会等待实时链路上 structuring 挂起结束后再清理，且停止后快照仍含合并后的图谱', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await bootstrapStructurerWindow();

    let finishStructurer!: (value: unknown) => void;
    extractSegmentGraphMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStructurer = resolve;
        }),
    );

    const chunk4Promise = sendAudioChunk({ startMs: 30000, endMs: 40000 });

    await vi.waitFor(() => {
      expect(extractSegmentGraphMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const stopPromise = dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId },
    });
    await Promise.resolve();

    finishStructurer!({
      segmentId: 'segment_40000',
      sessionId: startResponse.sessionId,
      startMs: 30000,
      endMs: 40000,
      topic: 'provider topic',
      provider: 'mock-structurer',
      nodes: [
        {
          id: 'segment_40000:node_4',
          type: 'claim',
          text: '第四段',
          timestampMs: 30000,
          status: 'confirmed',
          evidenceChunkIds: ['chunk_mock'],
        },
      ],
      edges: [],
    });

    const [stopResult, chunk4Result] = await Promise.all([stopPromise, chunk4Promise]);

    expect(stopResult.success).toBe(true);
    expect(chunk4Result.success).toBe(true);

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.state).toBe('idle');
    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.graph?.nodes?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('stop 先发出而最后一个 chunk 后到时，会直接丢弃该 chunk 并完成清理', async () => {
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

    expect(lateChunkResponse.success).toBe(false);
    expect(lateChunkResponse.error).toContain('停止或进入错误状态');
    expect(stopResponse.success).toBe(true);
    expect(saveMergedGraphMock).not.toHaveBeenCalled();
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

    await bootstrapStructurerWindow();

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

    await bootstrapStructurerWindow();

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
