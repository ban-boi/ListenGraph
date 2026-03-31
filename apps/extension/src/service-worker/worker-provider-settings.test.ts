import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Service Worker - provider settings', () => {
  let messageListeners: Array<
    (message: any, sender: any, sendResponse: (response: any) => void) => boolean | void
  > = [];
  let dispatchMessage: (
    message: any,
    sender?: { tab?: { id: number } },
  ) => Promise<any>;
  let storageState: Record<string, unknown> = {};
  let getProviderConfigMock: any;
  let saveProviderConfigMock: any;
  let clearProviderSecretsMock: any;
  let createRuntimeProvidersMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    messageListeners = [];
    storageState = {};
    getProviderConfigMock = vi.fn(async () => ({
      asr: {
        type: 'openai',
        mode: 'direct',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'asr-secret',
        model: 'gpt-4o-mini-transcribe',
        language: 'zh',
      },
      structurer: {
        type: 'openai',
        mode: 'direct',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'structurer-secret',
        model: 'gpt-4.1-mini',
        language: 'zh',
      },
    }));
    saveProviderConfigMock = vi.fn(async () => undefined);
    clearProviderSecretsMock = vi.fn(async () => undefined);
    createRuntimeProvidersMock = vi.fn((config: unknown) => ({
      config,
      asr: {
        name: 'openai-asr',
        transcribeChunk: vi.fn(async ({ sessionId, startMs, endMs }: any) => ({
          chunkId: 'chunk_1',
          sessionId,
          text: '真实 provider transcript',
          startMs,
          endMs,
          provider: 'openai-asr',
        })),
      },
      structurer: {
        name: 'openai-structurer',
        extractSegmentGraph: vi.fn(
          async ({ sessionId, transcriptWindow }: any) => ({
            segmentId: 'segment_1',
            sessionId,
            startMs: transcriptWindow[0].startMs,
            endMs: transcriptWindow[0].endMs,
            topic: '真实 provider 主题',
            provider: 'openai-structurer',
            nodes: [
              {
                id: 'node_1',
                type: 'claim',
                text: transcriptWindow[0].text,
                timestampMs: transcriptWindow[0].startMs,
                status: 'confirmed',
              },
            ],
            edges: [],
          }),
        ),
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
        constructor(message: string) {
          super(message);
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
        getProviderConfig: getProviderConfigMock,
        saveProviderConfig: saveProviderConfigMock,
        clearProviderSecrets: clearProviderSecretsMock,
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

    await import('./index');

    dispatchMessage = (message, sender = { tab: { id: 1 } }) =>
      new Promise((resolve) => {
        const listener = messageListeners[0];
        listener(message, sender, resolve);
      });
  }

  it('启动会话前会读取本地 provider 配置并记录运行时摘要', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(startResponse.success).toBe(true);
    expect(getProviderConfigMock).toHaveBeenCalled();
    expect(createRuntimeProvidersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        asr: expect.objectContaining({
          type: 'openai',
        }),
      }),
    );
    expect(snapshotResponse.snapshot.providerSummary).toEqual(
      expect.objectContaining({
        asr: expect.objectContaining({
          type: 'openai',
          apiKeyConfigured: true,
        }),
      }),
    );
  });

  it('provider 配置非法时会阻止会话启动并返回配置错误', async () => {
    createRuntimeProvidersMock.mockImplementation(() => {
      throw new Error('ASR provider requires an API key for direct mode');
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
    expect(startResponse.error).toContain('API key');
  });

  it('启动时读取到历史 relay 配置，也会按 direct 形态加载 runtime', async () => {
    getProviderConfigMock.mockResolvedValue({
      asr: {
        type: 'openai',
        mode: 'relay',
        endpoint: 'https://api.openai.com/v1',
        sessionToken: 'relay-asr-token',
        model: 'gpt-4o-mini-transcribe',
        language: 'zh',
      },
      structurer: {
        type: 'openai',
        mode: 'relay',
        endpoint: 'https://api.openai.com/v1',
        sessionToken: 'relay-structurer-token',
        model: 'gpt-4.1-mini',
        language: 'zh',
      },
    });
    createRuntimeProvidersMock.mockClear();

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    expect(startResponse.success).toBe(true);
    expect(createRuntimeProvidersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        asr: expect.objectContaining({
          mode: 'direct',
          sessionToken: undefined,
        }),
        structurer: expect.objectContaining({
          mode: 'direct',
          sessionToken: undefined,
        }),
      }),
    );
  });

  it('可以读取并保存 provider 设置', async () => {
    const getResponse = await dispatchMessage({
      type: 'GET_PROVIDER_SETTINGS',
      target: 'service-worker',
      payload: {},
    });

    expect(getResponse.success).toBe(true);
    expect(getResponse.config.asr.type).toBe('openai');
    expect(getResponse.config.asr.apiKey).toBeUndefined();

    await dispatchMessage({
      type: 'SAVE_PROVIDER_SETTINGS',
      target: 'service-worker',
      payload: {
        config: {
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
        },
      },
    });

    expect(saveProviderConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        asr: expect.objectContaining({
          type: 'mock',
        }),
      }),
    );
  });

  it('保存设置失败时不会把无效配置写入本地 settings', async () => {
    createRuntimeProvidersMock.mockImplementation(() => {
      throw new Error('Tencent ASR provider requires secretId and secretKey (or apiKey) for direct mode');
    });

    const response = await dispatchMessage({
      type: 'SAVE_PROVIDER_SETTINGS',
      target: 'service-worker',
      payload: {
        config: {
          asr: {
            type: 'tencent',
            mode: 'direct',
            region: 'ap-shanghai',
            language: 'zh',
          },
          structurer: {
            type: 'mock',
            mode: 'direct',
            model: 'mock-structurer',
            language: 'zh',
          },
        },
      },
    });

    expect(response.success).toBe(false);
    expect(saveProviderConfigMock).not.toHaveBeenCalled();
  });

  it('持久化 provider 设置失败时不会污染当前 runtime provider', async () => {
    saveProviderConfigMock.mockRejectedValueOnce(new Error('settings db unavailable'));

    const response = await dispatchMessage({
      type: 'SAVE_PROVIDER_SETTINGS',
      target: 'service-worker',
      payload: {
        config: {
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
        },
      },
    });

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(response.success).toBe(false);
    expect(snapshotResponse.snapshot.providerSummary.asr.type).toBe('openai');
  });

  it('读取腾讯 provider 设置时不会把 secretId 或 secretKey 返回给 sidepanel', async () => {
    getProviderConfigMock.mockResolvedValue({
      asr: {
        type: 'tencent',
        mode: 'direct',
        region: 'ap-shanghai',
        secretId: 'secret-id',
        secretKey: 'secret-key',
        language: 'zh',
      },
      structurer: {
        type: 'mock',
        mode: 'direct',
        model: 'mock-structurer',
        language: 'zh',
      },
    });

    const getResponse = await dispatchMessage({
      type: 'GET_PROVIDER_SETTINGS',
      target: 'service-worker',
      payload: {},
    });

    expect(getResponse.success).toBe(true);
    expect(getResponse.config.asr.secretId).toBeUndefined();
    expect(getResponse.config.asr.secretKey).toBeUndefined();
    expect(getResponse.config.asr.region).toBe('ap-shanghai');
  });

  it('读取旧 provider 设置时会清掉持久化的 retry 覆盖值，避免旧 15 秒超时继续生效', async () => {
    getProviderConfigMock.mockResolvedValue({
      asr: {
        type: 'openai',
        mode: 'direct',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'asr-secret',
        model: 'gpt-4o-mini-transcribe',
        language: 'zh',
        retry: {
          maxAttempts: 3,
          baseDelayMs: 400,
          maxDelayMs: 2_000,
          timeoutMs: 15_000,
          retryableStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
        },
      },
      structurer: {
        type: 'zhipu',
        mode: 'direct',
        endpoint: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'structurer-secret',
        model: 'glm-4.7-flash',
        language: 'zh',
        retry: {
          maxAttempts: 3,
          baseDelayMs: 400,
          maxDelayMs: 2_000,
          timeoutMs: 15_000,
          retryableStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
        },
      },
    });
    saveProviderConfigMock.mockClear();
    createRuntimeProvidersMock.mockClear();

    const getResponse = await dispatchMessage({
      type: 'GET_PROVIDER_SETTINGS',
      target: 'service-worker',
      payload: {},
    });

    expect(getResponse.success).toBe(true);
    expect(getResponse.config.asr.retry).toBeUndefined();
    expect(getResponse.config.structurer.retry).toBeUndefined();
    expect(createRuntimeProvidersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        asr: expect.objectContaining({
          retry: undefined,
        }),
        structurer: expect.objectContaining({
          retry: undefined,
        }),
      }),
    );
    expect(saveProviderConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        asr: expect.objectContaining({
          retry: undefined,
        }),
        structurer: expect.objectContaining({
          retry: undefined,
        }),
      }),
    );
  });

  it('保存设置时若密钥字段为空，会沿用本地已保存的密钥', async () => {
    await dispatchMessage({
      type: 'SAVE_PROVIDER_SETTINGS',
      target: 'service-worker',
      payload: {
        config: {
          asr: {
            type: 'openai',
            mode: 'direct',
            endpoint: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini-transcribe',
            language: 'zh',
          },
          structurer: {
            type: 'openai',
            mode: 'direct',
            endpoint: 'https://api.openai.com/v1',
            model: 'gpt-4.1-mini',
            language: 'zh',
          },
        },
      },
    });

    expect(saveProviderConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        asr: expect.objectContaining({
          apiKey: 'asr-secret',
        }),
        structurer: expect.objectContaining({
          apiKey: 'structurer-secret',
        }),
      }),
    );
  });

  it('保存腾讯设置时若 secretId 和 secretKey 为空，会沿用已保存的腾讯密钥', async () => {
    getProviderConfigMock.mockResolvedValue({
      asr: {
        type: 'tencent',
        mode: 'direct',
        region: 'ap-shanghai',
        secretId: 'saved-secret-id',
        secretKey: 'saved-secret-key',
        language: 'zh',
      },
      structurer: {
        type: 'mock',
        mode: 'direct',
        model: 'mock-structurer',
        language: 'zh',
      },
    });

    await dispatchMessage({
      type: 'SAVE_PROVIDER_SETTINGS',
      target: 'service-worker',
      payload: {
        config: {
          asr: {
            type: 'tencent',
            mode: 'direct',
            region: 'ap-shanghai',
            language: 'zh',
          },
          structurer: {
            type: 'mock',
            mode: 'direct',
            model: 'mock-structurer',
            language: 'zh',
          },
        },
      },
    });

    expect(saveProviderConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        asr: expect.objectContaining({
          type: 'tencent',
          secretId: 'saved-secret-id',
          secretKey: 'saved-secret-key',
        }),
      }),
    );
  });

  it('保存历史 relay 配置时会强制收敛为 direct 并清掉 relay token', async () => {
    getProviderConfigMock.mockResolvedValue({
      asr: {
        type: 'tencent',
        mode: 'relay',
        sessionToken: 'saved-relay-token',
        region: 'ap-shanghai',
        language: 'zh',
      },
      structurer: {
        type: 'openai',
        mode: 'relay',
        endpoint: 'https://api.openai.com/v1',
        sessionToken: 'saved-structurer-relay-token',
        model: 'gpt-4.1-mini',
        language: 'zh',
      },
    });

    await dispatchMessage({
      type: 'SAVE_PROVIDER_SETTINGS',
      target: 'service-worker',
      payload: {
        config: {
          asr: {
            type: 'tencent',
            mode: 'relay',
            sessionToken: 'relay-session-token',
            region: 'ap-shanghai',
            secretId: 'saved-secret-id',
            secretKey: 'saved-secret-key',
            language: 'zh',
          },
          structurer: {
            type: 'openai',
            mode: 'relay',
            endpoint: 'https://api.openai.com/v1',
            sessionToken: 'relay-structurer-token',
            model: 'gpt-4.1-mini',
            language: 'zh',
          },
        },
      },
    });

    expect(saveProviderConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        asr: expect.objectContaining({
          type: 'tencent',
          mode: 'direct',
          sessionToken: undefined,
          secretId: 'saved-secret-id',
          secretKey: 'saved-secret-key',
        }),
        structurer: expect.objectContaining({
          type: 'openai',
          mode: 'direct',
          sessionToken: undefined,
        }),
      }),
    );
  });

  it('可以清除本地 provider 密钥', async () => {
    const clearResponse = await dispatchMessage({
      type: 'CLEAR_PROVIDER_SECRETS',
      target: 'service-worker',
      payload: {},
    });

    expect(clearResponse.success).toBe(true);
    expect(clearProviderSecretsMock).toHaveBeenCalled();
    expect(saveProviderConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        asr: expect.objectContaining({
          type: 'mock',
        }),
        structurer: expect.objectContaining({
          type: 'mock',
        }),
      }),
    );
  });

  it('worker 已完成初次 hydration 后，仍能在处理 chunk 前重新读取 runtime state', async () => {
    storageState['listen-graphic-runtime-state'] = {
      currentSession: {
        sessionId: 'session_runtime_rehydrate',
        tabId: 1,
        state: 'capturing',
      },
      transcriptWindow: [],
      mergedGraph: null,
      chunkIndex: 0,
      currentTimeMs: 0,
      currentView: undefined,
      currentViewPinned: false,
      pendingSessionFinalize: null,
      providerSummary: {
        asr: {
          type: 'openai',
          mode: 'direct',
          endpoint: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini-transcribe',
          language: 'zh',
          apiKeyConfigured: true,
          sessionTokenConfigured: false,
        },
        structurer: {
          type: 'openai',
          mode: 'direct',
          endpoint: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
          language: 'zh',
          apiKeyConfigured: true,
          sessionTokenConfigured: false,
        },
      },
      lastProviderError: null,
    };

    const response = await dispatchMessage({
      type: 'AUDIO_CHUNK_READY',
      target: 'service-worker',
      payload: {
        audioData: [1, 2, 3, 4],
        startMs: 0,
        endMs: 30000,
      },
    });

    expect(response.success).toBe(true);
  });
});
