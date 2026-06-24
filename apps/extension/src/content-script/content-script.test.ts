import { beforeEach, describe, expect, it, vi } from 'vitest';
import { URL as NodeURL } from 'node:url';

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
  let fetchMock: ReturnType<typeof vi.fn>;
  let processorNodeInstance: { port: { onmessage: ((event: MessageEvent) => void) | null } } | null;
  let webSocketInstances: any[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    (globalThis as any).URL = NodeURL;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    window.history.replaceState({}, '', 'http://localhost:3000/');

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
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    webSocketInstances = [];
    processorNodeInstance = null;
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: getDisplayMediaMock,
      },
    });

    class AudioWorkletNodeMock {
      port = { onmessage: null as ((event: MessageEvent) => void) | null };
      disconnect = vi.fn();

      constructor() {
        processorNodeInstance = this;
      }
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
    (globalThis as any).WebSocket = class {
      static OPEN = 1;
      static CONNECTING = 0;
      url: string;
      readyState = 0;
      binaryType = 'blob';
      sent: unknown[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      private listeners = new Map<string, Set<(...args: any[]) => void>>();

      constructor(url: string) {
        this.url = url;
        this.addEventListener = vi.fn((type: string, handler: (...args: any[]) => void) => {
          const current = this.listeners.get(type) ?? new Set();
          current.add(handler);
          this.listeners.set(type, current);
        });
        this.removeEventListener = vi.fn((type: string, handler: (...args: any[]) => void) => {
          this.listeners.get(type)?.delete(handler);
        });
        this.close = vi.fn(() => {
          this.readyState = 3;
          this.onclose?.();
        });
        webSocketInstances.push(this);
      }

      addEventListener: any;
      removeEventListener: any;
      close: any;
      dispatchOpen = () => {
        this.readyState = 1;
        this.listeners.get('open')?.forEach((handler) => handler());
        // 真实浏览器 WebSocket 的 open 事件会同时触发 onopen 属性与 addEventListener。
        this.onopen?.();
      };

      send(data: unknown) {
        this.sent.push(data);
      }
    };

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

  it('fixture 页面会按 manifest 顺序发送测试音频块，而不走 getDisplayMedia', async () => {
    window.history.replaceState({}, '', 'http://localhost:3000/fixture.html');
    document.head.innerHTML = '<meta name="listen-graphic-test-manifest" content="/fixture-manifest.json">';
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          captureMode: 'fixture-chunks',
          chunks: [
            {
              url: '/audio/chunk-1.wav',
              startMs: 0,
              endMs: 1000,
            },
            {
              url: '/audio/chunk-2.wav',
              startMs: 1000,
              endMs: 2000,
              delayAfterMs: 0,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: () => 'audio/wav',
        },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: () => 'audio/wav',
        },
        arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
      });

    await dispatchMessage({
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: {},
    });

    expect(getDisplayMediaMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:3000/fixture-manifest.json');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:3000/audio/chunk-1.wav');
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://localhost:3000/audio/chunk-2.wav');
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AUDIO_CHUNK_READY',
        payload: expect.objectContaining({
          audioData: [1, 2, 3],
          audioMimeType: 'audio/wav',
          startMs: 0,
          endMs: 1000,
        }),
      }),
    );
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AUDIO_CHUNK_READY',
        payload: expect.objectContaining({
          audioData: [4, 5, 6],
          audioMimeType: 'audio/wav',
          startMs: 1000,
          endMs: 2000,
        }),
      }),
    );
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

  it('收到 worklet 音频块时会转成 wav 字节并发送到 service worker', async () => {
    await dispatchMessage({
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: {},
    });

    const floatChunk = new Float32Array([0, 0.5, -0.5, 1]);
    processorNodeInstance?.port.onmessage?.({
      data: {
        type: 'AUDIO_CHUNK',
        audioData: floatChunk.buffer,
        startMs: 0,
        endMs: 30000,
      },
    } as MessageEvent);

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: expect.objectContaining({
          audioData: expect.any(Array),
          audioMimeType: 'audio/wav',
          sampleRate: 16000,
          channels: 1,
          bitDepth: 16,
          startMs: 0,
          endMs: 30000,
        }),
      }),
    );

    const payload = (globalThis as any).chrome.runtime.sendMessage.mock.calls.at(-1)?.[0]?.payload;
    const riff = String.fromCharCode(...payload.audioData.slice(0, 4));
    expect(riff).toBe('RIFF');
  });

  it('腾讯实时模式会建立 WebSocket，并把稳定句段回传给 service worker', async () => {
    const startPromise = dispatchMessage({
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: {
        transport: 'ws',
        tencentRealtime: {
          signedUrl: 'wss://asr.cloud.tencent.com/asr/v2/appid?signature=abc',
          sampleRate: 16000,
          frameDurationMs: 40,
        },
      },
    });

    for (let attempt = 0; attempt < 10 && webSocketInstances.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(webSocketInstances).toHaveLength(1);
    webSocketInstances[0].dispatchOpen();
    await startPromise;

    processorNodeInstance?.port.onmessage?.({
      data: {
        type: 'AUDIO_FRAME',
        audioData: new Float32Array([0, 0.5, -0.5, 1]).buffer,
        startMs: 0,
        endMs: 40,
      },
    } as MessageEvent);

    const socketInstance = webSocketInstances[0];
    expect(socketInstance.sent.length).toBeGreaterThan(0);

    socketInstance.onmessage?.({
      data: JSON.stringify({
        code: 0,
        voice_id: 'voice_1',
        message_id: 'voice_1_1',
        result: {
          slice_type: 2,
          voice_text_str: '今天天气不错。',
          start_time: 0,
          end_time: 1200,
          word_size: 6,
        },
      }),
    });
    await Promise.resolve();

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ASR_STREAM_FINAL_READY',
        target: 'service-worker',
        payload: expect.objectContaining({
          text: '今天天气不错。',
          startMs: 0,
          endMs: 1200,
          provider: 'tencent-asr',
        }),
      }),
    );
  });

  it('Local ASR Bridge 模式会建立 WebSocket，并把 partial/final 回传给 service worker', async () => {
    const startPromise = dispatchMessage({
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: {
        transport: 'ws',
        stream: {
          providerType: 'external',
          provider: 'local-asr-bridge',
          endpoint: 'ws://127.0.0.1:15377/ws',
          protocol: 'lg-asr-ws-v1',
          sampleRate: 16000,
          frameDurationMs: 40,
        },
      },
    });

    for (let attempt = 0; attempt < 10 && webSocketInstances.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(webSocketInstances).toHaveLength(1);
    webSocketInstances[0].dispatchOpen();

    const socketInstance = webSocketInstances[0];
    expect(socketInstance.sent[0]).toContain('"type":"session.start"');

    // 共享运行时需在收到 session.started 后才完成握手（比原生更严谨），
    // 因此先回送 session.started，再 await 启动 promise。
    socketInstance.onmessage?.({
      data: JSON.stringify({
        type: 'session.started',
        version: '1',
        bridge: { model: 'mock-paraformer' },
      }),
    });
    await startPromise;

    socketInstance.onmessage?.({
      data: JSON.stringify({
        type: 'transcript.partial',
        utterance: {
          utteranceId: 'utt-1',
          revision: 1,
          text: '今天',
          startMs: 0,
          endMs: 300,
        },
      }),
    });
    socketInstance.onmessage?.({
      data: JSON.stringify({
        type: 'transcript.final',
        utterance: {
          utteranceId: 'utt-1',
          revision: 2,
          text: '今天天气不错。',
          startMs: 0,
          endMs: 1200,
          finalReason: 'endpoint',
        },
      }),
    });
    await Promise.resolve();

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ASR_STREAM_PARTIAL_UPDATED',
        target: 'service-worker',
        payload: expect.objectContaining({
          text: '今天',
          provider: 'local-asr-bridge',
          utteranceId: 'utt-1',
        }),
      }),
    );
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ASR_STREAM_FINAL_READY',
        target: 'service-worker',
        payload: expect.objectContaining({
          text: '今天天气不错。',
          provider: 'local-asr-bridge',
          utteranceId: 'utt-1',
          finalReason: 'endpoint',
        }),
      }),
    );

    // 关闭流程契约：STOP_CAPTURE 后必须按顺序发出 audio.flush 与 session.stop。
    await dispatchMessage({ type: 'STOP_CAPTURE', target: 'content-script' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sentTypes = socketInstance.sent.map((raw: string) => {
      try {
        return JSON.parse(raw).type;
      } catch {
        return '<unparseable>';
      }
    });
    expect(sentTypes[sentTypes.length - 2]).toBe('audio.flush');
    expect(sentTypes[sentTypes.length - 1]).toBe('session.stop');
  });
});
