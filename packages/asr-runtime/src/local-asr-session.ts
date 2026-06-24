// LocalAsrSession：单一 WebSocket 后端的 lg-asr-ws-v1 会话状态机。
// 由扩展 content-script 与桌面端复用；宿主负责创建 socket（websocketFactory）、
// 提供音频帧，并消费 on() 转发的规范化事件。

import { bytesToBase64, float32ToPcm16 } from './audio';
import { parseLocalAsrMessage } from './protocol-parser';
import {
  LocalAsrRuntimeError,
  type LocalAsrEvent,
  type LocalAsrSessionState,
} from './protocol';

/** 宿主注入的最小 WebSocket 抽象（浏览器 WebSocket 或测试假对象均满足）。 */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (endpoint: string) => WebSocketLike;

export interface LocalAsrSessionOptions {
  endpoint: string;
  authToken?: string;
  sampleRate: number;
  frameDurationMs: number;
  sessionId: string;
  websocketFactory: WebSocketFactory;
  handshakeTimeoutMs?: number;
  closeTimeoutMs?: number;
}

type EventHandler = (event: LocalAsrEvent) => void;

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;

/**
 * 管理 lg-asr-ws-v1 会话的完整生命周期：
 * idle → connecting → starting → streaming → flushing/stopping → closed。
 */
export class LocalAsrSession {
  private state: LocalAsrSessionState = 'idle';
  private socket: WebSocketLike | null = null;
  private handlers = new Set<EventHandler>();
  private connectPromise: Promise<void> | null = null;
  private flushPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handshakeTimeoutMs: number;
  private readonly closeTimeoutMs: number;

  constructor(private readonly options: LocalAsrSessionOptions) {
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
  }

  /** 订阅规范化事件，返回取消订阅函数。 */
  on(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** 当前状态，供宿主侧 UI/诊断使用。 */
  getState(): LocalAsrSessionState {
    return this.state;
  }

  /**
   * 建立连接并完成握手。仅在收到 session.started 后 resolve，
   * 此前发送帧会被拒绝，避免握手期间丢帧。
   */
  connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.state = 'connecting';
    this.connectPromise = new Promise<void>((resolve, reject) => {
      let socket: WebSocketLike;
      try {
        socket = this.options.websocketFactory(this.options.endpoint);
      } catch (error) {
        reject(this.toRuntimeError('CONNECTION_FAILED', 'WebSocket 创建失败', error));
        return;
      }
      this.socket = socket;

      const settle = (outcome: () => void) => {
        this.clearHandshakeTimer();
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        this.bindRuntimeHandlers(socket);
        outcome();
      };

      // 握手超时从连接发起时计时（而非 socket open），覆盖 socket 一直未 open 的情况。
      this.handshakeTimer = setTimeout(() => {
        settle(() => {
          this.state = 'error';
          reject(new LocalAsrRuntimeError('HANDSHAKE_TIMEOUT', '等待 session.started 超时'));
        });
      }, this.handshakeTimeoutMs);

      socket.onopen = () => {
        this.state = 'starting';
        this.sendJson(socket, {
          type: 'session.start',
          version: '1',
          session: { sessionId: this.options.sessionId },
          audio: {
            codec: 'pcm_s16le',
            sampleRate: this.options.sampleRate,
            channels: 1,
            frameDurationMs: this.options.frameDurationMs,
          },
          auth: this.options.authToken ? { token: this.options.authToken } : undefined,
        });
      };

      socket.onerror = () => {
        if (this.state === 'connecting' || this.state === 'starting') {
          settle(() => {
            this.state = 'error';
            reject(
              new LocalAsrRuntimeError('CONNECTION_FAILED', 'Local ASR Bridge 连接失败'),
            );
          });
        }
      };

      // 握手期间临时监听 message，等待 session.started。
      socket.onmessage = (event) => {
        let parsed: LocalAsrEvent;
        try {
          parsed = parseLocalAsrMessage(event.data);
        } catch {
          return; // 握手期忽略畸形消息
        }
        if (parsed.type === 'session.started') {
          this.state = 'streaming';
          settle(() => resolve());
        }
      };

      socket.onclose = () => {
        if (this.state === 'connecting' || this.state === 'starting') {
          settle(() => {
            this.state = 'error';
            reject(
              new LocalAsrRuntimeError('CONNECTION_FAILED', 'Local ASR Bridge 连接已关闭'),
            );
          });
        }
      };
    });

    // 连接失败后清空 in-flight，允许将来重试。
    this.connectPromise.catch(() => {
      this.connectPromise = null;
      this.cleanup();
    });

    return this.connectPromise;
  }

