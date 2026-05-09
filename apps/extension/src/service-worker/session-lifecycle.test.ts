import { beforeEach, describe, expect, it } from 'vitest';
import {
  setupServiceWorkerTests,
  dispatchMessage,
  storageState,
  saveSessionMock,
  createRuntimeProvidersMock,
  getProviderConfigMock,
  startRealtimeSession,
  startExternalRealtimeSession,
} from './__test-helpers__/index-test-helpers';

describe('Service Worker - 会话生命周期', () => {
  beforeEach(async () => {
    await setupServiceWorkerTests();
  });

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
    await startRealtimeSession();

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

  it('Local ASR Bridge 配置会把通用 websocket 参数下发给 content script', async () => {
    const chromeMock = (globalThis as any).chrome;
    await startExternalRealtimeSession();

    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        type: 'START_CAPTURE',
        payload: expect.objectContaining({
          transport: 'ws',
          stream: expect.objectContaining({
            providerType: 'external',
            provider: 'local-asr-bridge',
            endpoint: 'ws://127.0.0.1:15377/ws',
            protocol: 'lg-asr-ws-v1',
            authToken: 'bridge-token',
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
});
