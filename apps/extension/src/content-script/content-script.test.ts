import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('content-script 主链路', () => {
  let messageListener:
    | ((message: any, sender: any, sendResponse: (response: any) => void) => boolean | void)
    | null = null;
  let audioTrack: { stop: ReturnType<typeof vi.fn>; onended: null | (() => void) };
  let videoTrack: {
    enabled: boolean;
    stop: ReturnType<typeof vi.fn>;
    onended: null | (() => void);
    getSettings: any;
    getCaptureHandle?: any;
  };
  let mediaStreamMock: {
    getAudioTracks: () => typeof audioTrack[];
    getVideoTracks: () => typeof videoTrack[];
    getTracks: () => Array<typeof audioTrack | typeof videoTrack>;
  };
  let getDisplayMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    messageListener = null;
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
      (listener: typeof messageListener) => {
        messageListener = listener;
      },
    );

    audioTrack = {
      stop: vi.fn(),
      onended: null,
    };
    videoTrack = {
      enabled: true,
      stop: vi.fn(),
      onended: null,
      getSettings: vi.fn(() => ({ displaySurface: 'browser' })),
    };
    mediaStreamMock = {
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => [videoTrack],
      getTracks: () => [audioTrack, videoTrack],
    };

    getDisplayMediaMock = vi.fn().mockResolvedValue(mediaStreamMock);
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: getDisplayMediaMock,
      },
    });

    class AudioWorkletNodeMock {
      port = { onmessage: null as ((event: MessageEvent) => void) | null };
      disconnect = vi.fn();
    }

    class AudioContextMock {
      audioWorklet = {
        addModule: vi.fn(() => Promise.resolve()),
      };
      createMediaStreamSource = vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      close = vi.fn(() => Promise.resolve());
    }

    (globalThis as any).AudioContext = AudioContextMock;
    (globalThis as any).AudioWorkletNode = AudioWorkletNodeMock;

    await import('./content-script');
  });

  async function dispatchMessage(message: any) {
    return new Promise((resolve) => {
      messageListener?.(message, {}, resolve);
    });
  }

  it('启动采集时会使用当前标签页友好的 getDisplayMedia 约束', async () => {
    await dispatchMessage({
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: {},
    });

    expect(getDisplayMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: true,
        video: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      }),
    );
    expect(videoTrack.enabled).toBe(false);
  });

  it('如果用户分享的是窗口或屏幕而不是浏览器标签页，会直接失败', async () => {
    videoTrack.getSettings.mockReturnValue({ displaySurface: 'window' });

    const response = await dispatchMessage({
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: {},
    });

    expect(response).toEqual({
      success: false,
      error: '请选择浏览器标签页作为共享目标，而不是整个窗口或屏幕',
    });
    expect(audioTrack.stop).toHaveBeenCalled();
    expect(videoTrack.stop).toHaveBeenCalled();
  });

  it('收到 seek 请求时会跳转到页面里的媒体元素', async () => {
    const media = document.createElement('audio');
    document.body.appendChild(media);

    await dispatchMessage({
      type: 'SEEK_TO_TIMESTAMP',
      target: 'content-script',
      payload: { timestampMs: 15000 },
    });

    expect(media.currentTime).toBe(15);
  });

  it('共享结束时会向 service worker 上报 CAPTURE_ENDED', async () => {
    await dispatchMessage({
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: {},
    });

    audioTrack.onended?.();
    await Promise.resolve();

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CAPTURE_ENDED',
        target: 'service-worker',
        payload: { reason: 'share-ended' },
      }),
    );
  });
});