  /**
   * 发送一帧音频。必须在 streaming 状态调用，否则抛 INVALID_STATE。
   * timestampMs 由宿主提供（音频时间戳），透传给 bridge。
   */
  sendFloat32Frame(samples: Float32Array, timestampMs: number): void {
    if (this.state !== 'streaming' || !this.socket) {
      throw new LocalAsrRuntimeError(
        'INVALID_STATE',
        `当前状态 ${this.state} 不允许发送音频帧`,
      );
    }
    const pcm16 = float32ToPcm16(samples);
    this.sendJson(this.socket, {
      type: 'audio.frame',
      audio: {
        codec: 'pcm_s16le',
        data: bytesToBase64(new Uint8Array(pcm16.buffer)),
        samples: pcm16.length,
      },
      timestampMs,
    });
  }

  /** 请求 bridge 刷新缓冲。幂等：重复调用复用同一 promise。 */
  flush(): Promise<void> {
    if (this.flushPromise) {
      return this.flushPromise;
    }
    this.flushPromise = this.runControl('audio.flush', 'flushing', 'FLUSH_TIMEOUT');
    return this.flushPromise;
  }

  /** 请求 bridge 结束会话。幂等：重复调用复用同一 promise。 */
  stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopPromise = this.runControl('session.stop', 'stopping', 'STOP_TIMEOUT');
    return this.stopPromise;
  }

  /** 运行一次 flush/stop 控制往返：发指令 → 等待关闭 → 超时兜底。 */
  private runControl(
    payloadType: string,
    transientState: LocalAsrSessionState,
    timeoutCode: 'FLUSH_TIMEOUT' | 'STOP_TIMEOUT',
  ): Promise<void> {
    const socket = this.socket;
    if (!socket || this.state === 'closed' || this.state === 'error') {
      return Promise.resolve();
    }
    this.state = transientState;
    this.sendJson(socket, { type: payloadType });

    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.clearCloseTimer();
        resolve();
      };
      this.closeTimer = setTimeout(() => {
        if (this.state !== 'closed') {
          this.emit({
            type: 'error',
            error: new LocalAsrRuntimeError(timeoutCode, `${payloadType} 等待关闭超时`),
          });
        }
        finish();
      }, this.closeTimeoutMs);
      const prevClose = socket.onclose;
      socket.onclose = () => {
        prevClose?.();
        finish();
      };
    });
  }

  /** 握手成功后绑定运行期 message/close 处理。 */
  private bindRuntimeHandlers(socket: WebSocketLike): void {
    socket.onmessage = (event) => {
      let parsed: LocalAsrEvent;
      try {
        parsed = parseLocalAsrMessage(event.data);
      } catch (error) {
        // 畸形消息：转发一个 error 事件，但不中断会话。
        const runtimeError =
          error instanceof LocalAsrRuntimeError
            ? error
            : new LocalAsrRuntimeError('INVALID_PROTOCOL_MESSAGE', '消息解析失败');
        this.emit({ type: 'error', error: runtimeError });
        return;
      }
      this.emit(parsed);
    };
    socket.onclose = () => {
      if (this.state === 'closed') return;
      if (this.state === 'stopping' || this.state === 'flushing') {
        this.state = 'closed';
        this.emit({ type: 'closed', expected: true });
        return;
      }
      this.state = 'error';
      this.emit({
        type: 'error',
        error: new LocalAsrRuntimeError('UNEXPECTED_CLOSE', 'Local ASR Bridge 意外关闭'),
      });
    };
    socket.onerror = null;
  }

  private emit(event: LocalAsrEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // 订阅者异常不应影响会话。
      }
    }
  }

  private sendJson(socket: WebSocketLike, payload: unknown): void {
    socket.send(JSON.stringify(payload));
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private clearCloseTimer(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private toRuntimeError(
    code: 'CONNECTION_FAILED',
    message: string,
    cause?: unknown,
  ): LocalAsrRuntimeError {
    return new LocalAsrRuntimeError(code, message, { cause });
  }

  /** 清理定时器与 socket 引用（连接失败或销毁时调用）。 */
  private cleanup(): void {
    this.clearHandshakeTimer();
    this.clearCloseTimer();
    this.socket = null;
  }
}
